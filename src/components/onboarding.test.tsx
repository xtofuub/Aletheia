import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { Onboarding } from "./onboarding";

describe("Onboarding", () => {
  it("requires explicit authorization before opening the workspace", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      <Onboarding
        initialStorageRoot={"C:\\Aletheia Test"}
        onComplete={onComplete}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Enter Aletheia" }));
    expect(
      screen.getByText("Confirm authorization before continuing."),
    ).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("checkbox", {
        name: /I am authorized to possess and analyze/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Enter Aletheia" }));

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationConfirmed: true,
        storageRoot: "C:\\Aletheia Test",
        networkDisabled: true,
      }),
    );
  });
});
