import { describe, it, expect } from "vitest";
import { applyEdit } from "../applyEdit";

describe("applyEdit", () => {
  it("replaces an exact match in the middle of the file", () => {
    expect(applyEdit("hello world foo", "world", "WORLD")).toBe("hello WORLD foo");
  });

  it("replaces a match at the start", () => {
    expect(applyEdit("function foo() {}", "function foo", "function bar"))
      .toBe("function bar() {}");
  });

  it("replaces a match at the end", () => {
    expect(applyEdit("const x = 1;", "= 1;", "= 2;")).toBe("const x = 2;");
  });

  it("replaces multi-line original", () => {
    const file = "function foo() {\n  return 1;\n}\n";
    const original = "  return 1;\n";
    const updated  = "  return 42;\n";
    expect(applyEdit(file, original, updated)).toBe("function foo() {\n  return 42;\n}\n");
  });

  it("returns null when the original is not found", () => {
    expect(applyEdit("hello world", "xyz", "XYZ")).toBeNull();
    expect(applyEdit("", "anything", "replaced")).toBeNull();
  });

  it("replaces only the first occurrence when there are multiple", () => {
    const result = applyEdit("foo foo foo", "foo", "bar");
    expect(result).toBe("bar foo foo");
  });

  it("falls back to trimmed match when exact match fails", () => {
    const file = "function foo() {}";
    // original has extra surrounding whitespace
    const result = applyEdit(file, "  function foo  ", "function bar");
    expect(result).toBe("function bar() {}");
  });

  it("uses updated verbatim (does not trim updated)", () => {
    expect(applyEdit("x = 1", "x = 1", "  x = 2  ")).toBe("  x = 2  ");
  });

  it("handles empty updated (deletion)", () => {
    expect(applyEdit("aXb", "X", "")).toBe("ab");
  });

  it("handles empty original that exists at index 0", () => {
    // empty string is always found at index 0
    const result = applyEdit("abc", "", "PREFIX");
    expect(result).toBe("PREFIXabc");
  });

  it("does not modify file when original not found even with trim", () => {
    expect(applyEdit("function foo() {}", "function bar", "function baz")).toBeNull();
  });
});
