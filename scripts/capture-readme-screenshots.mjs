import { chromium } from "@playwright/test";

const baseUrl = process.env.ALETHEIA_PREVIEW_URL ?? "http://127.0.0.1:1420";
const browser = await chromium.launch();
const page = await browser.newPage({
  deviceScaleFactor: 1,
  viewport: { width: 1280, height: 720 },
});

const now = new Date().toISOString();
await page.goto(`${baseUrl}/#/overview`);
await page.evaluate(
  ({ createdAt }) => {
    const indexedRecords = [
      360_000, 480_000, 520_000, 610_000, 660_000, 720_000, 850_000,
    ];
    const liveMatches = [18, 32, 24, 51, 39, 73, 58];
    const activityDays = indexedRecords.map((_, index) => {
      const date = new Date(createdAt);
      date.setUTCDate(date.getUTCDate() + index - indexedRecords.length + 1);
      return date.toISOString();
    });
    window.localStorage.setItem(
      "aletheia.browser.datasets",
      JSON.stringify(
        indexedRecords.map((recordCount, index) => ({
          id: `readme-index-${index + 1}`,
          name: `synthetic_records_${String(index + 1).padStart(2, "0")}`,
          status: "ready",
          recordCount,
          fileCount: index + 1,
          totalBytes: recordCount * 640,
          warningCount: 0,
          createdAt: activityDays[index],
          lastIndexedAt: activityDays[index],
        })),
      ),
    );
    window.localStorage.setItem(
      "aletheia.browser.live-sources",
      JSON.stringify([
        {
          id: "readme-live",
          name: "Synthetic archive corpus",
          paths: ["C:\\Synthetic\\Authorized corpus"],
          includeArchives: true,
          createdAt,
        },
      ]),
    );
    window.localStorage.setItem(
      "aletheia.browser.live-search-activity",
      JSON.stringify(
        liveMatches.map((matches, index) => ({
          jobId: `readme-live-job-${index + 1}`,
          sourceId: "readme-live",
          sourceName: "Synthetic archive corpus",
          matches,
          filesScanned: index + 2,
          bytesScanned: (index + 2) * 268_435_456,
          completedAt: activityDays[index],
        })),
      ),
    );
  },
  { createdAt: now },
);

await page.reload();
await page.getByRole("heading", { name: "Overview" }).waitFor();
await page.waitForTimeout(1000);
await page.screenshot({
  path: "docs/screenshots/dashboard.jpg",
  quality: 88,
  type: "jpeg",
});

await page.goto(`${baseUrl}/#/datasets`);
await page.getByRole("heading", { name: "Datasets" }).waitFor();
const hiddenDatasetAlerts = await page.addStyleTag({
  content: '[role="alert"] { display: none !important; }',
});
await page.getByText("Synthetic archive corpus").waitFor();
await page.screenshot({
  path: "docs/screenshots/datasets.jpg",
  quality: 88,
  type: "jpeg",
});
await hiddenDatasetAlerts.evaluate((element) => element.remove());

await page.goto(`${baseUrl}/#/search?source=live%3Areadme-live`);
await page.getByRole("heading", { name: "Search" }).waitFor();
await page
  .getByLabel("Search query")
  .fill("synthetic@example.test\nportal.example.com");
await page.getByRole("button", { name: "Scan", exact: true }).click();
await page.getByText("Live search complete").waitFor();
await page.waitForTimeout(300);
await page.screenshot({
  path: "docs/screenshots/search-live.jpg",
  quality: 88,
  type: "jpeg",
});

await page.goto(`${baseUrl}/#/domains`);
await page.getByRole("heading", { name: "Domains" }).waitFor();
await page.getByRole("button", { name: "Live source scans" }).click();
await page.getByLabel("Parent domain").fill("example.co.uk");
await page.getByRole("button", { name: "Scan & store" }).click();
await page.getByText("2 Live rows stored locally").waitFor();
await page.waitForTimeout(300);
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({
  path: "docs/screenshots/domains-live.jpg",
  quality: 88,
  type: "jpeg",
});

await browser.close();
