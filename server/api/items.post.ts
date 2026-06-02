import { defineEventHandler, readBody } from 'h3';
import { getSlackClient, checkedItems } from '../utils/state';

/**
 * 選択された買い物アイテムを購入済みにします。
 * ※ Slackのメッセージにチェックマークのリアクションを追加する
 * @returns 処理結果のステータスメッセージ
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const channelId = config.slackChannelId;
  if (!channelId) {
    throw createError({
      statusCode: 500,
      statusMessage: 'NUXT_SLACK_CHANNEL_ID is not configured.',
    });
  }

  const body = await readBody(event);
  const { tsList } = body;

  if (!tsList || !Array.isArray(tsList) || tsList.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'tsList must be a non-empty array.',
    });
  }

  try {
    const client = getSlackClient();
    
    // Slack投稿へのチェックマークリアクション処理の並行実行
    const results = await Promise.allSettled(
      tsList.map(async (ts) => {
        const response = await client.reactions.add({
          channel: channelId,
          name: 'heavy_check_mark',
          timestamp: ts,
        });
        if (!response.ok) {
          throw new Error(`Failed to add reaction to ts ${ts}: ${response.error}`);
        }
        
        checkedItems.delete(ts);
        return ts;
      }),
    );

    const failedCount = results.filter((res) => res.status === 'rejected').length;

    if (failedCount > 0) {
      results.forEach((res, idx) => {
        if (res.status === 'rejected') {
          console.error(`Failed to add reaction to message ${tsList[idx]}:`, res.reason);
        }
      });
      console.warn(`Some reactions could not be added: ${failedCount} failures.`);
      
      return {
        status: 'partial_success',
        message: `${tsList.length - failedCount}件完了、${failedCount}件の処理に失敗しました。`,
      };
    }

    return {
      status: 'success',
      message: `${tsList.length}件のアイテムを購入済みにしました。`,
    };
  } catch (error) {
    console.error('Error adding reactions to items on Slack:', error);
    const err = error as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    throw createError({
      statusCode: 500,
      statusMessage: err.message || '購入済み処理に失敗しました。',
    });
  }
});
