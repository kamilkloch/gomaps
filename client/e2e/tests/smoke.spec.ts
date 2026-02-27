import { createProjectsPage } from '../pages/projects-page'
import { captureStepScreenshot } from '../utils/screenshots'
import { expect, test } from '../fixtures/base'

test('projects page renders from root route', async ({ page }, testInfo) => {
  const projectsPage = createProjectsPage(page)

  await captureStepScreenshot(page, testInfo, 'step-1-before-navigation')
  await projectsPage.goto()
  await captureStepScreenshot(page, testInfo, 'step-2-after-navigation')

  await expect(await projectsPage.root()).toBeVisible()
  await expect(await projectsPage.heading()).toHaveText('Projects')
})
