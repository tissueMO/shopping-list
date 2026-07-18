import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from threading import Lock
from typing import Annotated, Literal

import gkeepapi
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field, StringConstraints, field_validator


logger = logging.getLogger("keep-api")
ItemId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


@dataclass(frozen=True)
class Settings:
    """Google Keepへの接続設定を保持します。"""

    email: str
    master_token: str
    device_id: str
    list_title: str

    @classmethod
    def from_environment(cls) -> "Settings":
        """環境変数から接続設定を読み取ります。"""
        return cls(
            email=read_required_environment("KEEP_EMAIL"),
            master_token=read_required_environment("KEEP_MASTER_TOKEN"),
            device_id=read_required_environment("KEEP_DEVICE_ID"),
            list_title=os.getenv("KEEP_LIST_TITLE", "買い物リスト").strip()
            or "買い物リスト",
        )


class KeepItem(BaseModel):
    """買い物リストの公開アイテムを表します。"""

    id: str
    text: str
    checked: bool


class ItemsResponse(BaseModel):
    """未購入アイテムの一覧を表します。"""

    items: list[KeepItem]


class AddItemRequest(BaseModel):
    """アイテム追加要求を表します。"""

    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class AddItemResponse(BaseModel):
    """アイテム追加結果を表します。"""

    status: Literal["success"] = "success"
    item: KeepItem


class CompleteItemsRequest(BaseModel):
    """購入済みにするアイテムを表します。"""

    ids: list[ItemId] = Field(min_length=1)

    @field_validator("ids")
    @classmethod
    def validate_unique_ids(cls, ids: list[str]) -> list[str]:
        """アイテムIDの重複を拒否します。"""
        if len(set(ids)) != len(ids):
            raise ValueError("アイテムIDが重複しています。")
        return ids


class CompleteItemsResponse(BaseModel):
    """購入済み更新の結果を表します。"""

    status: Literal["success"] = "success"
    updated_count: int


class HealthResponse(BaseModel):
    """サービスの稼働状態を表します。"""

    status: Literal["ok"] = "ok"
    list_title: str


class KeepService:
    """Google Keepの買い物リスト操作を直列化します。"""

    def __init__(
        self,
        settings: Settings,
        keep: gkeepapi.Keep | None = None,
    ) -> None:
        """コンストラクター"""
        self.settings = settings
        self._keep = keep if keep is not None else gkeepapi.Keep()
        self._lock = Lock()

    def connect(self) -> None:
        """保存済みのマスタートークンでGoogle Keepへ接続します。"""
        self._keep.resume(
            self.settings.email,
            self.settings.master_token,
            device_id=self.settings.device_id,
        )

    def get_items(self) -> list[KeepItem]:
        """未購入の買い物アイテムを取得します。"""
        with self._lock:
            self._keep.sync()
            shopping_list = self._get_or_create_list()
            return [
                KeepItem(id=item.id, text=item.text, checked=False)
                for item in shopping_list.items
                if not item.checked
            ]

    def add_item(self, text: str) -> KeepItem:
        """買い物リストの末尾へ未購入アイテムを追加します。"""
        with self._lock:
            self._keep.sync()
            shopping_list = self._get_or_create_list()
            item = shopping_list.add(
                text,
                checked=False,
                sort=gkeepapi.node.NewListItemPlacementValue.Bottom,
            )
            self._keep.sync()
            return KeepItem(id=item.id, text=item.text, checked=item.checked)

    def complete_items(self, ids: list[str]) -> int:
        """指定された買い物アイテムを購入済みにします。"""
        with self._lock:
            self._keep.sync()
            shopping_list = self._get_or_create_list()
            target_ids = set(ids)
            updated_count = 0

            for item in shopping_list.items:
                if item.id in target_ids and not item.checked:
                    item.checked = True
                    updated_count += 1

            if updated_count > 0:
                self._keep.sync()
            return updated_count

    def _get_or_create_list(self) -> gkeepapi.node.List:
        """設定された買い物リストを取得し、なければ作成します。"""
        notes = self._keep.find(query=self.settings.list_title)
        shopping_list = next(
            (
                note
                for note in notes
                if isinstance(note, gkeepapi.node.List)
                and note.title == self.settings.list_title
            ),
            None,
        )
        if shopping_list is not None:
            return shopping_list

        shopping_list = self._keep.createList(self.settings.list_title, [])
        self._keep.sync()
        return shopping_list


def read_required_environment(name: str) -> str:
    """必須の環境変数を読み取ります。"""
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"環境変数{name}が設定されていません。")
    return value


def get_keep_service(request: Request) -> KeepService:
    """現在のアプリケーションが使用するKeepサービスを返します。"""
    return request.app.state.keep_service


def create_app(service: KeepService | None = None) -> FastAPI:
    """Google Keep連携APIを構築します。"""

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        """起動時にGoogle Keepへの接続を確立します。"""
        keep_service = service if service is not None else KeepService(Settings.from_environment())
        keep_service.connect()
        app.state.keep_service = keep_service
        yield

    api = FastAPI(title="Google Keep Bridge API", lifespan=lifespan)
    api.add_api_route("/health", health, methods=["GET"], response_model=HealthResponse)
    api.add_api_route("/items", get_items, methods=["GET"], response_model=ItemsResponse)
    api.add_api_route(
        "/items/add",
        add_item,
        methods=["POST"],
        response_model=AddItemResponse,
    )
    api.add_api_route(
        "/items/complete",
        complete_items,
        methods=["POST"],
        response_model=CompleteItemsResponse,
    )
    return api


def health(
    service: Annotated[KeepService, Depends(get_keep_service)],
) -> HealthResponse:
    """サービスの稼働状態を返します。"""
    return HealthResponse(list_title=service.settings.list_title)


def get_items(
    service: Annotated[KeepService, Depends(get_keep_service)],
) -> ItemsResponse:
    """未購入の買い物アイテムを返します。"""
    try:
        return ItemsResponse(items=service.get_items())
    except Exception as error:
        logger.exception("Google Keepからのアイテム取得に失敗しました。")
        raise HTTPException(
            status_code=502,
            detail="Google Keepから買い物リストを取得できませんでした。",
        ) from error


def add_item(
    request: AddItemRequest,
    service: Annotated[KeepService, Depends(get_keep_service)],
) -> AddItemResponse:
    """買い物リストへアイテムを追加します。"""
    try:
        return AddItemResponse(item=service.add_item(request.text))
    except Exception as error:
        logger.exception("Google Keepへのアイテム追加に失敗しました。")
        raise HTTPException(
            status_code=502,
            detail="Google Keepへアイテムを追加できませんでした。",
        ) from error


def complete_items(
    request: CompleteItemsRequest,
    service: Annotated[KeepService, Depends(get_keep_service)],
) -> CompleteItemsResponse:
    """指定された買い物アイテムを購入済みにします。"""
    try:
        return CompleteItemsResponse(
            updated_count=service.complete_items(request.ids),
        )
    except Exception as error:
        logger.exception("Google Keepの購入済み更新に失敗しました。")
        raise HTTPException(
            status_code=502,
            detail="Google Keepの買い物リストを更新できませんでした。",
        ) from error


app = create_app()


if __name__ == "__main__":
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
