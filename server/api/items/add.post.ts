import { defineEventHandler, readBody } from 'h3';
import { getStatusCode, isObject } from '../../utils/error';
import { getKeepApiUrl, getCategoryCache } from '../../utils/state';

interface AddItemRequestBody {
  text?: unknown;
}

interface KeepAddResponse {
  status: 'success';
  item: {
    id: string;
    text: string;
    checked: boolean;
  };
}

/**
 * 買い物リストに新しいアイテムを登録します。
 * ※Google Keepリストへ新しいアイテムを追加する。
 *
 * @param event リクエストイベント
 * @returns 登録成功ステータスメッセージと追加されたアイテム情報
 */
export default defineEventHandler(async (event) => {
  const body: unknown = await readBody<AddItemRequestBody>(event);
  if (!isObject(body) || typeof body.text !== 'string' || body.text.trim().length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: '追加するアイテム名が必要です。',
    });
  }

  const text = body.text.trim();
  const keepApiUrl = getKeepApiUrl();

  try {
    const cache = await getCategoryCache();
    const response = await $fetch<KeepAddResponse>(`${keepApiUrl}/items/add`, {
      method: 'POST',
      body: { text },
    });

    if (response.status !== 'success' || !response.item?.id) {
      throw new Error('Google Keepへのアイテム追加に失敗しました。');
    }

    return {
      status: 'success',
      message: 'アイテムを追加しました。',
      id: response.item.id,
      category: cache[text],
    };
  } catch (error) {
    console.error('Google Keepアイテム追加エラー:', error);
    throw createError({
      statusCode: getStatusCode(error),
      statusMessage: 'Google Keepへアイテムを追加できませんでした。',
    });
  }
});
