import { defineNitroPlugin } from 'nitropack/runtime';
import { buildFaviconHeadLinks } from '../utils/favicon';

/**
 * HTML描画時に公開ベースURLへ合わせたファビコン用linkタグを挿入します。
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', (html, { event }) => {
    const config = useRuntimeConfig(event);
    const links = buildFaviconHeadLinks(String(config.app?.baseURL ?? '/'));
    html.head.push(...links);
  });
});
