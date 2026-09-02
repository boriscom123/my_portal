// Правила стиля для всего репозитория. Задача — держать код в кадре
// одинаковым: репозиторий показательный, разнобой в нём заметнее, чем в
// обычном. Плоский конфиг — формат ESLint 9, .eslintrc больше не читается.
// Вызывается из `npm run lint` и из CI.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'public/vendor/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: 'error',
      'no-console': 'off'
    }
  },
  {
    // Клиентский код исполняется браузером, а не Node: там свои глобальные
    // объекты, и Node-овских нет.
    files: ['public/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.serviceworker } }
  }
];
