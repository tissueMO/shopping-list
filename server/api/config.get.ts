import { defineEventHandler } from 'h3';
import { getAppConfig } from '../utils/state';

/**
 * 買い物リストの動的設定を取得します。
 * ※ カテゴリーリストなどを取得する
 * @returns 設定オブジェクト
 */
export default defineEventHandler(async () => {
  const config = await getAppConfig();
  return {
    categories: config.categories,
  };
});
