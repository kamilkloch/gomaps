import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
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
