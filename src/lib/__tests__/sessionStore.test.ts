import { describe, it, expect } from "vitest";
import { dbMsgsToDisplay } from "../sessionStore";
import type { DbMessage } from "../db";

function msg(overrides: Partial<DbMessage> = {}): DbMessage {
  return {
    id: "1",
    session_id: "s1",
    message_type: "assistant",
    content: "hello",
    status: "complete",
    model: null,
    tool_calls_json: null,
    attachments_json: null,
    editor_context_json: null,
    created_at: 0,
    ...overrides,
  };
}

describe("dbMsgsToDisplay", () => {
  describe("filtering", () => {
    it("includes user and assistant messages", () => {
      const result = dbMsgsToDisplay([
        msg({ message_type: "user", content: "hi" }),
        msg({ message_type: "assistant", content: "hello" }),
      ]);
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe("user");
      expect(result[1].role).toBe("assistant");
    });

    it("excludes non-user/assistant message types", () => {
      const result = dbMsgsToDisplay([
        msg({ message_type: "system" as "user", content: "system msg" }),
        msg({ message_type: "assistant", content: "visible" }),
      ]);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("visible");
    });

    it("returns empty array for empty input", () => {
      expect(dbMsgsToDisplay([])).toEqual([]);
    });
  });

  describe("interrupted status", () => {
    it("appends interrupted marker when status is interrupted and content exists", () => {
      const result = dbMsgsToDisplay([
        msg({ content: "partial response", status: "interrupted" }),
      ]);
      expect(result[0].content).toBe("partial response\n\n[Response interrupted]");
    });

    it("shows only marker when interrupted with empty content", () => {
      const result = dbMsgsToDisplay([
        msg({ content: "", status: "interrupted" }),
      ]);
      expect(result[0].content).toBe("[Response interrupted]");
    });

    it("leaves complete messages unchanged", () => {
      const result = dbMsgsToDisplay([msg({ content: "done", status: "complete" })]);
      expect(result[0].content).toBe("done");
    });
  });

  describe("file mentions", () => {
    it("parses attachments_json into fileMentions", () => {
      const result = dbMsgsToDisplay([
        msg({
          message_type: "user",
          attachments_json: JSON.stringify(["src/foo.ts", "src/bar.ts"]),
        }),
      ]);
      expect(result[0].fileMentions).toEqual(["src/foo.ts", "src/bar.ts"]);
    });

    it("sets sourceFilePath on the next assistant message when user mentions exactly one file", () => {
      const result = dbMsgsToDisplay([
        msg({ message_type: "user", attachments_json: JSON.stringify(["src/foo.ts"]) }),
        msg({ message_type: "assistant", content: "here you go" }),
      ]);
      expect(result[1].sourceFilePath).toBe("src/foo.ts");
    });

    it("does not set sourceFilePath when user mentions multiple files", () => {
      const result = dbMsgsToDisplay([
        msg({ message_type: "user", attachments_json: JSON.stringify(["a.ts", "b.ts"]) }),
        msg({ message_type: "assistant", content: "done" }),
      ]);
      expect(result[1].sourceFilePath).toBeUndefined();
    });

    it("does not set sourceFilePath when user mentions zero files", () => {
      const result = dbMsgsToDisplay([
        msg({ message_type: "user", attachments_json: JSON.stringify([]) }),
        msg({ message_type: "assistant", content: "done" }),
      ]);
      expect(result[1].sourceFilePath).toBeUndefined();
    });

    it("returns undefined fileMentions when attachments_json is null", () => {
      const result = dbMsgsToDisplay([msg({ message_type: "user", attachments_json: null })]);
      expect(result[0].fileMentions).toBeUndefined();
    });
  });

  describe("tool_calls_json — new format (type field present)", () => {
    it("restores text and tool-call parts from new format", () => {
      const parts = [
        { type: "text", content: "thinking..." },
        { type: "tool-call", tc: { id: "tc1", toolName: "read_file", args: {}, status: "complete" } },
      ];
      const result = dbMsgsToDisplay([
        msg({ tool_calls_json: JSON.stringify(parts) }),
      ]);
      expect(result[0].parts).toHaveLength(2);
      expect(result[0].parts![0]).toMatchObject({ type: "text", content: "thinking..." });
      expect(result[0].parts![1]).toMatchObject({ type: "tool-call" });
      expect((result[0].parts![1] as { type: string; tc: { id: string } }).tc.id).toBe("tc1");
    });

    it("forces status to complete and strips approve/reject", () => {
      const parts = [
        { type: "tool-call", tc: { id: "tc1", toolName: "bash", args: {}, status: "running" } },
      ];
      const result = dbMsgsToDisplay([msg({ tool_calls_json: JSON.stringify(parts) })]);
      const tc = (result[0].parts![0] as { type: string; tc: { status: string; approve: unknown; reject: unknown } }).tc;
      expect(tc.status).toBe("complete");
      expect(tc.approve).toBeUndefined();
      expect(tc.reject).toBeUndefined();
    });
  });

  describe("tool_calls_json — old format (no type field)", () => {
    it("converts legacy ToolCallDisplay array to tool-call parts", () => {
      const oldParts = [
        { id: "tc1", toolName: "write_file", args: { path: "x.ts" }, status: "complete" },
      ];
      const result = dbMsgsToDisplay([msg({ tool_calls_json: JSON.stringify(oldParts) })]);
      expect(result[0].parts).toHaveLength(1);
      expect(result[0].parts![0].type).toBe("tool-call");
    });
  });

  describe("tool_calls_json — malformed JSON", () => {
    it("ignores malformed tool_calls_json and returns no parts", () => {
      const result = dbMsgsToDisplay([msg({ tool_calls_json: "not-json{{" })]);
      expect(result[0].parts).toBeUndefined();
    });
  });

  describe("plan card extraction", () => {
    const validPlanXml = `<origin-plan><title>My Plan</title><step file="src/foo.ts" action="edit">Update foo</step></origin-plan>`;

    it("strips plan XML from content and adds plan-card part", () => {
      const result = dbMsgsToDisplay([
        msg({ content: `Here is my plan:\n${validPlanXml}`, status: "complete" }),
      ]);
      expect(result[0].content).not.toContain("<origin-plan>");
      const planPart = result[0].parts?.find(p => p.type === "plan-card");
      expect(planPart).toBeDefined();
      expect(planPart?.type).toBe("plan-card");
    });

    it("does not extract plan card from interrupted messages", () => {
      const result = dbMsgsToDisplay([
        msg({ content: `Here is:\n${validPlanXml}`, status: "interrupted" }),
      ]);
      const planPart = result[0].parts?.find(p => p.type === "plan-card");
      expect(planPart).toBeUndefined();
    });

    it("does not extract plan card from user messages", () => {
      const result = dbMsgsToDisplay([
        msg({ message_type: "user", content: validPlanXml, status: "complete" }),
      ]);
      const planPart = result[0].parts?.find(p => p.type === "plan-card");
      expect(planPart).toBeUndefined();
    });
  });

  describe("editor context", () => {
    it("parses editor_context_json and clears code/language fields", () => {
      const ctx = { filename: "foo.ts", code: "original code", language: "typescript", type: "selection", startLine: 1, endLine: 5 };
      const result = dbMsgsToDisplay([
        msg({ message_type: "user", editor_context_json: JSON.stringify(ctx) }),
      ]);
      expect(result[0].editorContext?.filename).toBe("foo.ts");
      expect(result[0].editorContext?.code).toBe("");
      expect(result[0].editorContext?.language).toBe("");
    });

    it("returns null editorContext when editor_context_json is null", () => {
      const result = dbMsgsToDisplay([msg({ editor_context_json: null })]);
      expect(result[0].editorContext).toBeUndefined();
    });
  });
});
