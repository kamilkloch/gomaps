import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Page, TestInfo } from '@playwright/test'

export async function captureStepScreenshot(page: Page, testInfo: TestInfo, stepName: string): Promise<void> {
  const safeStepName = stepName.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
  const screenshotDir = testInfo.outputPath('screenshots')
  mkdirSync(screenshotDir, { recursive: true })

  await page.screenshot({
    path: join(screenshotDir, `${safeStepName}.png`),
    fullPage: true,
  })
}
