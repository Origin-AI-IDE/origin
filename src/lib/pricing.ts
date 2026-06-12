import { invoke } from "@tauri-apps/api/core";

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const CACHE_KEY   = "origin_pricing_cache";
const CACHE_TTL   = 24 * 60 * 60 * 1000; // 24 h

interface PricingEntry {
  input_cost_per_token?:  number;
  output_cost_per_token?: number;
}

type PricingMap = Record<string, PricingEntry>;

// Keys to try in order for each model ID (first hit wins)
const MODEL_KEY_MAP: Record<string, string[]> = {
  "claude-sonnet-4-6":        ["claude-sonnet-4-6", "anthropic/claude-sonnet-4-6", "claude-3-5-sonnet-20241022"],
  "claude-opus-4-8":          ["claude-opus-4-8",   "anthropic/claude-opus-4-8",   "claude-opus-4", "claude-3-opus-20240229"],
  "claude-haiku-4-5":         ["claude-haiku-4-5",  "claude-haiku-4-5-20251001",   "claude-3-5-haiku-20241022"],
  "gpt-4o":                   ["gpt-4o"],
  "gpt-4o-mini":              ["gpt-4o-mini"],
  "o3-mini":                  ["o3-mini"],
  "gemini-2.5-pro":           ["gemini/gemini-2.5-pro-preview-05-06", "gemini/gemini-2.5-pro"],
  "gemini-2.5-flash":         ["gemini/gemini-2.5-flash-preview-04-17", "gemini/gemini-2.5-flash"],
  "mistral-large-latest":     ["mistral/mistral-large-latest"],
  "mistral-small-latest":     ["mistral/mistral-small-latest"],
  "deepseek-chat":            ["deepseek/deepseek-chat"],
  "deepseek-reasoner":        ["deepseek/deepseek-reasoner"],
  "llama-3.3-70b-versatile":  ["groq/llama-3.3-70b-versatile"],
  "moonshotai/kimi-k2":       ["groq/moonshotai/kimi-k2"],
  "command-r-plus":           ["cohere/command-r-plus"],
  "command-r":                ["cohere/command-r"],
  "grok-3":                   ["xai/grok-3"],
  "grok-3-mini":              ["xai/grok-3-mini"],
};

let _pricingMap: PricingMap | null = null;

function readCache(): PricingMap | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw) as { ts: number; data: PricingMap };
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(data: PricingMap): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch { /* storage full — skip */ }
}

export async function ensurePricing(): Promise<void> {
  if (_pricingMap) return;
  const cached = readCache();
  if (cached) { _pricingMap = cached; return; }
  try {
    const text = await invoke<string>("fetch_text", { url: LITELLM_URL });
    const data = JSON.parse(text) as PricingMap;
    _pricingMap = data;
    writeCache(data);
  } catch {
    _pricingMap = {};
  }
}

export function computeCost(modelId: string, inputTokens: number, outputTokens: number): number {
  if (!_pricingMap) return 0;
  const keys = MODEL_KEY_MAP[modelId] ?? [modelId];
  let entry: PricingEntry | undefined;
  for (const k of keys) {
    entry = _pricingMap[k];
    if (entry?.input_cost_per_token !== undefined) break;
  }
  if (!entry) return 0;
  const inCost  = (entry.input_cost_per_token  ?? 0) * inputTokens;
  const outCost = (entry.output_cost_per_token ?? 0) * outputTokens;
  return inCost + outCost;
}
