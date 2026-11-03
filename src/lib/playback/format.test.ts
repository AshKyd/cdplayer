import { describe, expect, it } from "vitest";
import { formatClock } from "./format";

describe("formatClock", () => {
  it("formats minutes and zero-padded seconds", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(5)).toBe("0:05");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(3599)).toBe("59:59");
  });

  it("adds hours from one hour up, padding the minutes", () => {
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(36000 + 61)).toBe("10:01:01");
  });

  it("rounds down to whole seconds", () => {
    expect(formatClock(59.9)).toBe("0:59");
  });

  it("treats negative time as zero", () => {
    expect(formatClock(-1)).toBe("0:00");
  });
});
