import { defineEventHandler } from 'h3';
import { getStatusCode } from '../utils/error';
import { getKeepApiUrl, checkedItemIds, getCategoryCache } from '../utils/state';

interface KeepItem {
  id: string;
  text: string;
  checked: boolean;
}

interface ShoppingItem {
  id: string;
  text: string;
  checked: boolean;
  category?: string;
}

/**
 * 買い物リストのアイテムとなるGoogle Keepのリストアイテムを取得します。
 *
 * @returns 買い物リストアイテムの一覧
 */
export default defineEventHandler(async () => {
  const keepApiUrl = getKeepApiUrl();

  try {
    const [cache, response] = await Promise.all([
      getCategoryCache(),
      $fetch<{ items: KeepItem[] }>(`${keepApiUrl}/items`),
    ]);

    const items: ShoppingItem[] = response.items.map(item => {
      return {
        id: item.id,
        text: item.text,
        checked: checkedItemIds.has(item.id),
        category: cache[item.text],
      };
    });

    return { items };
  } catch (error) {
    console.error('Google Keepアイテム取得エラー:', error);
    throw createError({
      statusCode: getStatusCode(error),
      statusMessage: 'Google Keepから買い物リストを取得できませんでした。',
    });
  }
});
