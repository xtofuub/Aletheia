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

test("overview maps dataset scale and investigation lanes", async ({
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
    window.localStorage.setItem(
      "aletheia.browser.live-sources",
      JSON.stringify([
        {
          id: "chart-live-source",
          name: "Synthetic chart source",
          paths: ["\\\\?\\C:\\Synthetic\\Authorized corpus"],
          includeArchives: true,
          createdAt: now,
        },
      ]),
    );
  });
  await page.goto("/#/overview");

  const landscapeCard = page.locator('[data-slot="card"]').filter({
    has: page.getByText("Dataset landscape", { exact: true }),
  });
  const lanesCard = page.locator('[data-slot="card"]').filter({
    has: page.getByText("Investigation lanes", { exact: true }),
  });

  await expect(landscapeCard).toBeVisible();
  await expect(lanesCard).toBeVisible();
  await expect(landscapeCard).toContainText("Synthetic chart index");
  await expect(landscapeCard).toContainText("Complete index");
  await expect(
    landscapeCard.getByRole("img", {
      name: "Synthetic chart index: 4M searchable rows; bar size is relative to the largest persistent index",
    }),
  ).toBeVisible();
  await expect(
    lanesCard.getByRole("link", { name: /Indexed search/ }),
  ).toHaveAttribute("href", "#/search");
  await expect(
    lanesCard.getByRole("link", { name: /Live scan/ }),
  ).toContainText("1 saved source · 42 latest matches");
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
  await expect(page.getByText(/Expected full scan:/)).toBeVisible();
  await expect(page.getByText(/sampled read/)).toBeVisible();
  await page
    .getByLabel("Search query")
    .fill("synthetic@example.test\nportal.example.com");

  await expect(page.getByText("2 values")).toBeVisible();
  await page.getByRole("button", { name: "Scan", exact: true }).click();

  await expect(page.getByText("Live search complete")).toBeVisible();
  await expect(page.getByText("Batch value found").first()).toBeVisible();
  await expect(page.getByText("synthetic@example.test").first()).toBeVisible();

  await page.goto("/#/overview");
  const liveMatchNote = page.getByText(
    "latest Live matches, counted separately",
    {
      exact: true,
    },
  );
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

test("datasets show normal Windows source paths", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "aletheia.browser.live-sources",
      JSON.stringify([
        {
          id: "long-path-source",
          name: "Synthetic long path source",
          paths: ["\\\\?\\C:\\Synthetic\\Authorized corpus"],
          includeArchives: true,
          createdAt: new Date().toISOString(),
        },
      ]),
    );
  });
  await page.goto("/#/datasets");

  const sourceRow = page.getByRole("row", {
    name: /Synthetic long path source/,
  });
  await expect(sourceRow).toContainText("C:\\Synthetic\\Authorized corpus");
  await expect(sourceRow).not.toContainText("\\\\?\\");
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
  await expect(page.getByText(/\\\\\?\\C:\\Synthetic/)).toHaveCount(0);
  await expect(page.getByText(/Expected full scan:/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose folder" })).toHaveCount(
    0,
  );

  await page
    .getByLabel("2. Search the selected sources")
    .fill("synthetic@example.test");
  await page.getByRole("button", { name: "Start live scan" }).click();
  await expect(page.getByText("Live search complete")).toBeVisible();
});

test("Identity Builder scopes indexed evidence to one dataset", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    window.localStorage.setItem(
      "aletheia.browser.datasets",
      JSON.stringify([
        {
          id: "identity-index-one",
          name: "Primary identity index",
          status: "ready",
          recordCount: 40,
          fileCount: 1,
          totalBytes: 1024,
          warningCount: 0,
          createdAt: now,
          lastIndexedAt: now,
        },
        {
          id: "identity-index-two",
          name: "Secondary identity index",
          status: "ready",
          recordCount: 12,
          fileCount: 1,
          totalBytes: 512,
          warningCount: 0,
          createdAt: now,
          lastIndexedAt: now,
        },
      ]),
    );
  });
  await page.goto("/#/identities");
  await page.getByRole("tab", { name: "Build identity" }).click();

  await page.getByLabel("Identity indexed dataset").click();
  await page.getByRole("option", { name: /Secondary identity index/ }).click();
  await expect(
    page.getByText("12 searchable records in Secondary identity index."),
  ).toBeVisible();

  await page
    .getByLabel("Find identity evidence")
    .fill("synthetic@example.test");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByText("Secondary identity index").first(),
  ).toBeVisible();
});

