import { defineEventHandler } from 'h3';
import { getErrorMessage, getStatusCode } from '../utils/error';
import { getSlackClient, getUserName, getBotName, checkedItems, getCategoryCache } from '../utils/state';

type SlackMessage = NonNullable<Awaited<ReturnType<
  ReturnType<typeof getSlackClient>['conversations']['history']
>>['messages']>[number];

interface ShoppingItem {
  ts: string;
  text: string;
  user: string;
  tsFormatted: string;
  checked: boolean;
  category?: string;
}

const CHECK_REACTION_NAME = 'heavy_check_mark';
const SLACK_HISTORY_LIMIT = 100;
const DISPLAY_TIME_ZONE = 'Asia/Tokyo';

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
    const [cache, response] = await Promise.all([
      getCategoryCache(),
      client.conversations.history({
        channel: channelId,
        limit: SLACK_HISTORY_LIMIT,
      }),
    ]);

    if (!response.ok || !response.messages) {
      throw createError({
        statusCode: 500,
        statusMessage: `Slackメッセージの取得に失敗しました: ${response.error}`,
      });
    }

    const rawMessages = response.messages
      .filter(isShoppingItemMessage)
      .toSorted((first, second) => {
        return Number.parseFloat(first.ts || '0') - Number.parseFloat(second.ts || '0');
      });

    const items = await Promise.all(
      rawMessages.map(message => createShoppingItem(message, cache)),
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

/**
 * Slackメッセージが買い物リストへ表示できるかを判定します。
 *
 * @param message 判定対象のSlackメッセージ
 * @returns 表示できるかどうか
 */
function isShoppingItemMessage(message: SlackMessage): boolean {
  const isParent = !message.thread_ts || message.thread_ts === message.ts;
  const isSupportedType = !message.subtype ||
    message.subtype === 'bot_message' ||
    message.subtype === 'slackbot_response';
  const isPurchased = message.reactions?.some(reaction => reaction.name === CHECK_REACTION_NAME);
  return Boolean(isParent && isSupportedType && message.text && !isPurchased);
}

/**
 * Slackメッセージを買い物リストのアイテムへ変換します。
 *
 * @param message 変換対象のSlackメッセージ
 * @param cache カテゴリーキャッシュ
 * @returns 買い物リストのアイテム
 */
async function createShoppingItem(
  message: SlackMessage,
  cache: Record<string, string>,
): Promise<ShoppingItem> {
  const ts = message.ts || '';
  const text = message.text || '';
  return {
    ts,
    text,
    user: await getDisplayName(message),
    tsFormatted: formatTimestamp(ts),
    checked: checkedItems.has(ts),
    category: cache[text],
  };
}

/**
 * Slackメッセージの投稿者名を取得します。
 *
 * @param message Slackメッセージ
 * @returns 表示する投稿者名
 */
async function getDisplayName(message: SlackMessage): Promise<string> {
  if (message.username) {
    return message.username;
  } else if (message.user) {
    return await getUserName(message.user);
  } else if (message.bot_id) {
    return await getBotName(message.bot_id);
  }
  return '不明';
}

/**
 * Slackの投稿時刻を画面表示用に整形します。
 *
 * @param timestamp Slackの投稿時刻
 * @returns 月日と時分
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(Number.parseFloat(timestamp) * 1000);
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: DISPLAY_TIME_ZONE,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
