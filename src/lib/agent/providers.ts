import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { tauriFetch } from "../tauri-fetch";

const OPENAI_COMPAT_BASE: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  deepseek:   "https://api.deepseek.com",
  mistral:    "https://api.mistral.ai/v1",
  groq:       "https://api.groq.com/openai/v1",
  xai:        "https://api.x.ai/v1",
  cohere:     "https://api.cohere.com/compatibility/v1",
  lmstudio:   "http://localhost:1234/v1",
  vllm:       "http://localhost:8000/v1",
  ollama:     "http://localhost:11434/v1",
};

export function buildLanguageModel(
  providerId: string,
  modelId: string,
  apiKey: string,
): LanguageModel {
  switch (providerId) {
    case "anthropic":
      return createAnthropic({ apiKey, fetch: tauriFetch })(modelId);

    case "openai":
      return createOpenAI({ apiKey, fetch: tauriFetch })(modelId);

    case "gemini":
      return createGoogleGenerativeAI({ apiKey, fetch: tauriFetch })(modelId);

    default: {
      const baseURL = OPENAI_COMPAT_BASE[providerId];
      if (!baseURL) throw new Error(`Unknown provider: ${providerId}`);
      return createOpenAICompatible({
        name: providerId,
        baseURL,
        apiKey: apiKey || "no-key",
        fetch: tauriFetch,
      })(modelId);
    }
  }
}
