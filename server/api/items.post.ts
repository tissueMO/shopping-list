import { defineEventHandler, readBody } from 'h3';
import { getErrorMessage, isObject } from '../utils/error';
import { getSlackClient, checkedItems } from '../utils/state';

interface PurchaseRequestBody {
  tsList?: unknown;
}

interface ReactionResult {
  status: 'success' | 'partial_success';
  message: string;
}

const CHECK_REACTION_NAME = 'heavy_check_mark';
const ALREADY_REACTED_ERROR = 'already_reacted';

/**
 * 選択された買い物アイテムを購入済みにします。
 * ※Slackのメッセージにチェックマークのリアクションを追加する。
 *
 * @param event リクエストイベント
 * @returns 処理結果のステータスメッセージ
 */
export default defineEventHandler(async (event): Promise<ReactionResult> => {
  const config = useRuntimeConfig();
  const channelId = config.slackChannelId;
  if (!channelId) {
    throw createError({
      statusCode: 500,
      statusMessage: 'SlackチャンネルIDが設定されていません。',
    });
  }

  const body = await readBody<PurchaseRequestBody>(event);
  if (
    !Array.isArray(body.tsList) || body.tsList.length === 0 ||
    !body.tsList.every(value => typeof value === 'string' && value.length > 0)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'SlackメッセージIDの一覧が必要です。',
    });
  }

  const tsList = body.tsList;

  try {
    const results = await Promise.allSettled(
      tsList.map(async (ts) => {
        try {
          const client = getSlackClient();
          const response = await client.reactions.add({
            channel: channelId,
            name: CHECK_REACTION_NAME,
            timestamp: ts,
          });

          if (!response.ok) {
            throw new Error(`Slackリアクション追加に失敗しました: ${response.error}`);
          }
        } catch (error) {
          const isAlreadyReacted = isObject(error) &&
            isObject(error.data) &&
            error.data.error === ALREADY_REACTED_ERROR;

          if (!isAlreadyReacted) {
            throw error;
          }
        }

        checkedItems.delete(ts);
        return ts;
      }),
    );

    const failedCount = results.filter(result => result.status === 'rejected').length;

    if (failedCount > 0) {
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error(`Slackリアクション追加失敗: ${tsList[index]}`, result.reason);
        }
      });

      console.warn(`Slackリアクション追加に一部失敗しました: ${failedCount}件`);
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
    console.error('Slack購入済み処理エラー:', error);
    throw createError({
      statusCode: 500,
      statusMessage: getErrorMessage(error, '購入済み処理に失敗しました。'),
    });
  }
});
