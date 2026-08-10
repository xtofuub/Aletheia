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

test("batch live scan searches many values in one pass", async ({ page }) => {
  await page.goto("/#/search?surface=direct");
  await page.getByRole("button", { name: "Choose folder" }).click();
  await page
    .getByLabel("Direct scan query")
    .fill("synthetic@example.test\nportal.example.com");

  await expect(page.getByText("2 values")).toBeVisible();
  await page.getByRole("button", { name: "Start scan" }).click();

  await expect(page.getByText("Live search complete")).toBeVisible();
  await expect(page.getByText("Batch value found").first()).toBeVisible();
  await expect(page.getByText("synthetic@example.test").first()).toBeVisible();
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

  await expect(
    page.getByRole("dialog", { name: "Review import" }),
  ).toBeVisible();
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
