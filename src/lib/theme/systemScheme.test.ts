import { describe, expect, it } from "vitest";
import { currentSystemScheme } from "./systemScheme";

describe("currentSystemScheme", () => {
  it("reports dark when the OS prefers dark", () => {
    expect(currentSystemScheme((query) => ({ matches: query.includes("dark") }))).toBe("dark");
  });

  it("reports light otherwise", () => {
    expect(currentSystemScheme(() => ({ matches: false }))).toBe("light");
  });

  it("falls back to light with no browser to ask", () => {
    expect(currentSystemScheme(undefined)).toBe("light");
  });
});
