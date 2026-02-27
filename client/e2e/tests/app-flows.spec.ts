import { createExplorerPage } from '../pages/explorer-page'
import { createProjectsPage } from '../pages/projects-page'
import { createSetupPage } from '../pages/setup-page'
import { captureStepScreenshot } from '../utils/screenshots'
import { resolveLocator } from '../utils/locators'
import { expect, test } from '../fixtures/base'
import type { Page, Route } from '@playwright/test'

interface MockProject {
  id: string
  name: string
  bounds: string | null
  createdAt: string
}

interface MockRun {
  id: string
  projectId: string
  query: string
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed'
  tilesTotal: number
  tilesCompleted: number
  tilesSubdivided: number
  placesFound: number
  placesUnique: number
  startedAt: string | null
  completedAt: string | null
}

const FIXED_CREATED_AT = '2026-02-27T20:00:00.000Z'
const FIXED_STARTED_AT = '2026-02-27T20:05:00.000Z'

test.describe('core app flows', () => {
  test('project CRUD and route navigation', async ({ page }, testInfo) => {
    await installMockApi(page, { projects: [] })

    const projectsPage = createProjectsPage(page)
    await captureStepScreenshot(page, testInfo, 'projects-before-navigation')
    await projectsPage.goto()
    await captureStepScreenshot(page, testInfo, 'projects-after-navigation')

    await projectsPage.createProject('Sardinia Summer 2026')
    const createdCard = await projectsPage.projectCard('project-1')
    await expect(createdCard).toBeVisible()

    await createdCard.getByRole('heading', { name: 'Sardinia Summer 2026' }).click()
    await expect(page).toHaveURL(/\/projects\/project-1\/setup$/)

    const navExplorer = await resolveLocator(page, {
      testId: 'nav-explorer',
      role: 'link',
      name: /explorer/i,
      text: 'Explorer',
      defectLabel: 'Explorer navigation link',
    })
    await navExplorer.click()
    await expect(page).toHaveURL(/\/explorer$/)

    const navProjects = await resolveLocator(page, {
      testId: 'nav-projects',
      role: 'link',
      name: /projects/i,
      text: 'Projects',
      defectLabel: 'Projects navigation link',
    })
    await navProjects.click()
    await projectsPage.deleteProject('project-1')
    await expect(page.getByTestId('project-card-project-1')).toHaveCount(0)
  })

  test('setup flow renders run progress and pause/resume controls', async ({ page }, testInfo) => {
    await installMockApi(page, {
      projects: [
        {
          id: 'project-setup',
          name: 'Setup Demo',
          bounds: JSON.stringify({
            sw: { lat: 40.1, lng: 9.1 },
            ne: { lat: 40.4, lng: 9.5 },
          }),
          createdAt: FIXED_CREATED_AT,
        },
      ],
      runs: [],
    })

    const setupPage = createSetupPage(page)
    await setupPage.goto('project-setup')
    await captureStepScreenshot(page, testInfo, 'setup-initial')

    await expect(page.getByTestId('setup-page')).toBeVisible()
    await expect(page.getByTestId('setup-coordinates-pill')).toBeVisible()

    await setupPage.startScrape('hotel with pool')
    await captureStepScreenshot(page, testInfo, 'setup-after-start')

    await expect(page.getByTestId('setup-runs-section')).toContainText('hotel with pool')
    await expect(page.getByTestId('setup-progress-section')).toBeVisible()

    await setupPage.pauseOrResumeRun()
    await expect(page.getByTestId('setup-pause-resume-button')).toContainText(/resume|pause/i)

    await setupPage.clearSelection()
    await expect(page.getByTestId('setup-coordinates-pill')).toHaveCount(0)
    await expect(page.getByTestId('setup-status-copy')).toContainText('No area selected yet')
  })

  test('explorer table search and row selection', async ({ page }, testInfo) => {
    await installMockApi(page, {
      projects: [
        {
          id: 'project-1',
          name: 'Explorer Demo',
          bounds: JSON.stringify({
            sw: { lat: 40.0, lng: 9.0 },
            ne: { lat: 40.7, lng: 9.8 },
          }),
          createdAt: FIXED_CREATED_AT,
        },
        {
          id: 'project-2',
          name: 'Backup Demo',
          bounds: null,
          createdAt: FIXED_CREATED_AT,
        },
      ],
      placesByProject: {
        'project-1': [
          {
            id: 'place-1',
            googleMapsUri: 'https://maps.google.com/?cid=1',
            name: 'Garden Suites',
            category: 'Hotel',
            rating: 4.6,
            reviewCount: 220,
            priceLevel: '$$$',
            phone: null,
            website: 'https://garden.example',
            websiteType: 'direct',
            address: 'Via Roma 10',
            lat: 40.2,
            lng: 9.2,
            photoUrls: '[]',
            openingHours: null,
            amenities: '[]',
            scrapedAt: FIXED_CREATED_AT,
          },
          {
            id: 'place-2',
            googleMapsUri: 'https://maps.google.com/?cid=2',
            name: 'Blue Harbor Rooms',
            category: 'B&B',
            rating: 4.1,
            reviewCount: 120,
            priceLevel: '$$',
            phone: null,
            website: 'https://booking.com/example',
            websiteType: 'ota',
            address: 'Harbor street',
            lat: 40.3,
            lng: 9.3,
            photoUrls: '[]',
            openingHours: null,
            amenities: '[]',
            scrapedAt: FIXED_CREATED_AT,
          },
        ],
        'project-2': [],
      },
    })

    const explorerPage = createExplorerPage(page)
    await explorerPage.goto('project-1')
    await captureStepScreenshot(page, testInfo, 'explorer-initial')

    await expect(page.getByTestId('explorer-table-count')).toContainText('2 places')
    await expect(page.getByTestId('explorer-detail-name')).toContainText('Garden Suites')

    await explorerPage.search('harbor')
    await expect(page.getByTestId('explorer-table-count')).toContainText('1 places')

    await explorerPage.clickRow('place-2')
    await expect(page.getByTestId('explorer-detail-name')).toContainText('Blue Harbor Rooms')
    await expect(page.getByTestId('explorer-row-place-2')).toHaveAttribute('data-selected', 'true')

    await explorerPage.selectProject('project-2')
    await expect(page).toHaveURL(/\/projects\/project-2\/explorer$/)
    await captureStepScreenshot(page, testInfo, 'explorer-after-project-switch')
  })
})

