import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, Eye, EyeOff, Bot, Palette, Check, MessageSquareDot } from "lucide-react";
import { PROVIDERS } from "../ai/providers";
import { loadApiKey, saveApiKey, deleteApiKey } from "../../lib/secrets";
import { useTheme } from "../../themes/ThemeContext";
import { DEFAULT_SYSTEM_PROMPT } from "../../lib/ai";

// ── Constants ────────────────────────────────────────────────────────────────

const LOCAL_IDS = new Set(["ollama", "lmstudio", "vllm"]);
const API_PROVIDERS = PROVIDERS.filter(p => !LOCAL_IDS.has(p.id));

type Section = "ai" | "prompt" | "appearance";

// ── Nav ──────────────────────────────────────────────────────────────────────

function NavItem({ active, icon, label, onClick }: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "9px",
        width: "100%",
        padding: "7px 10px",
        borderRadius: "6px",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        fontSize: "13px",
        fontWeight: active ? 500 : 400,
        backgroundColor: active ? "var(--origin-bg-hover)" : "transparent",
        color: active ? "var(--origin-fg-default)" : "var(--origin-fg-muted)",
        transition: "background 0.1s",
      }}
      onMouseEnter={e => {
        if (!active) e.currentTarget.style.backgroundColor = "var(--origin-bg-hover)";
      }}
      onMouseLeave={e => {
        if (!active) e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      <span style={{ opacity: active ? 1 : 0.7, display: "flex" }}>{icon}</span>
      {label}
    </button>
  );
}

// ── AI Providers Section ─────────────────────────────────────────────────────

type KeyState = {
  value: string;
  original: string;
  visible: boolean;
  saving: boolean;
  justSaved: boolean;
};

