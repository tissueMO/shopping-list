import { defineEventHandler, readBody } from 'h3';
import { getErrorMessage, isObject } from '../utils/error';
import { getOpenAIClient, getAppConfig } from '../utils/state';

interface SortRequestBody {
  items?: unknown;
}

interface SortResponseItem {
  ts: string;
  category: string;
}

interface SortResponseBody {
  items: SortResponseItem[];
}

/**
 * 買い物リストのアイテムをスーパーの一般的な陳列棚カテゴリーに分類します。
 *
 * @param event リクエストイベント
 * @returns 分類されたアイテムのリスト
 */
export default defineEventHandler(async (event): Promise<SortResponseBody> => {
  const config = useRuntimeConfig();
  const apiKey = config.openaiApiKey;
  const modelName = config.openaiModel || 'gpt-5-mini';

  if (!apiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'OpenAI APIキーが設定されていません。',
    });
  }

  const appConfig = await getAppConfig();
  const body = await readBody<SortRequestBody>(event);
  if (body.items !== undefined && (!Array.isArray(body.items) || !body.items.every(item => {
    return isObject(item) &&
      typeof item.ts === 'string' &&
      typeof item.text === 'string';
  }))) {
    throw createError({
      statusCode: 400,
      statusMessage: '分類対象アイテムの一覧が必要です。',
    });
  }

  const items = body.items || [];
  if (items.length === 0) {
    return { items: [] };
  }

  try {
    const openai = getOpenAIClient();
    const itemsText = items.map(item => `- [ID: ${item.ts}] ${item.text}`).join('\n');

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: appConfig.systemPrompt },
        {
          role: 'user',
          content: `以下の買い物リストのアイテムを分類してください。

【買い物リスト】
${itemsText}`,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'shopping_list_classification',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                description: '分類されたアイテムのリスト',
                items: {
                  type: 'object',
                  properties: {
                    ts: {
                      type: 'string',
                      description: 'アイテムの一意なID (Slackのts値)',
                    },
                    category: {
                      type: 'string',
                      description: '割り当てられた陳列棚カテゴリー',
                      enum: appConfig.categories,
                    },
                  },
                  required: ['ts', 'category'],
                  additionalProperties: false,
                },
              },
            },
            required: ['items'],
            additionalProperties: false,
          },
        },
      },
    });

    const resultText = response.choices[0]?.message?.content;
    if (!resultText) {
      throw new Error('OpenAI API から空の応答が返されました。');
    }

    const parsedResult = JSON.parse(resultText);
    if (!isObject(parsedResult) || !Array.isArray(parsedResult.items) ||
      !parsedResult.items.every(item => {
        return isObject(item) &&
          typeof item.ts === 'string' &&
          typeof item.category === 'string';
      })) {
      throw new Error('OpenAI API の応答形式が不正です。');
    }

    return {
      items: parsedResult.items,
    };
  } catch (error) {
    console.error('AI分類エラー:', error);
    throw createError({
      statusCode: 500,
      statusMessage: getErrorMessage(error, 'AIによる陳列順ソート処理でエラーが発生しました。'),
    });
  }
});
