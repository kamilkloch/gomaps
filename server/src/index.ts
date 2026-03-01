import express from 'express'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectsRouter } from './routes/projects.js'
import { scrapeRouter } from './routes/scrape.js'
import { placesRouter } from './routes/places.js'
import { shortlistsRouter } from './routes/shortlists.js'
import { testSupportRouter } from './routes/test-support.js'
import { appRuntime } from './runtime.js'

const loadRootEnv = () => {
  const currentDir = dirname(fileURLToPath(import.meta.url))
  const envPath = resolve(currentDir, '../../.env')

  if (!existsSync(envPath)) {
    return
  }

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex <= 0) {
      continue
    }

    const key = trimmed.slice(0, equalsIndex).trim().replace(/^export\s+/, '')
    if (!key || process.env[key]) {
      continue
    }

    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^['\"]|['\"]$/g, '')
    process.env[key] = value
  }
}

loadRootEnv()

const app = express()
const port = process.env.PORT ?? 3180
const isTestBackdoorEnabled = process.env.E2E_TEST_MODE === '1'

app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/projects', projectsRouter)
app.use('/api/scrape', scrapeRouter)
app.use('/api/places', placesRouter)
app.use('/api/shortlists', shortlistsRouter)

if (isTestBackdoorEnabled) {
  app.use('/api/test', testSupportRouter)
}

const server = app.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})

const shutdown = async () => {
  server.close()
  await appRuntime.dispose()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

export { app }
