import { describe, it, expect } from "vitest";
import { resolvePath } from "../resolvePath";

describe("resolvePath", () => {
  describe("absolute paths inside workspace — accepted", () => {
    it("accepts a Windows absolute path inside the workspace", () => {
      expect(resolvePath("C:\\project\\src\\foo.ts", "C:\\project")).toBe("C:\\project\\src\\foo.ts");
    });

    it("accepts a Unix absolute path inside the workspace", () => {
      expect(resolvePath("/home/project/src/foo.ts", "/home/project")).toBe("/home/project/src/foo.ts");
    });

    it("accepts the workspace root itself", () => {
      expect(resolvePath("C:\\project", "C:\\project")).toBe("C:\\project");
      expect(resolvePath("/home/project", "/home/project")).toBe("/home/project");
    });
  });

  describe("relative paths — joined with base", () => {
    it("joins a forward-slash relative path to a Windows base with backslashes", () => {
      expect(resolvePath("src/foo.ts", "D:\\project")).toBe("D:\\project\\src\\foo.ts");
    });

    it("joins a backslash relative path to a Windows base with backslashes", () => {
      expect(resolvePath("src\\foo.ts", "D:\\project")).toBe("D:\\project\\src\\foo.ts");
    });

    it("joins a forward-slash relative path to a Unix base with forward slashes", () => {
      expect(resolvePath("src/foo.ts", "/home/project")).toBe("/home/project/src/foo.ts");
    });

    it("strips trailing separator from base before joining", () => {
      expect(resolvePath("src/foo.ts", "D:\\project\\")).toBe("D:\\project\\src\\foo.ts");
      expect(resolvePath("src/foo.ts", "/home/project/")).toBe("/home/project/src/foo.ts");
    });

    it("trims leading/trailing whitespace from the path", () => {
      expect(resolvePath("  src/foo.ts  ", "D:\\project")).toBe("D:\\project\\src\\foo.ts");
    });

    it("normalises mixed separators in relative path to match base", () => {
      expect(resolvePath("src/sub\\foo.ts", "D:\\project")).toBe("D:\\project\\src\\sub\\foo.ts");
      expect(resolvePath("src\\sub/foo.ts", "/home/project")).toBe("/home/project/src/sub/foo.ts");
    });

    it("collapses . segments", () => {
      expect(resolvePath("src/./foo.ts", "/home/project")).toBe("/home/project/src/foo.ts");
    });
  });

  describe("path traversal — throws", () => {
    it("throws on relative .. escaping workspace (Windows)", () => {
      expect(() => resolvePath("..\\evil.ts", "D:\\project")).toThrow("escapes workspace");
    });

    it("throws on relative .. escaping workspace (Unix)", () => {
      expect(() => resolvePath("../evil.ts", "/home/project")).toThrow("escapes workspace");
    });

    it("throws on deep .. chain that escapes workspace", () => {
      expect(() => resolvePath("src/../../evil.ts", "/home/project")).toThrow("escapes workspace");
    });

    it("throws on absolute path on a different drive", () => {
      expect(() => resolvePath("C:\\Users\\foo\\bar.ts", "D:\\project")).toThrow("escapes workspace");
    });

    it("throws on absolute path outside workspace directory", () => {
      expect(() => resolvePath("/home/user/.ssh/id_rsa", "/home/project")).toThrow("escapes workspace");
    });

    it("throws on absolute path that is a sibling of the workspace root", () => {
      expect(() => resolvePath("/home/project_evil/foo.ts", "/home/project")).toThrow("escapes workspace");
    });

    it("throws on UNC path outside workspace", () => {
      expect(() => resolvePath("\\\\server\\share\\file.ts", "D:\\project")).toThrow("escapes workspace");
    });
  });
});
