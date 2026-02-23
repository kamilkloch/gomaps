import { describe, it, expect } from 'vitest'

describe('health', () => {
  it('server module exports app', async () => {
    const { app } = await import('../src/index.js')
    expect(app).toBeDefined()
  })
})
