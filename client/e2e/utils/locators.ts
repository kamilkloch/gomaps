import type { Locator, Page } from '@playwright/test'

interface LocatorOptions {
  testId?: string
  role?: Parameters<Page['getByRole']>[0]
  name?: string | RegExp
  text?: string | RegExp
  defectLabel: string
}

export async function resolveLocator(page: Page, options: LocatorOptions): Promise<Locator> {
  const candidates: Locator[] = []

  if (options.testId) {
    candidates.push(page.getByTestId(options.testId))
  }

  if (options.role) {
    candidates.push(page.getByRole(options.role, options.name ? { name: options.name } : undefined))
  }

  if (options.text) {
    candidates.push(page.getByText(options.text))
  }

  for (const candidate of candidates) {
    if (await candidate.count()) {
      return candidate.first()
    }
  }

  throw new Error(
    `Accessibility / Testability Defect: unable to resolve locator for "${options.defectLabel}" via data-testid, role, or text.`,
  )
}
