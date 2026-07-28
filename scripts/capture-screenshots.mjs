import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const output = new URL("../docs/screenshots/", import.meta.url);
await mkdir(output, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  window.localStorage.setItem(
    "aletheia.browser.settings",
    JSON.stringify({
      authorizationConfirmed: true,
      theme: "light",
      storageRoot: "C:\\Aletheia Synthetic Workspace",
      networkDisabled: true,
      clipboardClearSeconds: 60,
      inactivityLockMinutes: 15,
      workerLimit: 2,
      memoryLimitMb: 512,
    }),
  );
  window.localStorage.setItem(
    "aletheia.browser.datasets",
    JSON.stringify([
      {
        id: "dataset-synthetic-001",
        name: "Synthetic account sample",
        status: "ready",
        recordCount: 184000,
        fileCount: 4,
        totalBytes: 42840000,
        warningCount: 0,
        createdAt: "2026-01-02T10:00:00Z",
        lastIndexedAt: "2026-01-02T10:01:00Z",
      },
      {
        id: "dataset-synthetic-002",
        name: "Synthetic contact archive",
        status: "ready",
        recordCount: 276000,
        fileCount: 12,
        totalBytes: 88100000,
        warningCount: 0,
        createdAt: "2026-01-08T09:00:00Z",
        lastIndexedAt: "2026-01-08T09:04:00Z",
      },
      {
        id: "dataset-synthetic-003",
        name: "Synthetic domain corpus",
        status: "ready",
        recordCount: 142000,
        fileCount: 7,
        totalBytes: 53400000,
        warningCount: 2,
        createdAt: "2026-01-13T14:00:00Z",
        lastIndexedAt: "2026-01-13T14:03:00Z",
      },
      {
        id: "dataset-synthetic-004",
        name: "Synthetic identity export",
        status: "ready",
        recordCount: 391000,
        fileCount: 18,
        totalBytes: 126800000,
        warningCount: 0,
        createdAt: "2026-01-18T11:00:00Z",
        lastIndexedAt: "2026-01-18T11:06:00Z",
      },
      {
        id: "dataset-synthetic-005",
        name: "Synthetic event records",
        status: "ready",
        recordCount: 227000,
        fileCount: 9,
        totalBytes: 71400000,
        warningCount: 1,
        createdAt: "2026-01-23T08:00:00Z",
        lastIndexedAt: "2026-01-23T08:04:00Z",
      },
      {
        id: "dataset-synthetic-006",
        name: "Authorized synthetic fixture",
        status: "ready",
        recordCount: 318000,
        fileCount: 15,
        totalBytes: 101200000,
        warningCount: 0,
        createdAt: "2026-01-28T16:00:00Z",
        lastIndexedAt: "2026-01-28T16:05:00Z",
      },
    ]),
  );
});

await page.goto("http://127.0.0.1:1420/");
await page
  .getByRole("heading", { name: /local evidence index is ready/i })
  .waitFor();
await page.waitForTimeout(1000);
await page.screenshot({
  path: new URL("dashboard.png", output).pathname.slice(1),
  fullPage: true,
});

await page.goto("http://127.0.0.1:1420/search");
await page
  .getByRole("textbox", { name: "Search local index" })
  .fill("example.com");
await page.keyboard.press("Enter");
await page.getByText("a•••@example.com").click();
await page.getByText("[REDACTED]").waitFor();
await page.screenshot({
  path: new URL("search.png", output).pathname.slice(1),
  fullPage: true,
});

await browser.close();
