import { expect, test } from "@playwright/test";

test("first launch requires authorization and opens the dashboard", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Investigate local data without surrendering it.",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Enter Aletheia" }).click();
  await expect(
    page.getByText("Confirm authorization before continuing."),
  ).toBeVisible();

  await page
    .getByRole("checkbox", {
      name: /I am authorized to possess and analyze/i,
    })
    .check();
  await page.getByRole("button", { name: "Enter Aletheia" }).click();

  await expect(
    page.getByRole("heading", { name: "Ready for an authorized dataset." }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByText("No data transmitted").first()).toBeVisible();
});

test("command palette exposes app navigation", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
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
  await page.reload();
  await expect(page.getByRole("button", { name: /Commands/i })).toBeVisible();
  await page.keyboard.press("Control+K");
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).toBeVisible();
  await page.getByPlaceholder("Find a command").fill("settings");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});
