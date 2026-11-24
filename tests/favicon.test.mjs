import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFaviconHeadLinks } from '../server/utils/favicon.ts';

/**
 * 期待するファビコンlinkタグ配列を生成します。
 *
 * @param {string} prefix パス接頭辞
 * @returns {string[]} linkタグ一覧
 */
function expectedLinks(prefix) {
  return [
    `<link rel="icon" type="image/svg+xml" href="${prefix}favicon.svg">`,
    `<link rel="icon" href="${prefix}favicon.ico" sizes="any">`,
    `<link rel="apple-touch-icon" sizes="180x180" href="${prefix}apple-touch-icon.png">`,
  ];
}

test('ルートURLではルート直下のファビコンlinkタグを返す', () => {
  assert.deepEqual(buildFaviconHeadLinks('/'), expectedLinks('/'));
});

test('空文字および空白のみのURLではルート直下へ正規化する', () => {
  assert.deepEqual(buildFaviconHeadLinks(''), expectedLinks('/'));
  assert.deepEqual(buildFaviconHeadLinks('   '), expectedLinks('/'));
});

test('サブディレクトリーURLでは配下のファビコンlinkタグを返す', () => {
  assert.deepEqual(
    buildFaviconHeadLinks('/shopping-list/'),
    expectedLinks('/shopping-list/'),
  );
});

test('先頭または末尾スラッシュが欠けたサブディレクトリーURLを正規化する', () => {
  assert.deepEqual(
    buildFaviconHeadLinks('/shopping-list'),
    expectedLinks('/shopping-list/'),
  );
  assert.deepEqual(
    buildFaviconHeadLinks('shopping-list'),
    expectedLinks('/shopping-list/'),
  );
});
