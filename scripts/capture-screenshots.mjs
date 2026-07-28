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
      theme: "dark",
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
        name: "Authorized synthetic fixture",
        status: "ready",
        recordCount: 3,
        fileCount: 4,
        totalBytes: 2840,
        warningCount: 0,
        createdAt: "2026-01-20T10:00:00Z",
        lastIndexedAt: "2026-01-20T10:01:00Z",
      },
    ]),
  );
});

await page.goto("http://127.0.0.1:1420/");
await page
  .getByRole("heading", { name: /local evidence index is ready/i })
  .waitFor();
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
