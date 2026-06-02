import { defineEventHandler } from 'h3';
import { getSlackClient, getUserName, getBotName, checkedItems } from '../utils/state';

/**
 * 買い物リストのアイテムとなるSlackの投稿メッセージを取得します。
 * 
 * @returns 買い物リストアイテムの一覧
 */
export default defineEventHandler(async () => {
  const config = useRuntimeConfig();
  const channelId = config.slackChannelId;
  if (!channelId) {
    throw createError({
      statusCode: 500,
      statusMessage: 'NUXT_SLACK_CHANNEL_ID is not configured.',
    });
  }

  try {
    const client = getSlackClient();
    const response = await client.conversations.history({
      channel: channelId,
      limit: 100,
    });

    if (!response.ok || !response.messages) {
      throw createError({
        statusCode: 500,
        statusMessage: `Failed to retrieve Slack messages: ${response.error}`,
      });
    }

    // 有効な投稿メッセージの抽出
    const rawMessages = response.messages.filter((msg) => {
      const isParent = !msg.thread_ts || msg.thread_ts === msg.ts;
      const isNormalMessage = !msg.subtype || msg.subtype === 'bot_message' || msg.subtype === 'slackbot_response';
      const hasCheckMark = msg.reactions?.some((r) => r.name === 'heavy_check_mark');
      return isParent && isNormalMessage && msg.text && !hasCheckMark;
    });

    // 投稿順の昇順ソート
    rawMessages.sort((a, b) => {
      const tsA = parseFloat(a.ts || '0');
      const tsB = parseFloat(b.ts || '0');
      return tsA - tsB;
    });

    // メッセージごとのユーザー名の解決およびアイテムモデルの構築
    const items = await Promise.all(
      rawMessages.map(async (msg) => {
        let userName = 'unknown';
        if (msg.username) {
          userName = msg.username;
        } else if (msg.user) {
          userName = await getUserName(msg.user);
        } else if (msg.bot_id) {
          userName = await getBotName(msg.bot_id);
        }
        
        const tsMs = parseFloat(msg.ts || '0') * 1000;
        const date = new Date(tsMs);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const tsFormatted = `${month}/${day} ${hours}:${minutes}`;

        return {
          ts: msg.ts || '',
          text: msg.text || '',
          user: userName,
          tsFormatted,
          checked: checkedItems.has(msg.ts || ''),
        };
      }),
    );

    return { items };
  } catch (error) {
    console.error('Error fetching Slack items:', error);
    const err = error as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.message || 'Slack連携でエラーが発生しました。',
    });
  }
});
