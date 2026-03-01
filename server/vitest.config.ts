import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {
        statements: 90,
        branches: 83,
        functions: 80,
        lines: 90,
      },
      include: ['src/**/*.ts'],
      exclude: [
        'src/db/types.ts',
        'src/db/index.ts',
        'src/index.ts',
        '**/tests/**',
        '**/*.test.ts',
        '**/*.d.ts',
        '**/dist/**',
        'vitest.config.ts',
      ],
    },
  },
})
