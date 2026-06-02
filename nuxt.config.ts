// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint'],
  css: ['~/assets/css/main.css'],
  app: {
    baseURL: '/',
  },
  runtimeConfig: {
    slackBotToken: '',
    slackChannelId: '',
    openaiApiKey: '',
    openaiModel: 'gpt-5-mini',
    categories: '',
  },
});
