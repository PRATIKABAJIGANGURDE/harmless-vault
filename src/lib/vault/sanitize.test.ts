import { describe, expect, it } from "vitest";

import {
  isUuid,
  isValidPin,
  MAX_NAME_LENGTH,
  sanitizeFileName,
  sanitizeFolderName,
} from "./sanitize";

describe("sanitizeFileName", () => {
  it("keeps ordinary names intact", () => {
    expect(sanitizeFileName("holiday photo.jpg")).toBe("holiday photo.jpg");
  });

  it("strips path separators and traversal", () => {
    expect(sanitizeFileName("../../etc/passwd")).not.toContain("..");
    expect(sanitizeFileName("../../etc/passwd")).not.toContain("/");
    expect(sanitizeFileName("C:\\Windows\\system32.dll")).not.toContain("\\");
  });

  it("removes control characters", () => {
    expect(sanitizeFileName("bad\u0000name\u001f.txt")).toBe("badname.txt");
  });

  it("never returns an empty name", () => {
    expect(sanitizeFileName("   ").length).toBeGreaterThan(0);
    expect(sanitizeFileName("...").length).toBeGreaterThan(0);
  });

  it("truncates very long names", () => {
    const long = `${"a".repeat(500)}.txt`;
    const out = sanitizeFileName(long);
    expect(out.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expect(out.endsWith(".txt")).toBe(true);
  });
});

describe("sanitizeFolderName", () => {
  it("strips separators", () => {
    expect(sanitizeFolderName("a/b\\c")).not.toMatch(/[/\\]/);
  });
});

describe("isValidPin", () => {
  it("accepts exactly four digits", () => {
    expect(isValidPin("2580")).toBe(true);
  });
  it("rejects anything else", () => {
    for (const bad of ["", "123", "12345", "12a4", " 1234", "१२३४"]) {
      expect(isValidPin(bad)).toBe(false);
    }
  });
});

describe("isUuid", () => {
  it("accepts a v4 uuid and rejects junk", () => {
    expect(isUuid("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(true);
    expect(isUuid("../../etc")).toBe(false);
  });
});
