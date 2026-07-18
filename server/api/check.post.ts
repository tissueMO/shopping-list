import { defineEventHandler, readBody } from 'h3';
import { isObject } from '../utils/error';
import { checkedItemIds } from '../utils/state';

interface CheckRequestBody {
  id?: unknown;
  checked?: unknown;
}

/**
 * 買い物リストのチェック状態を更新します。
 *
 * @param event リクエストイベント
 * @returns 現在選択されているすべてのアイテムID
 */
export default defineEventHandler(async (event) => {
  const body: unknown = await readBody<CheckRequestBody>(event);
  const id = isObject(body) ? body.id : undefined;
  const checked = isObject(body) ? body.checked : undefined;

  if (typeof id !== 'string' || id.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'アイテムIDが必要です。',
    });
  }

  if (typeof checked !== 'boolean') {
    throw createError({
      statusCode: 400,
      statusMessage: 'チェック状態が必要です。',
    });
  }

  if (checked) {
    checkedItemIds.add(id);
  } else {
    checkedItemIds.delete(id);
  }

  return {
    checkedList: Array.from(checkedItemIds),
  };
});
