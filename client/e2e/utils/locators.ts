import type { Locator, Page } from '@playwright/test'

interface LocatorOptions {
  testId?: string
  role?: Parameters<Page['getByRole']>[0]
  name?: string | RegExp
  text?: string | RegExp
  defectLabel: string
}

export async function resolveLocator(page: Page, options: LocatorOptions): Promise<Locator> {
  const candidates: Array<{ description: string; locator: Locator }> = []

  if (options.testId) {
    candidates.push({
      description: `data-testid="${options.testId}"`,
      locator: page.getByTestId(options.testId),
    })
  }

  if (options.role) {
    candidates.push({
      description: options.name
        ? `role="${options.role}" name=${String(options.name)}`
        : `role="${options.role}"`,
      locator: page.getByRole(options.role, options.name ? { name: options.name } : undefined),
    })
  }

  if (options.text) {
    candidates.push({
      description: `text=${String(options.text)}`,
      locator: page.getByText(options.text),
    })
  }

  for (const candidate of candidates) {
    const count = await candidate.locator.count()
    if (count === 1) {
      return candidate.locator
    }

    if (count > 1) {
      throw new Error(
        `Accessibility / Testability Defect: locator for "${options.defectLabel}" matched ${count} elements via ${candidate.description}.`,
      )
    }
  }

  throw new Error(
    `Accessibility / Testability Defect: unable to resolve locator for "${options.defectLabel}" via data-testid, role, or text.`,
  )
}
