import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      '.atl/**',
      '.agents/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'eslint.config.js',
            'vitest.config.ts',
            'dependency-cruiser.config.cjs',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/packages/**', '../packages/**', '../../packages/**'],
              message:
                'Do not import packages via relative physical paths. Use the public package name (e.g. @busca-ofertas-ai/core).',
            },
            {
              group: ['@busca-ofertas-ai/*/src/**', '@busca-ofertas-ai/*/dist/**'],
              message:
                'Do not import internal package paths. Use the public package entrypoint (e.g. @busca-ofertas-ai/core).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/**/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@busca-ofertas-ai/*/src/**', '@busca-ofertas-ai/*/dist/**'],
              message:
                'Do not import internal package paths. Use the public package entrypoint (e.g. @busca-ofertas-ai/core).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        AbortController: 'readonly',
        URL: 'readonly',
        Date: 'readonly',
      },
    },
  },
  {
    files: ['**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        module: 'readonly',
        exports: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  },
);
