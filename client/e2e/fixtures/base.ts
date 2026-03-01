import { test as base } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resetDatabaseForE2E } from '../utils/test-backdoor'

interface TestFixtures {
  context: BrowserContext
  page: Page
  resetDatabase: void
}

const severeConsolePattern = /errorboundary|uncaught|typeerror|referenceerror|unhandled/i

const test = base.extend<TestFixtures>({
  resetDatabase: [
    async ({ request }, use) => {
      await resetDatabaseForE2E(request)
      await use()
    },
    { auto: true },
  ],
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
  page: async ({ context, browserName }, use, testInfo) => {
    const page = await context.newPage()
    const severeErrors: string[] = []
    const shouldCaptureCoverage = process.env.PW_E2E_COVERAGE === '1' && browserName === 'chromium'

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

    if (shouldCaptureCoverage) {
      await page.coverage.startJSCoverage({
        resetOnNavigation: false,
        reportAnonymousScripts: false,
      })
    }

    await use(page)

    if (shouldCaptureCoverage) {
      const entries = await page.coverage.stopJSCoverage()
      const safeTestId = testInfo.testId.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
      const rawCoverageDir = join(process.cwd(), 'e2e/coverage/raw')
      const fileName = `${safeTestId}-w${testInfo.workerIndex}-r${testInfo.retry}.json`
      mkdirSync(rawCoverageDir, { recursive: true })
      writeFileSync(join(rawCoverageDir, fileName), JSON.stringify(entries), 'utf8')
    }

    if (severeErrors.length > 0) {
      throw new Error(`Severe browser errors captured:\n${severeErrors.join('\n')}`)
    }
  },
})

const expect = test.expect

export { expect, test }
