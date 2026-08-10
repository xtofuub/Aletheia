import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApplicationUpdatePrompt } from "./application-update-prompt";

const availableUpdate = {
  currentVersion: "1.2.3",
  latestVersion: "1.3.0",
  updateAvailable: true,
  releaseUrl: "https://github.com/xtofuub/Aletheia/releases/tag/v1.3.0",
  releaseNotes: "Faster large-source scans.",
};

afterEach(cleanup);

describe("ApplicationUpdatePrompt", () => {
  it("notifies the user when an automatic check finds a signed update", async () => {
    render(
      <ApplicationUpdatePrompt
        checkDelayMs={0}
        checkUpdates={() => Promise.resolve(availableUpdate)}
        enabled
      />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "A new Aletheia version is ready",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Faster large-source scans.")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Update and restart",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("does not check when automatic checks are disabled", async () => {
    const checkUpdates = vi.fn(() => Promise.resolve(availableUpdate));
    render(
      <ApplicationUpdatePrompt
        checkDelayMs={0}
        checkUpdates={checkUpdates}
        enabled={false}
      />,
    );

    await new Promise((resolve) => window.setTimeout(resolve, 10));
    expect(checkUpdates).not.toHaveBeenCalled();
  });

  it("starts the approved update and shows failures safely", async () => {
    const user = userEvent.setup();
    const installUpdate = vi.fn(async () => {
      throw new Error("synthetic installer failure");
    });
    render(
      <ApplicationUpdatePrompt
        checkDelayMs={0}
        checkUpdates={() => Promise.resolve(availableUpdate)}
        enabled
        installUpdate={installUpdate}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Update and restart" }),
    );

    await waitFor(() => expect(installUpdate).toHaveBeenCalledOnce());
    expect(await screen.findByText("Update failed")).toBeTruthy();
    expect(
      screen.getByText(
        "The update could not be installed. Your current installation was left unchanged.",
      ),
    ).toBeTruthy();
  });
});
