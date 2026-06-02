import withNuxt from './.nuxt/eslint.config.mjs';

export default withNuxt([
  {
    rules: {
      'semi': ['error', 'always'],
      'comma-dangle': ['error', 'always-multiline'],
    },
  },
]);
