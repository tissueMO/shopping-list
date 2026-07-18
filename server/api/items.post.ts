import { defineEventHandler, readBody } from 'h3';
import { getStatusCode, isObject } from '../utils/error';
import { getKeepApiUrl, checkedItemIds } from '../utils/state';

interface PurchaseRequestBody {
  ids?: unknown;
}

interface KeepCompleteResponse {
  status: 'success';
  updated_count: number;
}

/**
 * 選択された買い物アイテムを購入済みにします。
 * ※Google Keepの該当アイテムを購入済みにする。
 *
 * @param event リクエストイベント
 * @returns 処理結果のステータスメッセージ
 */
export default defineEventHandler(async (event) => {
  const body: unknown = await readBody<PurchaseRequestBody>(event);
  if (
    !isObject(body) ||
    !Array.isArray(body.ids) ||
    body.ids.length === 0 ||
    !body.ids.every(value => typeof value === 'string' && value.length > 0) ||
    new Set(body.ids).size !== body.ids.length
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: '購入済みにするアイテムIDの一覧が必要です。',
    });
  }

  const ids = body.ids as string[];
  const keepApiUrl = getKeepApiUrl();

  try {
    const response = await $fetch<KeepCompleteResponse>(`${keepApiUrl}/items/complete`, {
      method: 'POST',
      body: { ids },
    });

    if (response.status !== 'success') {
      throw new Error('Google Keepでの購入済み更新処理に失敗しました。');
    }

    ids.forEach(id => {
      checkedItemIds.delete(id);
    });

    return {
      status: 'success',
      message: `${response.updated_count}件のアイテムを購入済みにしました。`,
    };
  } catch (error) {
    console.error('Google Keep購入済み処理エラー:', error);
    throw createError({
      statusCode: getStatusCode(error),
      statusMessage: 'Google Keepの買い物リストを更新できませんでした。',
    });
  }
});
