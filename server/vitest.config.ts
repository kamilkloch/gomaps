import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {
        statements: 88,
        branches: 82,
        functions: 73,
        lines: 88,
      },
      include: ['src/**/*.ts'],
      exclude: [
        '**/tests/**',
        '**/*.test.ts',
        '**/*.d.ts',
        '**/dist/**',
        'vitest.config.ts',
      ],
    },
  },
})
