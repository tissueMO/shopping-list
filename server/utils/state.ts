import fs from 'node:fs/promises';
import path from 'node:path';
import { WebClient } from '@slack/web-api';
import OpenAI from 'openai';

/**
 * サーバー側で一時的に保持するチェック済みメッセージIDと登録日時のマップ。
 */
export const checkedItems = new Map<string, number>();

/**
 * ユーザーIDから表示名へのキャッシュ用マップです。
 */
const userNameCache = new Map<string, string>();

/**
 * ボットIDから表示名へのキャッシュ用マップです。
 */
const botNameCache = new Map<string, string>();

/**
 * Slack Web API クライアントを取得します。
 *
 * @returns クライアントインスタンス
 */
let slackClient: WebClient | null = null;
export function getSlackClient(): WebClient {
  if (!slackClient) {
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
 * OpenAI API クライアントを取得します。
 *
 * @returns クライアントインスタンス
 */
let openaiClient: OpenAI | null = null;
export function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
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
  if (userNameCache.has(userId)) {
    return userNameCache.get(userId) || userId;
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
  if (botNameCache.has(botId)) {
    return botNameCache.get(botId) || botId;
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

interface AppConfig {
  categories: string[];
  systemPrompt: string;
}

let cachedConfig: AppConfig | null = null;

/**
 * アプリケーションの設定情報を取得します。
 *
 * @returns 設定オブジェクト
 */
export async function getAppConfig(): Promise<AppConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const config = useRuntimeConfig();
  const rawCategories = config.categories || '';

  const categories = rawCategories
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  try {
    const configDir = path.resolve(process.cwd(), 'config');
    const promptPath = path.resolve(configDir, 'system_prompt.md');

    const systemPrompt = await fs.readFile(promptPath, 'utf-8');

    cachedConfig = {
      categories,
      systemPrompt,
    };
    return cachedConfig;
  } catch (error) {
    console.error('システムプロンプトの読み込みに失敗しました。既定値を使用します:', error);
    cachedConfig = {
      categories,
      systemPrompt: 'あなたは買い物リストの整理アシスタントです。',
    };
    return cachedConfig;
  }
}
