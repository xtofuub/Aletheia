import { describe, expect, it } from "vitest";

import { formatSearchDisplay } from "./search-display";

describe("formatSearchDisplay", () => {
  it("uses a neutral protected-value marker", () => {
    expect(formatSearchDisplay("password=[REDACTED]")).toBe("password=••••••");
    expect(formatSearchDisplay("[redacted] | [REDACTED]")).toBe(
      "•••••• | ••••••",
    );
  });

  it("keeps ordinary evidence unchanged", () => {
    expect(formatSearchDisplay("portal.example.test/account/123")).toBe(
      "portal.example.test/account/123",
    );
  });
});
