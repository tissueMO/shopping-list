import fs from 'node:fs/promises';
import path from 'node:path';
import { WebClient } from '@slack/web-api';
import Redis from 'ioredis';
import OpenAI from 'openai';

interface AppConfig {
  categories: string[];
  systemPrompt: string;
}

const CATEGORY_CACHE_KEY = 'shopping-list:category-cache';

/**
 * サーバー側で一時的に保持するチェック済みメッセージIDです。
 */
export const checkedItems = new Set<string>();

/**
 * ユーザーIDから表示名への対応です。
 */
const userNameCache = new Map<string, string>();

/**
 * ボットIDから表示名への対応です。
 */
const botNameCache = new Map<string, string>();

let slackClient: WebClient | null = null;
let openaiClient: OpenAI | null = null;
let redisClient: Redis | null = null;
let cachedConfig: AppConfig | null = null;

/**
 * Slack Web APIクライアントを取得します。
 *
 * @returns Slack Web APIクライアント
 */
export function getSlackClient(): WebClient {
  if (slackClient === null) {
    const config = useRuntimeConfig();
    const token = config.slackBotToken;
    if (!token) {
      throw new Error('Slackボットトークンが設定されていません。');
    }
    slackClient = new WebClient(token);
  }
  return slackClient;
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
 * SlackのユーザーIDから表示名を取得します。
 *
 * @param userId ユーザーID
 * @returns ユーザーの表示名
 */
export async function getUserName(userId: string): Promise<string> {
  const cachedName = userNameCache.get(userId);
  if (cachedName !== undefined) {
    return cachedName;
  }

  try {
    const client = getSlackClient();
    const res = await client.users.info({ user: userId });
    if (res.ok && res.user) {
      const name = res.user.profile?.display_name || res.user.real_name || res.user.name || userId;
      userNameCache.set(userId, name);
      return name;
    }
  } catch (error) {
    console.error(`Slackユーザー情報の取得に失敗しました: ${userId}`, error);
  }

  return userId;
}

/**
 * SlackのボットIDからボット名を取得します。
 *
 * @param botId ボットID
 * @returns ボット名
 */
export async function getBotName(botId: string): Promise<string> {
  const cachedName = botNameCache.get(botId);
  if (cachedName !== undefined) {
    return cachedName;
  }

  try {
    const client = getSlackClient();
    const res = await client.bots.info({ bot: botId });
    if (res.ok && res.bot) {
      const name = res.bot.name || botId;
      botNameCache.set(botId, name);
      return name;
    }
  } catch (error) {
    console.error(`Slackボット情報の取得に失敗しました: ${botId}`, error);
  }

  return botId;
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
