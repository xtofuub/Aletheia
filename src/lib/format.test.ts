import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatCount,
  formatDateTime,
  formatDuration,
  formatRate,
} from "./format";

describe("format helpers", () => {
  it("formats storage sizes without exposing source values", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 ** 4)).toBe("1.0 TB");
  });

  it("formats counts and rates for dense dashboard labels", () => {
    expect(formatCount(12500)).toBe("12.5K");
    expect(formatRate(12500)).toBe("12.5K/s");
  });

  it("handles missing timestamps", () => {
    expect(formatDateTime(null)).toBe("Not yet");
  });

  it("formats long-running estimates", () => {
    expect(formatDuration(null)).toBe("Calculating");
    expect(formatDuration(65_000)).toBe("1m 5s");
    expect(formatDuration(7_260_000)).toBe("2h 1m");
    expect(formatDuration(183_600_000)).toBe("2d 3h");
  });
});