test("identity review actions visibly update the selected group", async ({
  page,
}) => {
  await page.goto("/#/identities");

  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(
    page.getByText("Identity rejected", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Rejected", exact: true }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(
    page.getByText("Identity confirmed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirmed", exact: true }),
  ).toBeDisabled();
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
  await page.getByRole("button", { name: "Live source scans" }).click();
  await expect(page.getByText(/Expected full scan:/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Live source scans" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Parent domain").fill("example.co.uk");
  await expect(page.getByText("Loading stored Live lines")).toHaveCount(0);
  await page.getByRole("button", { name: "Scan & autosave" }).click();

  await expect(page.getByText("Streaming matching Live lines")).toBeVisible();
  const liveResults = page.getByTestId("active-live-domain-results");
  await expect(liveResults).toBeVisible();
  const liveResultsBox = await liveResults.boundingBox();
  expect(liveResultsBox?.height ?? 0).toBeGreaterThanOrEqual(540);
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
  await expect(
    page.getByRole("button", { name: "example.co.uk 2", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Stored Live evidence")).toBeVisible();
  await expect(
    page
      .getByText("synthetic@example.com portal.example.com", { exact: false })
      .first(),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Delete saved results for example.co.uk" })
    .click();
  const deleteDialog = page.getByRole("alertdialog", {
    name: "Delete saved domain results?",
  });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole("button", { name: "Delete results" }).click();
  await expect(page.getByText("No saved Live results yet.")).toBeVisible();

  await page.getByRole("button", { name: "Indexed datasets" }).click();
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
  await page.getByRole("button", { name: "Live source scans" }).click();
  await page.getByLabel("Parent domain").fill("cancel.example");
  await page.getByRole("button", { name: "Scan & autosave" }).click();
  await expect(page.getByText("Streaming matching Live lines")).toBeVisible();
  await expect(page.getByText("1 stored locally")).toBeVisible();
  await page
    .getByRole("button", { name: "Cancel", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("1 partial Live row saved locally after the scan stopped"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Delete saved results for cancel.example",
    }),
  ).toBeVisible();
});

test("Domains filters indexed groups by dataset", async ({ page }) => {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    window.localStorage.setItem(
      "aletheia.browser.datasets",
      JSON.stringify([
        {
          id: "dataset-synthetic",
          name: "Authorized synthetic fixture",
          status: "ready",
          recordCount: 67,
          fileCount: 1,
          totalBytes: 1024,
          warningCount: 0,
          createdAt: now,
          lastIndexedAt: now,
        },
        {
          id: "dataset-empty",
          name: "Unrelated index",
          status: "ready",
          recordCount: 12,
          fileCount: 1,
          totalBytes: 512,
          warningCount: 0,
          createdAt: now,
          lastIndexedAt: now,
        },
      ]),
    );
  });
  await page.goto("/#/domains");
  await expect(
    page.getByRole("button", { name: "Indexed datasets" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("example.co.uk", { exact: true }).first(),
  ).toBeVisible();

  await page.getByLabel("Indexed dataset").click();
  await page.getByRole("option", { name: /Unrelated index/ }).click();
  await expect(page.getByText("No domains in this scope")).toBeVisible();

  await page.getByLabel("Indexed dataset").click();
  await page
    .getByRole("option", { name: /Authorized synthetic fixture/ })
    .click();
  await page.getByLabel("Search domains").fill("portal");
  await expect(
    page.getByText("example.co.uk", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText(/67 indexed lines/)).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Location" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Dataset" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Evidence" }),
  ).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Parser" })).toHaveCount(
    0,
  );
  await expect(page.getByText("line 2", { exact: true })).toBeVisible();
});

test("Domains builds the complete indexed catalog without a query", async ({
  page,
}) => {
  await page.goto("/#/domains");
  await expect(page.getByLabel("Search domains")).toHaveValue("");
  await page.getByRole("button", { name: "Build all domains" }).click();
  await expect(page.getByText("Domain catalog ready")).toBeVisible();
  await expect(
    page.getByText(
      /parent domain groups are ready, including their linked subdomains/i,
    ),
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

test("device benchmark recommends and applies resource settings", async ({
  page,
}) => {
  await page.goto("/#/settings");
  await page.getByRole("button", { name: "Run benchmark" }).click();

  await expect(page.getByText("Device benchmark complete")).toBeVisible();
  await expect(
    page.getByText(/Recommended: 2 workers · 2048 MB/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use recommendation" }).click();
  await expect(
    page.getByText("Recommended resources selected; save to apply"),
  ).toBeVisible();
  await expect(page.getByText("2 workers · 2048 MB").first()).toBeVisible();
});
