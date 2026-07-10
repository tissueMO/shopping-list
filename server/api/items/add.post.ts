import { defineEventHandler, readBody } from 'h3';
import { isObject } from '../../utils/error';
import { getSlackClient, getCategoryCache } from '../../utils/state';

interface AddItemRequestBody {
  text?: unknown;
}

/**
 * 買い物リストに新しいアイテムを登録します。
 * ※Slackチャンネルへ新しいメッセージを投稿する
 *
 * @param event リクエストイベント
 * @returns 登録成功ステータスメッセージ
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const channelId = config.slackChannelId;
  if (!channelId) {
    throw createError({
      statusCode: 500,
      statusMessage: 'SlackチャンネルIDが設定されていません。',
    });
  }

  const body: unknown = await readBody<AddItemRequestBody>(event);
  if (!isObject(body) || typeof body.text !== 'string' || body.text.trim().length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: '追加するアイテム名が必要です。',
    });
  }

  const text = body.text.trim();
  try {
    const cache = await getCategoryCache();
    const client = getSlackClient();
    const response = await client.chat.postMessage({
      channel: channelId,
      text,
    });

    if (!response.ok || !response.ts) {
      throw new Error(`Slackへの投稿に失敗しました: ${response.error}`);
    }

    return {
      status: 'success',
      message: 'アイテムを追加しました。',
      ts: response.ts,
      category: cache[text],
    };
  } catch (error) {
    console.error('Slackアイテム追加エラー:', error);
    throw createError({
      statusCode: 500,
      statusMessage: 'アイテムの追加に失敗しました。',
    });
  }
});
