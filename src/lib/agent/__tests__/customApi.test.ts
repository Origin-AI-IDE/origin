import { afterEach, describe, expect, it, vi } from "vitest";
import {
  customApiModel,
  loadCustomApiConfig,
  saveCustomApiConfig,
} from "../customApi";

describe("custom API configuration", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    "https://api.example.com",
    "https://api.example.com/v1",
  ])("preserves the configured base URL %s without forcing a version path", baseUrl => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });

    saveCustomApiConfig({ baseUrl, model: "custom-model", format: "chat-completions" });

    expect(loadCustomApiConfig()).toEqual({
      baseUrl,
      model: "custom-model",
      format: "chat-completions",
    });
  });

  it("exposes the configured model for the model picker", () => {
    expect(customApiModel({
      baseUrl: "https://api.example.com",
      model: "vendor/model-name",
      format: "responses",
    })).toMatchObject([{ id: "vendor/model-name", name: "vendor/model-name" }]);
  });
});
