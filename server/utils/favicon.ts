/**
 * 公開ベースURLに応じたファビコンlinkタグ一覧を生成します。
 *
 * @param baseUrl 公開ベースURL
 * @returns headへ挿入するlinkタグ配列
 */
export function buildFaviconHeadLinks(baseUrl: string): string[] {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  return [
    `<link rel="icon" type="image/svg+xml" href="${normalizedBaseUrl}favicon.svg">`,
    `<link rel="icon" href="${normalizedBaseUrl}favicon.ico" sizes="any">`,
    `<link rel="apple-touch-icon" sizes="180x180" href="${normalizedBaseUrl}apple-touch-icon.png">`,
  ];
}

/**
 * 公開ベースURLを先頭および末尾にスラッシュを持つ形式へ正規化します。
 *
 * @param baseUrl 公開ベースURL
 * @returns 正規化済みベースURL
 */
function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/^\/+|\/+$/g, '');
  return trimmed.length === 0 ? '/' : `/${trimmed}/`;
}
