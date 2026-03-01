import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from '@babel/parser'
import { convert } from 'ast-v8-to-istanbul'
import libCoverage from 'istanbul-lib-coverage'
import libReport from 'istanbul-lib-report'
import reports from 'istanbul-reports'

const { createCoverageMap } = libCoverage
const { createContext } = libReport

const scriptFile = fileURLToPath(import.meta.url)
const clientRoot = resolve(dirname(scriptFile), '..', '..')
const coverageRoot = resolve(clientRoot, 'e2e/coverage')
const rawCoverageDir = resolve(coverageRoot, 'raw')
const outputDir = resolve(coverageRoot, 'lcov-report')
const outputFile = 'lcov.info'

const allowedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx'])

const isCoveredSourceFile = (urlString) => {
  let parsedUrl
  try {
    parsedUrl = new URL(urlString)
  }
  catch {
    return null
  }

  const pathname = decodeURIComponent(parsedUrl.pathname)
  if (!pathname.startsWith('/src/')) {
    return null
  }

  const extension = extname(pathname)
  if (!allowedExtensions.has(extension)) {
    return null
  }

  const filePath = resolve(clientRoot, `.${pathname}`)
  return {
    filePath,
    fileUrl: pathToFileURL(filePath).href,
  }
}

const listRawCoverageFiles = (dir) => {
  if (!existsSync(dir)) {
    return []
  }

  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => join(dir, name))
    .filter((filePath) => statSync(filePath).isFile())
}

const generateLcovReport = async () => {
  const coverageMap = createCoverageMap({})
  const rawCoverageFiles = listRawCoverageFiles(rawCoverageDir)

  let processedEntries = 0
  let skippedEntries = 0

  for (const coverageFile of rawCoverageFiles) {
    /** @type {Array<{url?: string, source?: string, functions?: unknown[]}>} */
    let entries
    try {
      entries = JSON.parse(readFileSync(coverageFile, 'utf8'))
    }
    catch (error) {
      console.warn(`[playwright-coverage] Failed to parse ${coverageFile}: ${error}`)
      skippedEntries += 1
      continue
    }

    for (const entry of entries) {
      if (!entry?.url || !entry?.source || !Array.isArray(entry.functions)) {
        skippedEntries += 1
        continue
      }

      const sourceFile = isCoveredSourceFile(entry.url)
      if (!sourceFile || !existsSync(sourceFile.filePath)) {
        skippedEntries += 1
        continue
      }

      try {
        const ast = parse(entry.source, {
          sourceType: 'unambiguous',
          plugins: ['jsx', 'estree'],
        })

        const convertedMap = await convert({
          ast,
          code: entry.source,
          coverage: {
            url: sourceFile.fileUrl,
            functions: entry.functions,
          },
        })

        coverageMap.merge(convertedMap)
        processedEntries += 1
      }
      catch (error) {
        console.warn(`[playwright-coverage] Failed to convert ${entry.url}: ${error}`)
        skippedEntries += 1
      }
    }
  }

  mkdirSync(coverageRoot, { recursive: true })

  if (processedEntries === 0) {
    rmSync(join(coverageRoot, outputFile), { force: true })
    rmSync(outputDir, { recursive: true, force: true })
    console.warn('[playwright-coverage] No client src coverage entries were captured.')
    return
  }

  const context = createContext({
    dir: coverageRoot,
    coverageMap,
    defaultSummarizer: 'pkg',
  })

  reports.create('lcovonly', { file: outputFile }).execute(context)
  reports.create('html', { subdir: 'lcov-report' }).execute(context)
  reports.create('text-summary').execute(context)

  console.log(
    `[playwright-coverage] Processed ${processedEntries} entries (${skippedEntries} skipped). Output: ${join(coverageRoot, outputFile)}`,
  )
}

const runPlaywright = () => {
  rmSync(coverageRoot, { recursive: true, force: true })
  mkdirSync(rawCoverageDir, { recursive: true })

  const additionalArgs = process.argv.slice(2)
  const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'

  return spawnSync(npxCommand, ['playwright', 'test', ...additionalArgs], {
    cwd: clientRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      PW_E2E_COVERAGE: '1',
    },
  })
}

const runResult = runPlaywright()
await generateLcovReport()

if (typeof runResult.status === 'number') {
  process.exit(runResult.status)
}

process.exit(1)
