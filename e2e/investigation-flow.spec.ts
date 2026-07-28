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

  await page.goto("/");
  await expect(page.getByText("Index growth")).toBeVisible();
  await expect(page.locator(".recharts-line-curve").first()).toBeVisible();

  await page.getByRole("link", { name: "Search" }).click();
  await page
    .getByRole("textbox", { name: "Search local index" })
    .fill("example.com");
  await page.keyboard.press("Enter");
  await page.getByLabel("Field").selectOption("domain");
  await expect(page.getByLabel("Results per page")).toHaveValue("50");
  await expect(page.getByText(/Page 1 of 1/i)).toBeVisible();
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
  await expect(page.getByText("Masked line contents")).toBeVisible();
  await expect(page.getByText("[REDACTED]")).toBeVisible();

  await page.getByRole("link", { name: "Identities" }).click();
  await expect(
    page.getByText(/identity groups are created automatically/i),
  ).toBeVisible();
  await expect(page.getByText("a•••@example.com")).toBeVisible();
  await page.getByRole("button", { name: "Members" }).click();
  await expect(page.getByText(/records_valid.csv/).first()).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(
    page.getByRole("button", { name: "Undo last review" }),
  ).toBeVisible();
});

test("resource protections save and inactivity lock can be disabled", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByLabel("Inactivity lock").selectOption("0");
  await page.getByLabel("Index workers").selectOption("4");
  await page.getByLabel("Index memory budget").selectOption("1024");
  await page
    .getByRole("checkbox", { name: /Check GitHub for updates/i })
    .uncheck();
  await page.getByRole("button", { name: "Save protections" }).click();
  await expect(
    page.getByText("Resource protections saved and active"),
  ).toBeVisible();
  await expect(page.getByLabel("Inactivity lock")).toHaveValue("0");
  await expect(page.getByLabel("Index workers")).toHaveValue("4");
  await expect(page.getByLabel("Index memory budget")).toHaveValue("1024");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = window.localStorage.getItem("aletheia.browser.settings");
        return value ? JSON.parse(value).inactivityLockMinutes : null;
      }),
    )
    .toBe(0);
});
