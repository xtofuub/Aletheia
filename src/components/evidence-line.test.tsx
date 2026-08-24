import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { EvidenceLine } from "@/components/evidence-line";

afterEach(cleanup);

describe("EvidenceLine", () => {
  it("presents Android app rows as labelled values without hiding raw data", async () => {
    const user = userEvent.setup();
    const raw =
      "android://QUJDREVGR0g=@com.example.mobile/:sample-user:sample-value-42 | //qujdrevgr0g=@com.example.mobile";

    render(<EvidenceLine value={raw} />);

    expect(screen.getByText("Android app")).toBeTruthy();
    expect(screen.getByText("com.example.mobile")).toBeTruthy();
    expect(screen.getByText("sample-user")).toBeTruthy();
    expect(screen.getByText("sample-value-42")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Technical details" }));
    expect(screen.getByText("Raw source row")).toBeTruthy();
    expect(screen.getByText(raw)).toBeTruthy();
  });

  it("keeps ordinary evidence rows unchanged", () => {
    const raw = "https://example.invalid/login:sample-user:sample-value";
    render(<EvidenceLine value={raw} />);
    expect(screen.getByText(raw)).toBeTruthy();
  });
});
