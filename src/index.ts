import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium, type BrowserContext, type Page } from "playwright";
import { z } from "zod";

type CliOptions = {
  query: string;
  maxPlaces: number;
  scrollSteps: number;
  outDir: string;
  headless: boolean;
  delayMs: number;
  reviewLimit: number;
  resume: boolean;
};

type PlaceRecord = {
  sourceUrl: string;
  name: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  scrapedAt: string;
  topReviews: string[];
};

type Checkpoint = {
  query: string;
  discoveredUrls: string[];
  records: PlaceRecord[];
  currentIndex: number;
};

const PlaceRecordSchema = z.object({
  sourceUrl: z.string().url(),
  name: z.string().nullable(),
  category: z.string().nullable(),
  rating: z.number().nullable(),
  reviewCount: z.number().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  address: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  scrapedAt: z.string(),
  topReviews: z.array(z.string())
});

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await fs.mkdir(options.outDir, { recursive: true });

  const checkpointPath = path.join(options.outDir, "checkpoint.json");
  const jsonPath = path.join(options.outDir, "results.json");
  const csvPath = path.join(options.outDir, "results.csv");

  let state: Checkpoint;
  if (options.resume) {
    state = await loadCheckpoint(checkpointPath, options.query);
    console.log(`[resume] loaded ${state.records.length} records, next index ${state.currentIndex}`);
  } else {
    state = {
      query: options.query,
      discoveredUrls: [],
      records: [],
      currentIndex: 0
    };
  }

  const context = await chromium.launchPersistentContext(path.join(options.outDir, "profile"), {
    headless: options.headless,
    viewport: { width: 1440, height: 900 }
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    if (state.discoveredUrls.length === 0) {
      state.discoveredUrls = await collectPlaceUrls(page, options);
      await saveCheckpoint(checkpointPath, state);
    } else {
      console.log(`[collect] reusing ${state.discoveredUrls.length} discovered urls from checkpoint`);
    }

    for (let i = state.currentIndex; i < state.discoveredUrls.length; i += 1) {
      const url = state.discoveredUrls[i];
      console.log(`[detail] ${i + 1}/${state.discoveredUrls.length} ${url}`);

      const record = await scrapePlace(context, url, options.reviewLimit);
      PlaceRecordSchema.parse(record);

      state.records.push(record);
      state.currentIndex = i + 1;
      await saveCheckpoint(checkpointPath, state);

      await sleep(options.delayMs + randomInt(200, 600));
    }

    await fs.writeFile(jsonPath, JSON.stringify(state.records, null, 2), "utf8");
    await fs.writeFile(csvPath, toCsv(state.records), "utf8");
    console.log(`[done] wrote ${state.records.length} records`);
    console.log(`[done] json: ${jsonPath}`);
    console.log(`[done] csv:  ${csvPath}`);
  } finally {
    await context.close();
  }
}

function parseArgs(args: string[]): CliOptions {
  const map = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
    map.set(key, value);
  }

  const query = map.get("query") ?? "hotels in Sardinia";
  const maxPlaces = Number(map.get("max-places") ?? "250");
  const scrollSteps = Number(map.get("scroll-steps") ?? "60");
  const outDir = map.get("out-dir") ?? "data";
  const headless = (map.get("headless") ?? "false") === "true";
  const delayMs = Number(map.get("delay-ms") ?? "1200");
  const reviewLimit = Number(map.get("review-limit") ?? "3");
  const resume = (map.get("resume") ?? "false") === "true";

  if (!query) {
    throw new Error("--query is required");
  }

  return { query, maxPlaces, scrollSteps, outDir, headless, delayMs, reviewLimit, resume };
}

