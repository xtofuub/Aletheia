import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "aletheia.browser.settings",
      JSON.stringify({
        authorizationConfirmed: true,
        theme: "light",
        storageRoot: "C:\\Aletheia Test",
        networkDisabled: true,
        clipboardClearSeconds: 60,
        inactivityLockMinutes: 15,
        workerLimit: 2,
        memoryLimitMb: 512,
      }),
    );
  });
});

test("imports a synthetic source and exposes a searchable dataset", async ({
  page,
}) => {
  await page.goto("/datasets");
  await page.getByRole("button", { name: "Add source" }).click();
  await page.getByRole("button", { name: /choose files/i }).click();
  await expect(page.getByText("records_valid.csv").first()).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm the field mapping" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Authorization note").fill("Synthetic browser fixture");
  await page.getByRole("button", { name: "Begin indexing" }).click();
  await expect(page.getByText("records_valid").first()).toBeVisible();

  await page.getByRole("link", { name: "Search" }).click();
  await page
    .getByRole("textbox", { name: "Search local index" })
    .fill("example.com");
  await page.keyboard.press("Enter");
  await page.getByLabel("Field").selectOption("domain");
  await expect(page.getByText("a•••@example.com")).toBeVisible();
  await page.getByText("a•••@example.com").click();
  await expect(page.getByText("[REDACTED]")).toBeVisible();

  await page
    .getByRole("checkbox", { name: /select record-synthetic/i })
    .check();
  await page.getByRole("button", { name: /export 1/i }).click();
  await expect(page.getByText(/1 redacted record exported/i)).toBeVisible();
});

test("domain and identity explorers expose explainable local groups", async ({
  page,
}) => {
  await page.goto("/domains");
  await expect(page.getByText("example.co.uk").first()).toBeVisible();
  await page.getByLabel("Search domains").fill("portal");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: /example.co.uk/i }).click();
  await expect(page.getByText("portal.example.co.uk")).toBeVisible();
  await expect(page.getByText("Linked breach datasets")).toBeVisible();
  await expect(
    page.getByText("Authorized synthetic fixture").first(),
  ).toBeVisible();

  await page.getByRole("link", { name: "Identities" }).click();
  await expect(
    page.getByText(/identity groups are created automatically/i),
  ).toBeVisible();
  await expect(page.getByText("a•••@example.com")).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(
    page.getByRole("button", { name: "Undo last review" }),
  ).toBeVisible();
});
