import { defineEventHandler, readBody } from 'h3';
import { checkedItems } from '../utils/state';

/**
 * 買い物リストのチェック状態を更新します。
 * ※ 他のユーザーと同期できるようにする
 * @param event イベントオブジェクト
 * @returns 現在チェックされているすべてのメッセージIDのリスト
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { ts, checked } = body;

  if (!ts) {
    throw createError({
      statusCode: 400,
      statusMessage: 'ts (timestamp) is required.',
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
