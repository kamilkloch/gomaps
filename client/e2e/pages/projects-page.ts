import { resolveLocator } from '../utils/locators'
import { expect } from '../fixtures/base'
import { waitForProjectsPageReady, waitForSetupPageReady, waitForVisible } from '../utils/waiters'
import type { Locator, Page } from '@playwright/test'

class ProjectsPageObject {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/')
    await waitForProjectsPageReady(this.page)
  }

  async root(): Promise<Locator> {
    const locator = await resolveLocator(this.page, {
      testId: 'projects-page',
      role: 'main',
      text: 'Projects',
      defectLabel: 'Projects page root container',
    })
    await waitForVisible(locator)
    return locator
  }

  async heading(): Promise<Locator> {
    const locator = await resolveLocator(this.page, {
      testId: 'projects-page-title',
      role: 'heading',
      name: 'Projects',
      text: 'Projects',
      defectLabel: 'Projects page heading',
    })
    await waitForVisible(locator)
    return locator
  }

  async newProjectButton(): Promise<Locator> {
    const locator = await resolveLocator(this.page, {
      testId: 'projects-new-button',
      role: 'button',
      name: /new project/i,
      text: '+ New Project',
      defectLabel: 'New project button',
    })
    await waitForVisible(locator)
    return locator
  }

  async createProject(name: string): Promise<void> {
    const newProjectButton = await this.newProjectButton()
    await newProjectButton.click()

    const nameInput = await resolveLocator(this.page, {
      testId: 'projects-create-name-input',
      role: 'textbox',
      name: /project name/i,
      defectLabel: 'Project name input',
    })
    await waitForVisible(nameInput)
    await nameInput.fill(name)

    const submitButton = await resolveLocator(this.page, {
      testId: 'projects-create-submit',
      role: 'button',
      name: /^create$/i,
      text: 'Create',
      defectLabel: 'Create project submit button',
    })

    const createResponsePromise = this.page.waitForResponse((response) =>
      response.url().includes('/api/projects')
      && response.request().method() === 'POST'
    )

    await submitButton.click()
    const createResponse = await createResponsePromise
    expect(createResponse.status(), 'project creation API should return 201').toBe(201)
    await waitForProjectsPageReady(this.page)

    const projectsError = this.page.getByTestId('projects-error')
    await expect(projectsError).toHaveCount(0)

    const projectHeading = this.page.getByRole('heading', { name })
    await expect(projectHeading).toBeVisible()
  }

  async projectCard(projectId: string): Promise<Locator> {
    const locator = this.page.getByTestId(`project-card-${projectId}`)
    await waitForVisible(locator)
    return locator
  }

  async openProjectByName(name: string): Promise<void> {
    const heading = await resolveLocator(this.page, {
      role: 'heading',
      name,
      text: name,
      defectLabel: `Project card heading for ${name}`,
    })
    await heading.click()
    await waitForSetupPageReady(this.page)
  }

  async deleteProject(projectId: string): Promise<void> {
    this.page.once('dialog', (dialog) => dialog.accept())
    const deleteButton = this.page.getByTestId(`project-delete-${projectId}`)
    await waitForVisible(deleteButton)
    await deleteButton.click()
    await expect(this.page.getByTestId(`project-card-${projectId}`)).toHaveCount(0)
  }
}

export function createProjectsPage(page: Page): ProjectsPageObject {
  return new ProjectsPageObject(page)
}
