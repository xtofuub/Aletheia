import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatCount,
  formatDateTime,
  formatDuration,
  formatPathForDisplay,
  formatProgressPercent,
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

  it("keeps active progress visible below one percent", () => {
    expect(formatProgressPercent(0)).toBe("0%");
    expect(formatProgressPercent(0.01)).toBe("<1%");
    expect(formatProgressPercent(42.4)).toBe("42%");
    expect(formatProgressPercent(120)).toBe("100%");
  });

  it("hides Windows long-path prefixes without changing the stored path", () => {
    expect(formatPathForDisplay("\\\\?\\C:\\Synthetic\\Corpus")).toBe(
      "C:\\Synthetic\\Corpus",
    );
    expect(
      formatPathForDisplay("\\\\?\\UNC\\synthetic-host\\share\\Corpus"),
    ).toBe("\\\\synthetic-host\\share\\Corpus");
    expect(formatPathForDisplay("C:\\Synthetic\\Corpus")).toBe(
      "C:\\Synthetic\\Corpus",
    );
  });
});
