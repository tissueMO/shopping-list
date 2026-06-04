import { defineEventHandler, readBody } from 'h3';
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
  const body = await readBody<CheckRequestBody>(event);
  const { ts, checked } = body;

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
    checkedItems.set(ts, Date.now());
  } else {
    checkedItems.delete(ts);
  }

  return {
    checkedList: Array.from(checkedItems.keys()),
  };
});
