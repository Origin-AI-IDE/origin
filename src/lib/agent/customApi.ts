export type CustomApiFormat = "chat-completions" | "responses";

export interface CustomApiConfig {
  baseUrl: string;
  model: string;
  format: CustomApiFormat;
}

const STORAGE_KEY = "origin-custom-api";

export function loadCustomApiConfig(): CustomApiConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { baseUrl: "", model: "", format: "chat-completions" };
    const value: unknown = JSON.parse(stored);
    if (typeof value !== "object" || value === null) {
      return { baseUrl: "", model: "", format: "chat-completions" };
    }

    const config = value as Partial<CustomApiConfig>;
    return {
      baseUrl: typeof config.baseUrl === "string" ? config.baseUrl : "",
      model: typeof config.model === "string" ? config.model : "",
      format: config.format === "responses" ? "responses" : "chat-completions",
    };
  } catch (error) {
    console.error("[Custom API] Failed to load configuration:", error);
    return { baseUrl: "", model: "", format: "chat-completions" };
  }
}

export function saveCustomApiConfig(config: CustomApiConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    baseUrl: config.baseUrl.trim().replace(/\/+$/, ""),
    model: config.model.trim(),
    format: config.format,
  }));
}

export function customApiModel(config: CustomApiConfig) {
  const model = config.model.trim();
  return model
    ? [{ id: model, name: model, description: "Configured custom API model", color: "#8b5cf6" }]
    : [];
}
