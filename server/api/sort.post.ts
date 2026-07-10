import { defineEventHandler, readBody } from 'h3';
import { getErrorMessage, isObject } from '../utils/error';
import { getOpenAIClient, getAppConfig, getCategoryCache, saveCategoryCache } from '../utils/state';

interface SortRequestBody {
  items?: unknown;
}

interface SortItem {
  ts: string;
  text: string;
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
  const modelName = config.openaiModel || 'gpt-5-mini';
  const body: unknown = await readBody<SortRequestBody>(event);
  const items = parseItems(isObject(body) ? body.items : undefined);
  if (items.length === 0) {
    return { items: [] };
  }

  try {
    const appConfig = await getAppConfig();
    const categorySet = new Set(appConfig.categories);
    const cache = await getCategoryCache();
    const knownCategories = Object.fromEntries(
      Object.entries(cache).filter(([, category]) => categorySet.has(category)),
    );
    const unclassifiedItems = getUnclassifiedItems(items, knownCategories);

    if (unclassifiedItems.length > 0) {
      const newCategories = await classifyItems(
        unclassifiedItems,
        appConfig.categories,
        appConfig.systemPrompt,
        modelName,
      );
      Object.assign(knownCategories, newCategories);
      await saveCategoryCache(newCategories);
    }

    return {
      items: createResponseItems(items, knownCategories),
    };
  } catch (error) {
    console.error('AI分類エラー:', error);
    throw createError({
      statusCode: 500,
      statusMessage: getErrorMessage(error, 'AIによる陳列順ソート処理でエラーが発生しました。'),
    });
  }
});

/**
 * 要求本文から分類対象を取り出します。
 *
 * @param value 分類対象候補
 * @returns 検証済みの分類対象
 */
function parseItems(value: unknown): SortItem[] {
  if (!Array.isArray(value) || !value.every(isSortItem)) {
    throw createError({
      statusCode: 400,
      statusMessage: '分類対象アイテムの一覧が必要です。',
    });
  }

  const itemIds = new Set(value.map(item => item.ts));
  if (itemIds.size !== value.length) {
    throw createError({
      statusCode: 400,
      statusMessage: '分類対象アイテムのIDが重複しています。',
    });
  }

  return value;
}

/**
 * 値が分類対象の形式かどうかを判定します。
 *
 * @param value 判定対象値
 * @returns 分類対象の形式かどうか
 */
function isSortItem(value: unknown): value is SortItem {
  return isObject(value) &&
    typeof value.ts === 'string' && value.ts.length > 0 &&
    typeof value.text === 'string' && value.text.trim().length > 0;
}

/**
 * アイテム名が重複しない未分類アイテムを取り出します。
 *
 * @param items 分類対象アイテム
 * @param knownCategories 分類済みカテゴリー
 * @returns 未分類アイテム
 */
function getUnclassifiedItems(
  items: SortItem[],
  knownCategories: Record<string, string>,
): SortItem[] {
  const itemsByText = new Map<string, SortItem>();
  items.forEach(item => {
    if (knownCategories[item.text] === undefined) {
      itemsByText.set(item.text, item);
    }
  });
  return Array.from(itemsByText.values());
}

/**
 * 入力順を保った分類結果を作成します。
 *
 * @param items 分類対象アイテム
 * @param knownCategories 分類済みカテゴリー
 * @returns APIへ返す分類結果
 */
function createResponseItems(
  items: SortItem[],
  knownCategories: Record<string, string>,
): SortResponseItem[] {
  return items.map(item => {
    const category = knownCategories[item.text];
    if (category === undefined) {
      throw new Error(`分類結果がありません: ${item.text}`);
    }
    return { ts: item.ts, category };
  });
}

/**
 * 未分類アイテムをOpenAIで分類します。
 *
 * @param items 未分類アイテム
 * @param categories 分類先カテゴリー
 * @param systemPrompt システムプロンプト
 * @param modelName OpenAIモデル名
 * @returns アイテム名と新しいカテゴリーの対応
 */
async function classifyItems(
  items: SortItem[],
  categories: string[],
  systemPrompt: string,
  modelName: string,
): Promise<Record<string, string>> {
  const openai = getOpenAIClient();
  const itemList = items.map(item => `- [ID: ${item.ts}] ${item.text}`).join('\n');
  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `以下の買い物リストのアイテムを分類してください。

【買い物リスト】
${itemList}`,
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
                    description: 'アイテムの一意なID',
                  },
                  category: {
                    type: 'string',
                    description: '割り当てられたカテゴリー',
                    enum: categories,
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
    throw new Error('OpenAI APIから空の応答が返されました。');
  }

  return parseClassification(resultText, items, new Set(categories));
}

/**
 * OpenAIの応答を検証してアイテム名ごとのカテゴリーへ変換します。
 *
 * @param resultText OpenAIの応答本文
 * @param items 分類対象アイテム
 * @param categorySet 設定されたカテゴリー
 * @returns アイテム名とカテゴリーの対応
 */
function parseClassification(
  resultText: string,
  items: SortItem[],
  categorySet: Set<string>,
): Record<string, string> {
  const parsedResult: unknown = JSON.parse(resultText);
  if (!isObject(parsedResult) || !Array.isArray(parsedResult.items)) {
    throw new Error('OpenAI APIの応答形式が不正です。');
  }

  const itemsById = new Map(items.map(item => [item.ts, item]));
  const categoriesByText: Record<string, string> = {};
  const receivedIds = new Set<string>();
  parsedResult.items.forEach(item => {
    const originalItem = isObject(item) && typeof item.ts === 'string'
      ? itemsById.get(item.ts)
      : undefined;
    if (!isObject(item) ||
      typeof item.ts !== 'string' ||
      typeof item.category !== 'string' ||
      originalItem === undefined ||
      !categorySet.has(item.category) ||
      receivedIds.has(item.ts)) {
      throw new Error('OpenAI APIの応答内容が不正です。');
    }

    receivedIds.add(item.ts);
    categoriesByText[originalItem.text] = item.category;
  });

  if (receivedIds.size !== items.length) {
    throw new Error('OpenAI APIの応答に未分類のアイテムがあります。');
  }

  return categoriesByText;
}
