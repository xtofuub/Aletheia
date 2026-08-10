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
    window.localStorage.setItem(
      "aletheia.browser.datasets",
      JSON.stringify([
        {
          id: "readme-index",
          name: "synthetic_records",
          status: "ready",
          recordCount: 4_200_000,
          fileCount: 4,
          totalBytes: 2_684_354_560,
          warningCount: 0,
          createdAt,
          lastIndexedAt: createdAt,
        },
      ]),
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
  },
  { createdAt: now },
);

await page.reload();
await page.getByRole("heading", { name: "Overview" }).waitFor();
await page.screenshot({
  path: "docs/screenshots/dashboard.jpg",
  quality: 88,
  type: "jpeg",
});

await page.goto(`${baseUrl}/#/datasets`);
await page.getByRole("heading", { name: "Datasets" }).waitFor();
await page.addStyleTag({
  content: '[role="alert"] { display: none !important; }',
});
await page.getByText("Synthetic archive corpus").waitFor();
await page.screenshot({
  path: "docs/screenshots/datasets.jpg",
  quality: 88,
  type: "jpeg",
});

await page.goto(`${baseUrl}/#/search?source=live%3Areadme-live`);
await page.getByRole("heading", { name: "Search" }).waitFor();
await page
  .getByLabel("Search query")
  .fill("synthetic@example.test\nportal.example.com");
await page.getByRole("button", { name: "Search", exact: true }).click();
await page.getByText("Live search complete").waitFor();
await page.screenshot({
  path: "docs/screenshots/search-live.jpg",
  quality: 88,
  type: "jpeg",
});

await browser.close();
