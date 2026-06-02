import { defineEventHandler, readBody } from 'h3';
import { getOpenAIClient, getAppConfig } from '../utils/state';

/**
 * 買い物リストのアイテムをスーパーの一般的な陳列棚カテゴリーに分類します。
 * 
 * @returns 分類されたアイテムのリスト
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const apiKey = config.openaiApiKey;
  const modelName = config.openaiModel || 'gpt-5-mini';

  if (!apiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'NUXT_OPENAI_API_KEY is not configured.',
    });
  }

  const appConfig = await getAppConfig();
  const body = await readBody(event);
  const { items } = body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return { items: [] };
  }

  // OpenAI送信用のテキスト準備
  const itemsText = items.map((item) => `- [ID: ${item.ts}] ${item.text}`).join('\n');

  try {
    const openai = getOpenAIClient();

    const userPrompt = `以下の買い物リストのアイテムを分類してください。

【買い物リスト】
${itemsText}`;

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: appConfig.systemPrompt },
        { role: 'user', content: userPrompt },
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
    return {
      items: parsedResult.items || [],
    };
  } catch (error) {
    console.error('Error categorizing items via OpenAI:', error);
    const err = error as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    throw createError({
      statusCode: 500,
      statusMessage: err.message || 'AIによる陳列順ソート処理でエラーが発生しました。',
    });
  }
});
