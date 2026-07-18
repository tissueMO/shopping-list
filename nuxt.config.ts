// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint'],
  css: ['~/assets/css/main.css'],
  app: {
    baseURL: '/',
    head: {
      meta: [
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no',
        },
      ],
    },
  },
  runtimeConfig: {
    keepApiUrl: 'http://keep-api:8000',
    openaiApiKey: '',
    openaiModel: 'gpt-5-mini',
    categories: '',
    redisUrl: 'redis://redis:6379',
  },
});
