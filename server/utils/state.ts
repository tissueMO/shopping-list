import fs from 'node:fs/promises';
import path from 'node:path';
import Redis from 'ioredis';
import OpenAI from 'openai';

interface AppConfig {
  categories: string[];
  systemPrompt: string;
}

const CATEGORY_CACHE_KEY = 'shopping-list:category-cache';

/**
 * サーバー側で一時的に保持する選択済みアイテムIDです。
 */
export const checkedItemIds = new Set<string>();

let openaiClient: OpenAI | null = null;
let redisClient: Redis | null = null;
let cachedConfig: AppConfig | null = null;

/**
 * Google Keep APIサーバーのURLを取得します。
 *
 * @returns Keep APIサーバーのベースURL
 */
export function getKeepApiUrl(): string {
  const config = useRuntimeConfig();
  const url = String(config.keepApiUrl).replace(/\/+$/, '');
  if (!url) {
    throw new Error('Google Keep APIのURLが設定されていません。');
  }
  return url;
}

/**
 * OpenAI APIクライアントを取得します。
 *
 * @returns OpenAI APIクライアント
 */
export function getOpenAIClient(): OpenAI {
  if (openaiClient === null) {
    const config = useRuntimeConfig();
    const apiKey = config.openaiApiKey;
    if (!apiKey) {
      throw new Error('OpenAI APIキーが設定されていません。');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

/**
 * アプリケーションの設定情報を取得します。
 *
 * @returns 設定オブジェクト
 */
export async function getAppConfig(): Promise<AppConfig> {
  if (cachedConfig !== null) {
    return cachedConfig;
  }

  const config = useRuntimeConfig();
  const rawCategories = config.categories || '';

  const categories = String(rawCategories)
    .split(',')
    .map(category => category.trim())
    .filter(category => category.length > 0);
  if (categories.length === 0) {
    throw new Error('買い物カテゴリーが設定されていません。');
  }

  const promptPath = path.resolve(process.cwd(), 'config/system_prompt.md');
  const systemPrompt = await fs.readFile(promptPath, 'utf-8');

  cachedConfig = {
    categories,
    systemPrompt,
  };
  return cachedConfig;
}

/**
 * Redisクライアントを取得します。
 *
 * @returns Redisクライアントインスタンス
 */
export function getRedisClient(): Redis {
  if (redisClient === null) {
    const config = useRuntimeConfig();
    redisClient = new Redis(config.redisUrl);
    redisClient.on('error', (error) => {
      console.error('Redis接続エラー:', error);
    });
  }
  return redisClient;
}

/**
 * Redisから名前とカテゴリーのキャッシュマッピングをすべて取得します。
 *
 * @returns カテゴリーキャッシュオブジェクト
 */
export async function getCategoryCache(): Promise<Record<string, string>> {
  const redis = getRedisClient();
  return await redis.hgetall(CATEGORY_CACHE_KEY);
}

/**
 * Redisに新たなカテゴリーキャッシュマッピングを追加保存します。
 *
 * @param newEntries 保存する新規キャッシュエントリ
 */
export async function saveCategoryCache(newEntries: Record<string, string>): Promise<void> {
  if (Object.keys(newEntries).length === 0) {
    return;
  }

  const redis = getRedisClient();
  await redis.hset(CATEGORY_CACHE_KEY, newEntries);
}
