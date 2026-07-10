import { defineEventHandler, readBody } from 'h3';
import { isObject } from '../utils/error';
import { checkedItems } from '../utils/state';

interface CheckRequestBody {
  ts?: unknown;
  checked?: unknown;
}

/**
 * 買い物リストのチェック状態を更新します。
 *
 * @param event リクエストイベント
 * @returns 現在チェックされているすべてのメッセージID
 */
export default defineEventHandler(async (event) => {
  const body: unknown = await readBody<CheckRequestBody>(event);
  const ts = isObject(body) ? body.ts : undefined;
  const checked = isObject(body) ? body.checked : undefined;

  if (typeof ts !== 'string' || ts.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'SlackメッセージIDが必要です。',
    });
  }

  if (typeof checked !== 'boolean') {
    throw createError({
      statusCode: 400,
      statusMessage: 'チェック状態が必要です。',
    });
  }

  if (checked) {
    checkedItems.add(ts);
  } else {
    checkedItems.delete(ts);
  }

  return {
    checkedList: Array.from(checkedItems.keys()),
  };
});
