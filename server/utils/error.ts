/**
 * 値を安全にプロパティ参照できるオブジェクトかどうか判定します。
 *
 * @param value 対象値
 * @returns オブジェクトかどうか
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * エラーからHTTPステータスコードを取り出します。
 *
 * @param error 対象エラー
 * @param fallback 既定値
 * @returns HTTPステータスコード
 */
export function getStatusCode(error: unknown, fallback = 500): number {
  if (!isObject(error)) {
    return fallback;
  }

  return typeof error.statusCode === 'number'
    ? error.statusCode
    : fallback;
}

/**
 * エラーから表示用メッセージを取り出します。
 *
 * @param error 対象エラー
 * @param fallback 既定値
 * @returns 表示用メッセージ
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (!isObject(error)) {
    return fallback;
  }

  return typeof error.message === 'string' && error.message
    ? error.message
    : fallback;
}
