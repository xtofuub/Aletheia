import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ImportWizard } from "./import-wizard";

describe("ImportWizard", () => {
  it("requires an authorization note before starting a synthetic import", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn().mockResolvedValue(undefined);
    render(<ImportWizard onClose={vi.fn()} onStart={onStart} />);

    await user.click(screen.getByRole("button", { name: /choose files/i }));
    expect(
      await screen.findByRole("heading", {
        name: /add an authorized dataset/i,
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(screen.getByRole("button", { name: /begin indexing/i }));

    expect(
      screen.getByText(/add a short authorization note/i),
    ).toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();

    await user.type(
      screen.getByLabelText(/authorization note/i),
      "Synthetic fixture review",
    );
    await user.click(screen.getByRole("button", { name: /begin indexing/i }));
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        datasetLabel: "records_valid",
        authorizationNote: "Synthetic fixture review",
      }),
    );
  });
});
