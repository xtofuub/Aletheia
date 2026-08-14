import { expect, test } from "@playwright/test";

test("core investigation routes stay reachable", async ({ page }) => {
  await page.goto("/#/overview");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  for (const route of [
    ["search", "Search"],
    ["domains", "Domains"],
    ["identities", "Identities"],
    ["datasets", "Datasets"],
    ["settings", "Settings"],
  ] as const) {
    await page.getByRole("link", { name: route[1], exact: true }).click();
    await expect(page.getByRole("heading", { name: route[1] })).toBeVisible({
      timeout: 15_000,
    });
  }
});

test("overview keeps the Efferd activity charts and hover details", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    window.localStorage.setItem(
      "aletheia.browser.datasets",
      JSON.stringify([
        {
          id: "chart-index",
          name: "Synthetic chart index",
          status: "ready",
          recordCount: 4_000_000,
          fileCount: 1,
          totalBytes: 2_560_000_000,
          warningCount: 0,
          createdAt: now,
          lastIndexedAt: now,
        },
      ]),
    );
    window.localStorage.setItem(
      "aletheia.browser.live-search-activity",
      JSON.stringify([
        {
          jobId: "chart-live-job",
          sourceId: "chart-live-source",
          sourceName: "Synthetic chart source",
          matches: 42,
          filesScanned: 1,
          bytesScanned: 1_024,
          completedAt: now,
        },
      ]),
    );
  });
  await page.goto("/#/overview");

  const indexCard = page.locator('[data-slot="card"]').filter({
    has: page.getByText("Index growth", { exact: true }),
  });
  const searchCard = page.locator('[data-slot="card"]').filter({
    has: page.getByText("Search activity", { exact: true }),
  });

  await expect(indexCard).toBeVisible();
  await expect(searchCard).toBeVisible();
  await expect(indexCard.locator("linearGradient")).toHaveCount(7);
  await expect(searchCard.locator(".recharts-line-curve")).toHaveCount(2);

  const latestBar = indexCard.locator('rect[fill^="url("]').last();
  await expect(latestBar).toBeVisible();
  await latestBar.hover();
  await expect(indexCard.locator(".recharts-tooltip-wrapper")).toContainText(
    "Indexed records",
  );
});

test("saved Live source searches many values in one pass", async ({ page }) => {
  await page.goto("/#/datasets");
  await page.getByRole("button", { name: "Save folder" }).click();
  await expect(
    page.getByRole("dialog", { name: "Save Live source" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save source" }).click();
  const liveSourceRow = page.getByRole("row", { name: /Authorized corpus/ });
  await expect(liveSourceRow).toBeVisible();
  await liveSourceRow.getByRole("button", { name: "Search" }).click();
  await page
    .getByLabel("Search query")
    .fill("synthetic@example.test\nportal.example.com");

  await expect(page.getByText("2 values")).toBeVisible();
  await page.getByRole("button", { name: "Scan", exact: true }).click();

  await expect(page.getByText("Live search complete")).toBeVisible();
  await expect(page.getByText("Batch value found").first()).toBeVisible();
  await expect(page.getByText("synthetic@example.test").first()).toBeVisible();

  await page.goto("/#/overview");
  const liveMatchNote = page.getByText("matches in the latest Live scan", {
    exact: true,
  });
  await expect(liveMatchNote).toBeVisible();
  await expect(liveMatchNote.locator("..")).toContainText("2");
  await expect(
    page.getByRole("row", {
      name: /Authorized corpus .* Live on demand 1 location/,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Authorized corpus · 2 Live matches"),
  ).toBeVisible();

  await page.goto("/#/datasets");
  await page.getByRole("button", { name: "Remove Authorized corpus" }).click();
  await page.getByRole("button", { name: "Remove source" }).click();
  await expect(
    page.getByRole("row", { name: /Authorized corpus/ }),
  ).toHaveCount(0);
});

test("Identity Builder reuses a saved Live source", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "aletheia.browser.live-sources",
      JSON.stringify([
        {
          id: "live-authorized-corpus",
          name: "Authorized corpus",
          paths: ["C:\\Synthetic\\Authorized corpus"],
          includeArchives: true,
          createdAt: new Date().toISOString(),
        },
      ]),
    );
  });
  await page.goto("/#/identities");
  await page.getByRole("tab", { name: "Build identity" }).click();
  await page.getByRole("tab", { name: "Live files & archives" }).click();

  const sourceSelect = page.getByLabel("Identity Live source");
  await expect(sourceSelect).toContainText("Authorized corpus");
  await expect(
    page.getByText("C:\\Synthetic\\Authorized corpus"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose folder" })).toHaveCount(
    0,
  );

  await page
    .getByLabel("2. Search the selected sources")
    .fill("synthetic@example.test");
  await page.getByRole("button", { name: "Start live scan" }).click();
  await expect(page.getByText("Live search complete")).toBeVisible();
});

test("Domains scans saved Live sources and stores matching lines", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "aletheia.browser.live-sources",
      JSON.stringify([
        {
          id: "live-domain-corpus",
          name: "Authorized domain corpus",
          paths: ["C:\\Synthetic\\Authorized corpus"],
          includeArchives: true,
          createdAt: new Date().toISOString(),
        },
      ]),
    );
  });
  await page.goto("/#/domains");
  await expect(page.getByRole("tab", { name: "Live sources" })).toHaveAttribute(
    "data-active",
  );
  await page.getByLabel("Search domains").fill("example.co.uk");
  await expect(page.getByText("Loading stored Live lines")).toHaveCount(0);
  await page.getByRole("button", { name: "Scan & store" }).click();

  await expect(page.getByText("Streaming matching Live lines")).toBeVisible();
  await expect(
    page.getByText("synthetic@example.com portal.example.com", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).last().click();
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }).last(),
  ).toBeVisible();
  await page.goto("/#/overview");
  const activeScan = page.getByLabel("Active domain scan");
  await expect(activeScan).toBeVisible();
  await expect(
    activeScan.getByRole("button", { name: "Open Domains" }),
  ).toBeVisible();
  await expect(
    activeScan.getByRole("button", { name: "Continue" }),
  ).toBeVisible();
  await activeScan.getByRole("button", { name: "Continue" }).click();
  await page.goto("/#/domains");
  await expect(page.getByText("2 Live rows stored locally")).toBeVisible();
  await expect(page.getByText("Stored Live evidence")).toBeVisible();
  await expect(
    page
      .getByText("synthetic@example.com portal.example.com", { exact: false })
      .first(),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Indexed evidence" }).click();
  await expect(
    page.getByText("Indexed domain groups", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Scan saved Live sources", { exact: true }),
  ).toHaveCount(0);
});