interface MockApiOptions {
  projects: MockProject[]
  runs?: MockRun[]
  placesByProject?: Record<string, unknown[]>
}

async function installMockApi(page: Page, options: MockApiOptions): Promise<void> {
  let projectCounter = options.projects.length
  const projects = [...options.projects]
  const runs = [...(options.runs ?? [])]
  const placesByProject = { ...(options.placesByProject ?? {}) }

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const requestUrl = new URL(request.url())
    const path = requestUrl.pathname

    if (path === '/api/projects' && request.method() === 'GET') {
      await json(route, 200, projects)
      return
    }

    if (path === '/api/projects' && request.method() === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}') as { name?: string }
      projectCounter += 1
      const created: MockProject = {
        id: `project-${projectCounter}`,
        name: body.name ?? `Project ${projectCounter}`,
        bounds: null,
        createdAt: FIXED_CREATED_AT,
      }
      projects.push(created)
      placesByProject[created.id] = []
      await json(route, 201, created)
      return
    }

    if (path.startsWith('/api/projects/') && request.method() === 'GET') {
      const projectId = path.split('/').at(-1) ?? ''
      const project = projects.find((item) => item.id === projectId)
      await json(route, project ? 200 : 404, project ?? { error: 'Project not found' })
      return
    }

    if (path.startsWith('/api/projects/') && request.method() === 'PUT') {
      const projectId = path.split('/').at(-1) ?? ''
      const project = projects.find((item) => item.id === projectId)
      if (!project) {
        await json(route, 404, { error: 'Project not found' })
        return
      }

      const body = JSON.parse(request.postData() ?? '{}') as { name?: string; bounds?: string }
      if (body.name !== undefined) {
        project.name = body.name
      }
      if (body.bounds !== undefined) {
        project.bounds = body.bounds || null
      }

      await json(route, 200, project)
      return
    }

    if (path.startsWith('/api/projects/') && request.method() === 'DELETE') {
      const projectId = path.split('/').at(-1) ?? ''
      const index = projects.findIndex((item) => item.id === projectId)
      if (index >= 0) {
        projects.splice(index, 1)
      }
      delete placesByProject[projectId]
      await route.fulfill({ status: 204, body: '' })
      return
    }

    if (path === '/api/scrape' && request.method() === 'GET') {
      const projectId = requestUrl.searchParams.get('projectId')
      await json(route, 200, runs.filter((run) => run.projectId === projectId))
      return
    }

    if (path === '/api/scrape/start' && request.method() === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}') as { projectId: string; query: string }
      const runId = `run-${runs.length + 1}`
      const started: MockRun = {
        id: runId,
        projectId: body.projectId,
        query: body.query,
        status: 'running',
        tilesTotal: 52,
        tilesCompleted: 10,
        tilesSubdivided: 2,
        placesFound: 44,
        placesUnique: 38,
        startedAt: FIXED_STARTED_AT,
        completedAt: null,
      }
      runs.unshift(started)
      await json(route, 202, { scrapeRunId: runId })
      return
    }

    if (path.match(/^\/api\/scrape\/[^/]+$/) && request.method() === 'GET') {
      const runId = path.split('/').at(-1) ?? ''
      const run = runs.find((item) => item.id === runId)
      if (!run) {
        await json(route, 404, { error: 'Scrape run not found' })
        return
      }

      await json(route, 200, {
        scrapeRunId: run.id,
        status: run.status,
        tilesTotal: run.tilesTotal,
        tilesCompleted: run.tilesCompleted,
        tilesSubdivided: run.tilesSubdivided,
        placesFound: run.placesFound,
        placesUnique: run.placesUnique,
        elapsedMs: 120_000,
      })
      return
    }

    if (path.match(/^\/api\/scrape\/[^/]+\/tiles$/) && request.method() === 'GET') {
      await json(route, 200, [])
      return
    }

    if (path.match(/^\/api\/scrape\/[^/]+\/pause$/) && request.method() === 'POST') {
      const runId = path.split('/')[3]
      const run = runs.find((item) => item.id === runId)
      if (run) {
        run.status = 'paused'
      }
      await json(route, 202, { status: 'pausing' })
      return
    }

    if (path.match(/^\/api\/scrape\/[^/]+\/resume$/) && request.method() === 'POST') {
      const runId = path.split('/')[3]
      const run = runs.find((item) => item.id === runId)
      if (run) {
        run.status = 'running'
      }
      await json(route, 200, { status: 'running' })
      return
    }

    if (path.match(/^\/api\/scrape\/[^/]+\/progress$/) && request.method() === 'GET') {
      const runId = path.split('/')[3]
      const run = runs.find((item) => item.id === runId)
      if (!run) {
        await json(route, 404, { error: 'Scrape run not found' })
        return
      }

      const payload = {
        scrapeRunId: run.id,
        status: run.status,
        tilesTotal: run.tilesTotal,
        tilesCompleted: run.tilesCompleted,
        tilesSubdivided: run.tilesSubdivided,
        placesFound: run.placesFound,
        placesUnique: run.placesUnique,
        elapsedMs: 120_000,
      }
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        },
        body: `data: ${JSON.stringify(payload)}\n\n`,
      })
      return
    }

    if (path === '/api/places' && request.method() === 'GET') {
      const projectId = requestUrl.searchParams.get('projectId') ?? ''
      await json(route, 200, placesByProject[projectId] ?? [])
      return
    }

    await json(route, 404, { error: `Unhandled mock API route: ${request.method()} ${path}` })
  })
}

async function json(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}
