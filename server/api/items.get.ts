import { defineEventHandler } from 'h3';
import { getErrorMessage, getStatusCode } from '../utils/error';
import { getSlackClient, getUserName, getBotName, checkedItems } from '../utils/state';

interface ShoppingItem {
  ts: string;
  text: string;
  user: string;
  tsFormatted: string;
  checked: boolean;
}

const CHECK_REACTION_NAME = 'heavy_check_mark';
const SLACK_HISTORY_LIMIT = 100;

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
      statusMessage: 'SlackチャンネルIDが設定されていません。',
    });
  }

  try {
    const client = getSlackClient();
    const response = await client.conversations.history({
      channel: channelId,
      limit: SLACK_HISTORY_LIMIT,
    });

    if (!response.ok || !response.messages) {
      throw createError({
        statusCode: 500,
        statusMessage: `Slackメッセージの取得に失敗しました: ${response.error}`,
      });
    }

    const rawMessages = response.messages
      .filter(message => {
        const isParent = !message.thread_ts || message.thread_ts === message.ts;
        const isNormalMessage = !message.subtype ||
          message.subtype === 'bot_message' ||
          message.subtype === 'slackbot_response';
        const hasCheckReaction = message.reactions?.some(reaction => reaction.name === CHECK_REACTION_NAME);

        return Boolean(isParent && isNormalMessage && message.text && !hasCheckReaction);
      })
      .toSorted((first, second) => {
        return Number.parseFloat(first.ts || '0') - Number.parseFloat(second.ts || '0');
      });

    const items = await Promise.all(
      rawMessages.map(async (message): Promise<ShoppingItem> => {
        const ts = message.ts || '';
        let userName = 'unknown';

        if (message.username) {
          userName = message.username;
        } else if (message.user) {
          userName = await getUserName(message.user);
        } else if (message.bot_id) {
          userName = await getBotName(message.bot_id);
        }

        const date = new Date(Number.parseFloat(ts || '0') * 1000);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');

        return {
          ts,
          text: message.text || '',
          user: userName,
          tsFormatted: `${month}/${day} ${hours}:${minutes}`,
          checked: checkedItems.has(ts),
        };
      }),
    );

    return { items };
  } catch (error) {
    console.error('Slackアイテム取得エラー:', error);
    throw createError({
      statusCode: getStatusCode(error),
      statusMessage: getErrorMessage(error, 'Slack連携でエラーが発生しました。'),
    });
  }
});
