import unittest
from collections.abc import Iterator
from unittest.mock import create_autospec

import gkeepapi
from fastapi.testclient import TestClient

import main


class KeepApiContractTest(unittest.TestCase):
    def setUp(self) -> None:
        """各テストに独立したKeepサービスと買い物リストを用意します。"""
        settings = main.Settings(
            email="test@example.com",
            master_token="test-master-token",
            device_id="test-device-id",
            list_title="買い物リスト",
        )
        self.shopping_list = gkeepapi.node.List()
        self.shopping_list.title = settings.list_title
        self.unchecked_item = self.shopping_list.add("牛乳")
        self.shopping_list.add("購入済み", checked=True)

        self.keep = create_autospec(
            gkeepapi.Keep,
            instance=True,
            spec_set=True,
        )
        self.keep.find.side_effect = self.find_shopping_list

        service = main.KeepService(settings, keep=self.keep)
        app = main.create_app(service)
        self.client = self.enterContext(TestClient(app))

    def find_shopping_list(
        self,
        **_kwargs: object,
    ) -> Iterator[gkeepapi.node.TopLevelNode]:
        """テスト用の買い物リストを検索結果として返します。"""
        return iter([self.shopping_list])

    def test_health_returns_ok(self) -> None:
        """稼働中のステータスと対象リスト名を返すことを検証します。"""
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "status": "ok",
                "list_title": "買い物リスト",
            },
        )

    def test_get_items_returns_only_unchecked_items(self) -> None:
        """未購入のアイテムだけを返すことを検証します。"""
        response = self.client.get("/items")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "items": [
                    {
                        "id": self.unchecked_item.id,
                        "text": "牛乳",
                        "checked": False,
                    }
                ]
            },
        )

    def test_add_item_returns_created_item(self) -> None:
        """未購入アイテムを末尾へ追加し、追加結果を返すことを検証します。"""
        response = self.client.post("/items/add", json={"text": "食パン"})

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "success")
        self.assertEqual(body["item"]["text"], "食パン")
        self.assertFalse(body["item"]["checked"])
        self.assertTrue(body["item"]["id"])

    def test_completed_item_disappears_from_get_items(self) -> None:
        """購入済みにしたアイテムが未購入一覧から消えることを検証します。"""
        complete_response = self.client.post(
            "/items/complete",
            json={"ids": [self.unchecked_item.id]},
        )
        items_response = self.client.get("/items")

        self.assertEqual(complete_response.status_code, 200)
        self.assertEqual(
            complete_response.json(),
            {
                "status": "success",
                "updated_count": 1,
            },
        )
        self.assertEqual(items_response.status_code, 200)
        self.assertEqual(items_response.json(), {"items": []})


if __name__ == "__main__":
    unittest.main()