async function collectPlaceUrls(page: Page, options: CliOptions): Promise<string[]> {
  const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(options.query)}`;
  console.log(`[collect] opening ${searchUrl}`);
  await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
  await tryAcceptConsent(page);

  await waitForManualUnblockIfNeeded(page);
  await page.waitForTimeout(2500);

  const found = new Set<string>();

  for (let step = 0; step < options.scrollSteps && found.size < options.maxPlaces; step += 1) {
    const urls = await page.evaluate(() => {
      const roots = [document.querySelector('div[role="feed"]'), document].filter(Boolean);
      const anchors: HTMLAnchorElement[] = [];
      for (const root of roots) {
        anchors.push(...Array.from((root as ParentNode).querySelectorAll('a[href*="/place/"]')) as HTMLAnchorElement[]);
        anchors.push(...Array.from((root as ParentNode).querySelectorAll('a[href*="/maps/place/"]')) as HTMLAnchorElement[]);
      }
      return anchors.map((a) => a.href);
    });

    for (const raw of urls) {
      const normalized = normalizePlaceUrl(raw);
      if (normalized) {
        found.add(normalized);
      }
      if (found.size >= options.maxPlaces) {
        break;
      }
    }

    console.log(`[collect] step ${step + 1}/${options.scrollSteps}, discovered: ${found.size}`);

    await page.evaluate(() => {
      const panel = document.querySelector('div[role="feed"]');
      if (panel) {
        panel.scrollBy(0, 1400);
      } else {
        window.scrollBy(0, 1400);
      }
    });
    await page.waitForTimeout(1000 + randomInt(150, 450));
  }

  if (found.size === 0) {
    console.warn("[collect] no place links found. Try headed mode (--headless false) and increase --scroll-steps.");
  }

  return Array.from(found).slice(0, options.maxPlaces);
}

async function scrapePlace(context: BrowserContext, url: string, reviewLimit: number): Promise<PlaceRecord> {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await waitForManualUnblockIfNeeded(page);
    await page.waitForTimeout(1200);

    const data = await page.evaluate((maxReviews) => {
      const text = (selector: string): string | null => {
        const el = document.querySelector(selector);
        return el?.textContent?.trim() || null;
      };
      const attr = (selector: string, name: string): string | null => {
        const el = document.querySelector(selector);
        const value = el?.getAttribute(name);
        return value?.trim() || null;
      };

      const ratingText = text('div.F7nice span[aria-hidden="true"]');
      const rating = ratingText ? Number(ratingText.replace(",", ".")) : null;

      const reviewCountAria = attr('button[aria-label*="reviews"]', 'aria-label') ??
        attr('span[aria-label*="reviews"]', 'aria-label');
      const reviewCount = reviewCountAria
        ? Number((reviewCountAria.match(/[\d.,]+/)?.[0] ?? "").replace(/[^\d]/g, ""))
        : null;

      const phoneLabel = attr('button[data-item-id^="phone:tel:"]', 'aria-label');
      const phone = phoneLabel ? phoneLabel.replace(/^Phone:\s*/i, '').trim() : null;

      const website = attr('a[data-item-id="authority"]', 'href');
      const address = text('button[data-item-id="address"] .Io6YTe');
      const category = text('button[jsaction*="pane.rating.category"]');
      const name = text('h1.DUwDvf') ?? text('h1');

      const reviewEls = Array.from(document.querySelectorAll('div.jftiEf span.wiI7pd')) as HTMLElement[];
      const topReviews = reviewEls.slice(0, Math.max(0, maxReviews)).map((el) => el.innerText.trim()).filter(Boolean);

      return {
        name,
        category,
        rating: Number.isFinite(rating) ? rating : null,
        reviewCount: Number.isFinite(reviewCount) ? reviewCount : null,
        phone,
        website,
        address,
        topReviews
      };
    }, reviewLimit);

    const { lat, lng } = parseLatLngFromUrl(page.url());

    return {
      sourceUrl: url,
      ...data,
      lat,
      lng,
      scrapedAt: new Date().toISOString()
    };
  } finally {
    await page.close();
  }
}

async function waitForManualUnblockIfNeeded(page: Page): Promise<void> {
  const html = await page.content();
  const blocked = /unusual traffic|verify you are human|captcha/i.test(html);
  if (!blocked) {
    return;
  }

  console.log("[manual] Google challenge detected. Solve it in browser, then press Enter here to continue...");
  const rl = readline.createInterface({ input, output });
  await rl.question("");
  rl.close();
}

async function tryAcceptConsent(page: Page): Promise<void> {
  const currentUrl = page.url();
  if (!/consent\./i.test(currentUrl) && !/before you continue/i.test(await page.title().catch(() => ""))) {
    return;
  }

  const candidates = [
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Accept")',
    'button[aria-label*="Accept"]',
    'form [type="submit"]'
  ];

  for (const selector of candidates) {
    const button = page.locator(selector).first();
    if (await button.count()) {
      try {
        await button.click({ timeout: 1500 });
        await page.waitForTimeout(1000);
        return;
      } catch {
        // Try next selector.
      }
    }
  }
}

function normalizePlaceUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!u.pathname.includes("/place/")) {
      return null;
    }
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}

function parseLatLngFromUrl(url: string): { lat: number | null; lng: number | null } {
  const match = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!match) {
    return { lat: null, lng: null };
  }
  return { lat: Number(match[1]), lng: Number(match[2]) };
}

function toCsv(records: PlaceRecord[]): string {
  const header = [
    "sourceUrl",
    "name",
    "category",
    "rating",
    "reviewCount",
    "phone",
    "website",
    "address",
    "lat",
    "lng",
    "scrapedAt",
    "topReviews"
  ];

  const rows = records.map((record) => [
    record.sourceUrl,
    record.name,
    record.category,
    record.rating,
    record.reviewCount,
    record.phone,
    record.website,
    record.address,
    record.lat,
    record.lng,
    record.scrapedAt,
    record.topReviews.join(" | ")
  ]);

  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function loadCheckpoint(checkpointPath: string, query: string): Promise<Checkpoint> {
  const content = await fs.readFile(checkpointPath, "utf8");
  const parsed = JSON.parse(content) as Checkpoint;
  if (parsed.query !== query) {
    throw new Error(`Checkpoint query mismatch. checkpoint='${parsed.query}' current='${query}'`);
  }
  return parsed;
}

async function saveCheckpoint(checkpointPath: string, state: Checkpoint): Promise<void> {
  await fs.writeFile(checkpointPath, JSON.stringify(state, null, 2), "utf8");
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