function AIProvidersSection() {
  const { theme } = useTheme();
  const isDark = theme.type === "dark";
  const [keys, setKeys] = useState<Record<string, KeyState>>(() =>
    Object.fromEntries(
      API_PROVIDERS.map(p => [p.id, { value: "", original: "", visible: false, saving: false, justSaved: false }])
    )
  );

  useEffect(() => {
    API_PROVIDERS.forEach(async ({ id }) => {
      const key = await loadApiKey(id).catch(() => null);
      if (key) {
        setKeys(prev => ({
          ...prev,
          [id]: { ...prev[id], value: key, original: key },
        }));
      }
    });
  }, []);

  const update = useCallback((id: string, patch: Partial<KeyState>) => {
    setKeys(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  async function handleSave(id: string) {
    const { value } = keys[id];
    update(id, { saving: true });
    try {
      if (value.trim()) {
        await saveApiKey(id, value.trim());
        update(id, { saving: false, original: value.trim(), justSaved: true });
        setTimeout(() => update(id, { justSaved: false }), 1800);
      } else {
        await deleteApiKey(id);
        update(id, { saving: false, original: "", justSaved: true });
        setTimeout(() => update(id, { justSaved: false }), 1800);
      }
    } catch {
      update(id, { saving: false });
    }
  }

  async function handleClear(id: string) {
    await deleteApiKey(id).catch(() => {});
    update(id, { value: "", original: "" });
  }

  return (
    <div style={{ padding: "2px 0 16px" }}>
      <p style={{ fontSize: "12px", color: "var(--origin-fg-muted)", marginBottom: "18px", lineHeight: 1.5 }}>
        API keys are stored in your OS keychain and never leave your device.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {API_PROVIDERS.map(provider => {
          const state = keys[provider.id];
          if (!state) return null;
          const isDirty = state.value !== state.original;
          const hasSaved = state.original !== "";

          return (
            <div
              key={provider.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "10px 12px",
                borderRadius: "8px",
                border: "1px solid var(--origin-border-default)",
                backgroundColor: "var(--origin-bg-base)",
              }}
            >
              {/* Provider icon */}
              <div style={{
                width: 28, height: 28, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: "6px",
                backgroundColor: provider.icon ? "transparent" : provider.color,
                overflow: "hidden",
              }}>
                {provider.icon ? (
                  <img
                    src={provider.icon}
                    alt={provider.name}
                    style={{
                      width: 20, height: 20,
                      filter: provider.invert ? (isDark ? "brightness(0) invert(1)" : "none") : "none",
                    }}
                  />
                ) : (
                  <span style={{ fontSize: "10px", fontWeight: 700, color: provider.textColor }}>
                    {provider.initial}
                  </span>
                )}
              </div>

              {/* Name */}
              <div style={{ width: 90, flexShrink: 0 }}>
                <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--origin-fg-default)" }}>
                  {provider.name}
                </span>
                {hasSaved && (
                  <div style={{ display: "flex", alignItems: "center", gap: "3px", marginTop: "1px" }}>
                    <Check size={10} style={{ color: "var(--origin-semantic-success)" }} />
                    <span style={{ fontSize: "10px", color: "var(--origin-semantic-success)" }}>Key saved</span>
                  </div>
                )}
              </div>

              {/* Key input */}
              <div style={{ flex: 1, position: "relative" }}>
                <input
                  type={state.visible ? "text" : "password"}
                  value={state.value}
                  placeholder="Paste API key…"
                  onChange={e => update(provider.id, { value: e.target.value })}
                  onKeyDown={e => { if (e.key === "Enter") handleSave(provider.id); }}
                  style={{
                    width: "100%",
                    padding: "6px 30px 6px 9px",
                    borderRadius: "6px",
                    border: "1px solid var(--origin-border-default)",
                    backgroundColor: "var(--origin-bg-sidebar)",
                    color: "var(--origin-fg-default)",
                    fontSize: "12px",
                    fontFamily: "var(--font-mono)",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                <button
                  onClick={() => update(provider.id, { visible: !state.visible })}
                  style={{
                    position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer",
                    color: "var(--origin-fg-subtle)", padding: 0, display: "flex",
                  }}
                  tabIndex={-1}
                >
                  {state.visible ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                <button
                  onClick={() => handleSave(provider.id)}
                  disabled={!isDirty || state.saving}
                  style={{
                    padding: "5px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--origin-border-default)",
                    backgroundColor: state.justSaved
                      ? "color-mix(in srgb, var(--origin-semantic-success) 15%, transparent)"
                      : isDirty
                        ? "var(--origin-fg-default)"
                        : "transparent",
                    color: state.justSaved
                      ? "var(--origin-semantic-success)"
                      : isDirty
                        ? "var(--origin-bg-base)"
                        : "var(--origin-fg-subtle)",
                    fontSize: "12px",
                    fontWeight: 500,
                    cursor: isDirty ? "pointer" : "default",
                    transition: "all 0.15s",
                    minWidth: 50,
                  }}
                >
                  {state.saving ? "…" : state.justSaved ? "Saved!" : "Save"}
                </button>
                {hasSaved && (
                  <button
                    onClick={() => handleClear(provider.id)}
                    style={{
                      padding: "5px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--origin-border-default)",
                      backgroundColor: "transparent",
                      color: "var(--origin-fg-muted)",
                      fontSize: "12px",
                      cursor: "pointer",
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Local providers note */}
      <div style={{
        marginTop: "20px",
        padding: "10px 12px",
        borderRadius: "8px",
        border: "1px solid var(--origin-border-default)",
        backgroundColor: "var(--origin-bg-base)",
      }}>
        <div style={{ fontSize: "12px", fontWeight: 500, color: "var(--origin-fg-muted)", marginBottom: "2px" }}>
          Local providers (Ollama, LM Studio, vLLM)
        </div>
        <div style={{ fontSize: "12px", color: "var(--origin-fg-subtle)" }}>
          No API key required. Make sure your local server is running before starting a chat.
        </div>
      </div>
    </div>
  );
}

// ── Appearance Section ───────────────────────────────────────────────────────

function AppearanceSection() {
  const { theme, themes, setTheme } = useTheme();

  return (
    <div style={{ padding: "2px 0 16px" }}>
      <div style={{ marginBottom: "20px" }}>
        <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--origin-fg-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" }}>
          Theme
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {themes.map(t => {
            const isActive = t.name === theme.name;
            return (
              <button
                key={t.name}
                onClick={() => setTheme(t)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: `1px solid ${isActive ? "var(--origin-fg-muted)" : "var(--origin-border-default)"}`,
                  backgroundColor: isActive ? "var(--origin-bg-hover)" : "var(--origin-bg-base)",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.1s",
                }}
                onMouseEnter={e => {
                  if (!isActive) e.currentTarget.style.backgroundColor = "var(--origin-bg-hover)";
                }}
                onMouseLeave={e => {
                  if (!isActive) e.currentTarget.style.backgroundColor = "var(--origin-bg-base)";
                }}
              >
                <div style={{
                  width: 20, height: 20, borderRadius: "50%",
                  border: "2px solid var(--origin-border-default)",
                  backgroundColor: t.type === "dark" ? "#0a0a0a" : "#ffffff",
                  flexShrink: 0,
                }} />
                <span style={{ fontSize: "13px", color: "var(--origin-fg-default)", fontWeight: isActive ? 500 : 400 }}>
                  {t.name}
                </span>
                {isActive && (
                  <Check size={14} style={{ marginLeft: "auto", color: "var(--origin-fg-default)" }} />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── System Prompt Section ────────────────────────────────────────────────────

function SystemPromptSection() {
  const [value, setValue] = useState(
    () => localStorage.getItem("origin-ai-system-prompt") ?? DEFAULT_SYSTEM_PROMPT
  );
  const [original, setOriginal] = useState(
    () => localStorage.getItem("origin-ai-system-prompt") ?? DEFAULT_SYSTEM_PROMPT
  );
  const [justSaved, setJustSaved] = useState(false);

  const isDirty = value !== original;
  const isDefault = value.trim() === DEFAULT_SYSTEM_PROMPT.trim();

  function handleSave() {
    if (isDefault) {
      localStorage.removeItem("origin-ai-system-prompt");
    } else {
      localStorage.setItem("origin-ai-system-prompt", value);
    }
    setOriginal(value);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1800);
  }

  return (
    <div style={{ padding: "2px 0 16px" }}>
      <p style={{ fontSize: "12px", color: "var(--origin-fg-muted)", marginBottom: "16px", lineHeight: 1.6 }}>
        Sent at the start of every conversation to guide the AI's behavior. Changes take effect on the next message sent.
      </p>
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        spellCheck={false}
        style={{
          width: "100%",
          minHeight: "130px",
          padding: "10px 12px",
          borderRadius: "8px",
          border: "1px solid var(--origin-border-default)",
          backgroundColor: "var(--origin-bg-base)",
          color: "var(--origin-fg-default)",
          fontSize: "12px",
          fontFamily: "var(--font-mono)",
          lineHeight: "1.65",
          outline: "none",
          resize: "vertical",
          boxSizing: "border-box",
          display: "block",
        }}
        onFocus={e => { e.currentTarget.style.borderColor = "var(--origin-fg-muted)"; }}
        onBlur={e => { e.currentTarget.style.borderColor = "var(--origin-border-default)"; }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "10px" }}>
        <button
          onClick={() => setValue(DEFAULT_SYSTEM_PROMPT)}
          disabled={isDefault}
          style={{
            padding: "5px 12px",
            borderRadius: "6px",
            border: "1px solid var(--origin-border-default)",
            backgroundColor: "transparent",
            color: isDefault ? "var(--origin-fg-subtle)" : "var(--origin-fg-muted)",
            fontSize: "12px",
            cursor: isDefault ? "default" : "pointer",
          }}
        >
          Reset to Default
        </button>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleSave}
          disabled={!isDirty}
          style={{
            padding: "5px 16px",
            borderRadius: "6px",
            border: "1px solid var(--origin-border-default)",
            backgroundColor: justSaved
              ? "color-mix(in srgb, var(--origin-semantic-success) 15%, transparent)"
              : isDirty
                ? "var(--origin-fg-default)"
                : "transparent",
            color: justSaved
              ? "var(--origin-semantic-success)"
              : isDirty
                ? "var(--origin-bg-base)"
                : "var(--origin-fg-subtle)",
            fontSize: "12px",
            fontWeight: 500,
            cursor: isDirty ? "pointer" : "default",
            transition: "all 0.15s",
            minWidth: 56,
          }}
        >
          {justSaved ? "Saved!" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ── Settings Panel ───────────────────────────────────────────────────────────

interface SettingsPanelProps {
  onClose: () => void;
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [section, setSection] = useState<Section>("ai");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        backgroundColor: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "min(760px, 92vw)",
          height: "min(540px, 88vh)",
          backgroundColor: "var(--origin-bg-sidebar)",
          border: "1px solid var(--origin-border-default)",
          borderRadius: "12px",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          height: "48px",
          borderBottom: "1px solid var(--origin-border-default)",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--origin-fg-default)" }}>
            Settings
          </span>
          <button
            onClick={onClose}
            style={{
              marginLeft: "auto",
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26,
              borderRadius: "6px",
              border: "none",
              background: "none",
              cursor: "pointer",
              color: "var(--origin-fg-muted)",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.backgroundColor = "var(--origin-bg-hover)";
              e.currentTarget.style.color = "var(--origin-fg-default)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = "var(--origin-fg-muted)";
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Left nav */}
          <div style={{
            width: "172px",
            flexShrink: 0,
            borderRight: "1px solid var(--origin-border-default)",
            padding: "10px 8px",
            overflowY: "auto",
          }}>
            <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--origin-fg-subtle)", textTransform: "uppercase", letterSpacing: "0.07em", padding: "4px 10px 6px" }}>
              Settings
            </div>
            <NavItem
              active={section === "ai"}
              icon={<Bot size={14} />}
              label="AI Providers"
              onClick={() => setSection("ai")}
            />
            <NavItem
              active={section === "prompt"}
              icon={<MessageSquareDot size={14} />}
              label="System Prompt"
              onClick={() => setSection("prompt")}
            />
            <NavItem
              active={section === "appearance"}
              icon={<Palette size={14} />}
              label="Appearance"
              onClick={() => setSection("appearance")}
            />
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
            <div style={{
              fontSize: "15px", fontWeight: 600,
              color: "var(--origin-fg-default)",
              marginBottom: "14px",
            }}>
              {section === "ai" ? "AI Providers" : section === "prompt" ? "System Prompt" : "Appearance"}
            </div>
            {section === "ai"         && <AIProvidersSection />}
            {section === "prompt"     && <SystemPromptSection />}
            {section === "appearance" && <AppearanceSection />}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
