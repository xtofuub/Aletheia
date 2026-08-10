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
  await page.getByRole("button", { name: "Search", exact: true }).click();

  await expect(page.getByText("Live search complete")).toBeVisible();
  await expect(page.getByText("Batch value found").first()).toBeVisible();
  await expect(page.getByText("synthetic@example.test").first()).toBeVisible();

  await page.goto("/#/datasets");
  await page.getByRole("button", { name: "Remove Authorized corpus" }).click();
  await page.getByRole("button", { name: "Remove source" }).click();
  await expect(
    page.getByRole("row", { name: /Authorized corpus/ }),
  ).toHaveCount(0);
});

test("indexed results use neutral protected values and wrap safely", async ({
  page,
}) => {
  await page.goto("/#/search");
  await page.getByLabel("Search query").fill("example.com");
  await page.getByRole("button", { name: "Search", exact: true }).click();

  await expect(page.getByText("••••••").first()).toBeVisible();
  await expect(page.getByText(/redact/i)).toHaveCount(0);
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