test("a Live domain scan can be cancelled", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "aletheia.browser.live-sources",
      JSON.stringify([
        {
          id: "live-domain-cancel",
          name: "Cancelable corpus",
          paths: ["C:\\Synthetic\\Cancelable corpus"],
          includeArchives: true,
          createdAt: new Date().toISOString(),
        },
      ]),
    );
  });
  await page.goto("/#/domains");
  await page.getByLabel("Search domains").fill("cancel.example");
  await page.getByRole("button", { name: "Scan & store" }).click();
  await page
    .getByRole("button", { name: "Cancel", exact: true })
    .first()
    .click();
  await expect(page.getByText("Live scan cancelled").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Dismiss", exact: true }),
  ).toBeVisible();
});

test("indexed results show complete identifiers and wrap safely", async ({
  page,
}) => {
  await page.goto("/#/search");
  await page.getByLabel("Search query").fill("example.com");
  await page.getByRole("button", { name: "Search", exact: true }).click();

  await expect(page.getByText("analyst@example.com").first()).toBeVisible();
  await expect(page.getByText(/redact/i)).toHaveCount(0);
  await expect(page.getByText(/password:/i)).toHaveCount(0);
  await expect(page.locator("table").first()).toHaveCSS(
    "table-layout",
    "fixed",
  );
  await expect(
    page.locator('[data-slot="search-field-value"]').first(),
  ).not.toHaveCSS("white-space", "nowrap");
});

test("large-source index profiles explain their cost", async ({ page }) => {
  await page.goto("/#/datasets");
  await page.getByRole("button", { name: "Index files" }).click();

  const dialog = page.getByRole("dialog", { name: "Review import" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("3 files queued")).toBeVisible();
  await expect(dialog.getByText("records_valid.csv")).toBeVisible();
  await expect(dialog.getByText(/nested\\records_two\.txt/)).toBeVisible();
  await expect(dialog.getByText("records_three.jsonl")).toBeVisible();
  await page.getByRole("button", { name: "Fast index" }).click();
  await expect(
    page.getByText(
      "Searchable records and source locations only. Domains and automatic identities stay off.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(/Plan roughly .* generated storage/),
  ).toBeVisible();
});

test("folder indexing reviews supported files recursively", async ({
  page,
}) => {
  await page.goto("/#/datasets");
  await page.getByRole("button", { name: "Index folder" }).click();

  const dialog = page.getByRole("dialog", { name: "Review import" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Recursive folder scan")).toBeVisible();
  await expect(dialog.getByText("3 files queued")).toBeVisible();
  await expect(dialog.getByText("records_valid.csv")).toBeVisible();
  await expect(dialog.getByText(/nested\\records_two\.txt/)).toBeVisible();
  await expect(dialog.getByText("records_three.jsonl")).toBeVisible();
});

test("an active index blocks a second writer before file selection", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "aletheia.browser.datasets",
      JSON.stringify([
        {
          id: "dataset-active",
          name: "Active synthetic index",
          status: "indexing",
          recordCount: 10,
          fileCount: 1,
          totalBytes: 4096,
          warningCount: 0,
          createdAt: new Date().toISOString(),
          lastIndexedAt: null,
        },
      ]),
    );
  });
  await page.goto("/#/datasets");

  const blockedActions = page.getByRole("button", {
    name: "Indexing active",
  });
  await expect(blockedActions).toHaveCount(2);
  await expect(blockedActions.first()).toBeDisabled();
  await expect(blockedActions.last()).toBeDisabled();
});
