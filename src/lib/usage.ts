const USAGE_KEY = "origin_ai_usage";

export interface ModelUsage {
  modelId:          string;
  modelName:        string;
  providerId:       string;
  inputTokens:      number;
  outputTokens:     number;
  cacheReadTokens?: number;
  cost:             number;
  color:            string;
}

export type UsageStore = Record<string, ModelUsage>;

export function readUsage(): UsageStore {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    return raw ? (JSON.parse(raw) as UsageStore) : {};
  } catch {
    return {};
  }
}

export function recordUsage(
  modelId:          string,
  modelName:        string,
  providerId:       string,
  inputTokens:      number,
  outputTokens:     number,
  cost:             number,
  color:            string,
  cacheReadTokens?: number,
): void {
  const store = readUsage();
  const existing = store[modelId];
  store[modelId] = {
    modelId,
    modelName,
    providerId,
    inputTokens:      (existing?.inputTokens      ?? 0) + inputTokens,
    outputTokens:     (existing?.outputTokens     ?? 0) + outputTokens,
    cacheReadTokens:  (existing?.cacheReadTokens  ?? 0) + (cacheReadTokens ?? 0),
    cost:             (existing?.cost             ?? 0) + cost,
    color,
  };
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(store));
  } catch { /* storage full */ }
}

export function resetUsage(): void {
  localStorage.removeItem(USAGE_KEY);
}

export function getTotalCost(): number {
  return Object.values(readUsage()).reduce((sum, m) => sum + m.cost, 0);
}
