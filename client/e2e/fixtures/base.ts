import { test as base } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'

interface TestFixtures {
  context: BrowserContext
  page: Page
}

const severeConsolePattern = /errorboundary|uncaught|typeerror|referenceerror|unhandled/i

const test = base.extend<TestFixtures>({
  context: async ({ browser }, use) => {
    const context = await browser.newContext()
    await context.clearCookies()
    await context.addInitScript(() => {
      window.localStorage.clear()
      window.sessionStorage.clear()
    })
    await use(context)
    await context.close()
  },
  page: async ({ context }, use) => {
    const page = await context.newPage()
    const severeErrors: string[] = []

    page.on('pageerror', (exception) => {
      severeErrors.push(`pageerror: ${exception.message}`)
    })

    page.on('console', (message) => {
      if (message.type() !== 'error') {
        return
      }

      const text = message.text()
      if (severeConsolePattern.test(text)) {
        severeErrors.push(`console: ${text}`)
      }
    })

    await use(page)

    if (severeErrors.length > 0) {
      throw new Error(`Severe browser errors captured:\n${severeErrors.join('\n')}`)
    }
  },
})

const expect = test.expect

export { expect, test }
