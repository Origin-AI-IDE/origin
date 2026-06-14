import { describe, it, expect } from "vitest";
import { resolveTargetPath } from "../resolveTargetPath";

const ROOT = "C:/project";

describe("resolveTargetPath", () => {
  describe("Priority 1 — LLM path + mentions: suffix match", () => {
    it("returns the mention that ends with the LLM path", () => {
      expect(resolveTargetPath(
        "src/auth.ts",
        ["C:/project/src/auth.ts"],
        undefined, ROOT, [],
      )).toBe("C:/project/src/auth.ts");
    });

    it("is case-insensitive", () => {
      expect(resolveTargetPath(
        "SRC/Auth.ts",
        ["C:/project/src/auth.ts"],
        undefined, ROOT, [],
      )).toBe("C:/project/src/auth.ts");
    });

    it("picks the longest suffix match when multiple mentions qualify", () => {
      expect(resolveTargetPath(
        "auth.ts",
        ["C:/project/src/auth.ts", "C:/project/src/sub/auth.ts"],
        undefined, ROOT, [],
      )).toBe("C:/project/src/sub/auth.ts");
    });

    it("normalises Windows backslashes in both llmFilePath and mentions", () => {
      expect(resolveTargetPath(
        "src\\auth.ts",
        ["C:\\project\\src\\auth.ts"],
        undefined, ROOT, [],
      )).toBe("C:\\project\\src\\auth.ts");
    });
  });

  describe("Priority 2 — LLM path + mentions: basename match", () => {
    it("returns the sole basename match when suffix fails", () => {
      expect(resolveTargetPath(
        "auth.ts",
        ["C:/project/api/auth.ts"],
        undefined, ROOT, [],
      )).toBe("C:/project/api/auth.ts");
    });

    it("prefers sourceFilePath when multiple basename matches exist", () => {
      // LLM says "components/auth.ts" — neither mention ends with that path, so
      // suffix match is empty and we fall through to basename disambiguation.
      const source = "C:/project/api/auth.ts";
      expect(resolveTargetPath(
        "components/auth.ts",
        ["C:/project/src/auth.ts", "C:/project/api/auth.ts"],
        source, ROOT, [],
      )).toBe(source);
    });

    it("falls back to first basename match when sourceFilePath is not in the list", () => {
      expect(resolveTargetPath(
        "auth.ts",
        ["C:/project/src/auth.ts", "C:/project/api/auth.ts"],
        "C:/project/other/auth.ts", ROOT, [],
      )).toBe("C:/project/src/auth.ts");
    });
  });

  describe("Priority 3 — no LLM path, single mention", () => {
    it("returns the sole mention when llmFilePath is undefined", () => {
      expect(resolveTargetPath(
        undefined,
        ["C:/project/src/auth.ts"],
        undefined, ROOT, [],
      )).toBe("C:/project/src/auth.ts");
    });
  });

  describe("Priority 3b — LLM path present, single mention", () => {
    it("returns the single mention even when LLM path doesn't match it", () => {
      expect(resolveTargetPath(
        "unrelated.ts",
        ["C:/project/src/auth.ts"],
        undefined, ROOT, [],
      )).toBe("C:/project/src/auth.ts");
    });
  });

  describe("Priority 4 — LLM path + open tabs: suffix match", () => {
    it("returns the tab that ends with the LLM path", () => {
      expect(resolveTargetPath(
        "src/foo.ts",
        undefined,
        undefined, ROOT,
        ["C:/project/src/foo.ts", "C:/project/src/bar.ts"],
      )).toBe("C:/project/src/foo.ts");
    });

    it("picks the longest suffix among open tabs", () => {
      expect(resolveTargetPath(
        "foo.ts",
        undefined,
        undefined, ROOT,
        ["C:/project/a/foo.ts", "C:/project/a/b/foo.ts"],
      )).toBe("C:/project/a/b/foo.ts");
    });
  });

  describe("Priority 4b — LLM path + open tabs: basename match", () => {
    it("returns the basename-matching tab", () => {
      expect(resolveTargetPath(
        "bar.ts",
        undefined,
        undefined, ROOT,
        ["C:/project/src/foo.ts", "C:/project/src/bar.ts"],
      )).toBe("C:/project/src/bar.ts");
    });

    it("prefers sourceFilePath among multiple basename-matching tabs", () => {
      // LLM says "views/bar.ts" — neither tab ends with that path, so
      // suffix match is empty and basename disambiguation uses sourceFilePath.
      const source = "C:/project/api/bar.ts";
      expect(resolveTargetPath(
        "views/bar.ts",
        undefined,
        source, ROOT,
        ["C:/project/src/bar.ts", "C:/project/api/bar.ts"],
      )).toBe(source);
    });
  });

  describe("Priority 5 — sourceFilePath fallback", () => {
    it("returns sourceFilePath when everything else is absent", () => {
      expect(resolveTargetPath(
        undefined,
        undefined,
        "C:/project/src/active.ts",
        ROOT, [],
      )).toBe("C:/project/src/active.ts");
    });

    it("returns sourceFilePath when llm path matches nothing in tabs", () => {
      expect(resolveTargetPath(
        "nonexistent.ts",
        undefined,
        "C:/project/src/active.ts",
        ROOT,
        ["C:/project/src/other.ts"],
      )).toBe("C:/project/src/active.ts");
    });
  });

  describe("no match — returns undefined", () => {
    it("returns undefined when all inputs are absent", () => {
      expect(resolveTargetPath(undefined, undefined, undefined, ROOT, [])).toBeUndefined();
    });

    it("returns undefined when llm path matches nothing and no source", () => {
      expect(resolveTargetPath(
        "ghost.ts",
        undefined,
        undefined, ROOT,
        ["C:/project/src/foo.ts"],
      )).toBeUndefined();
    });
  });
});
