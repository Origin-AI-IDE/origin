import vscodeIcon from '../../assets/Visual_Studio_Code_1-35_icon.svg';
import vimIcon from '../../assets/Vimlogo.svg';
import emacsIcon from '../../assets/EmacsIcon.svg';
import cursorIcon from '../../assets/Cursor_logo.svg';
import windsurfWordmark from '../../assets/Windsurf-white-wordmark.svg';

export const CDN = 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/';

export interface Provider {
  id: string;
  label: string;
  icon: string | null;
  invert: boolean;
  group: 'api' | 'local';
  keyLabel: string;
  keyPlaceholder: string;
  models: string[];
  customModels?: boolean;
  docs?: string;
}

export const PROVIDERS: Provider[] = [
  { id: 'anthropic',  label: 'Anthropic',  icon: 'anthropic.svg',       invert: true,  group: 'api',   keyLabel: 'API Key',  keyPlaceholder: 'sk-ant-...',            models: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5'], docs: 'https://console.anthropic.com/' },
  { id: 'openai',     label: 'OpenAI',     icon: 'openai.svg',           invert: true,  group: 'api',   keyLabel: 'API Key',  keyPlaceholder: 'sk-...',                models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'], docs: 'https://platform.openai.com/api-keys' },
  { id: 'gemini',     label: 'Gemini',     icon: 'gemini-color.svg',     invert: false, group: 'api',   keyLabel: 'API Key',  keyPlaceholder: 'AIza...',               models: ['gemini-2.5-pro', 'gemini-2.5-flash'], docs: 'https://aistudio.google.com/app/apikey' },
  { id: 'openrouter', label: 'OpenRouter', icon: 'openrouter.svg',       invert: true,  group: 'api',   keyLabel: 'API Key',  keyPlaceholder: 'sk-or-...',             models: [], customModels: true, docs: 'https://openrouter.ai/keys' },
  { id: 'mistral',    label: 'Mistral',    icon: 'mistral-color.svg',    invert: false, group: 'api',   keyLabel: 'API Key',  keyPlaceholder: '...',                   models: ['mistral-large-latest', 'mistral-small-latest'], docs: 'https://console.mistral.ai/' },
  { id: 'deepseek',   label: 'DeepSeek',   icon: 'deepseek-color.svg',   invert: false, group: 'api',   keyLabel: 'API Key',  keyPlaceholder: 'sk-...',                models: ['deepseek-chat', 'deepseek-reasoner'], docs: 'https://platform.deepseek.com/' },
  { id: 'groq',       label: 'Groq',       icon: 'groq.svg',             invert: true,  group: 'api',   keyLabel: 'API Key',  keyPlaceholder: 'gsk_...',               models: ['llama-3.3-70b-versatile', 'moonshotai/kimi-k2'], docs: 'https://console.groq.com/keys' },
  { id: 'cohere',     label: 'Cohere',     icon: 'cohere-color.svg',     invert: false, group: 'api',   keyLabel: 'API Key',  keyPlaceholder: '...',                   models: ['command-r-plus', 'command-r'], docs: 'https://dashboard.cohere.com/' },
  { id: 'xai',        label: 'xAI',        icon: 'xai.svg',              invert: true,  group: 'api',   keyLabel: 'API Key',  keyPlaceholder: 'xai-...',               models: ['grok-3', 'grok-3-mini'], docs: 'https://console.x.ai/' },
  { id: 'ollama',     label: 'Ollama',     icon: 'ollama.svg',           invert: true,  group: 'local', keyLabel: 'Base URL', keyPlaceholder: 'http://localhost:11434', models: [], customModels: true },
  { id: 'lmstudio',   label: 'LM Studio',  icon: null,                   invert: false, group: 'local', keyLabel: 'Base URL', keyPlaceholder: 'http://localhost:1234',  models: [], customModels: true },
  { id: 'vllm',       label: 'vLLM',       icon: null,                   invert: false, group: 'local', keyLabel: 'Base URL', keyPlaceholder: 'http://localhost:8000',  models: [], customModels: true },
];

export interface ThemeOption {
  id: 'dark' | 'light';
  label: string;
  previewBg: string;
  lines: Array<{ color: string; width: string }>;
}

export const THEMES: ThemeOption[] = [
  {
    id: 'dark',
    label: 'Origin Dark',
    previewBg: '#0a0a0a',
    lines: [
      { color: '#62a6ff', width: '85%' },
      { color: '#333',    width: '60%' },
      { color: '#f05b8d', width: '45%' },
      { color: '#2a2a2a', width: '75%' },
    ],
  },
  {
    id: 'light',
    label: 'Origin Light',
    previewBg: '#f5f5f5',
    lines: [
      { color: '#005ee9', width: '85%' },
      { color: '#ccc',    width: '60%' },
      { color: '#b32c62', width: '45%' },
      { color: '#ddd',    width: '75%' },
    ],
  },
];

export interface KeymapOption {
  id: string;
  label: string;
  icon: string;
  invert: boolean;
}

export const KEYMAPS: KeymapOption[] = [
  { id: 'vscode', label: 'VS Code', icon: vscodeIcon, invert: false },
  { id: 'vim',    label: 'Vim',     icon: vimIcon,    invert: false },
  { id: 'emacs',  label: 'Emacs',   icon: emacsIcon,  invert: false },
];

export interface ImportOption {
  id: string;
  label: string;
  icon: string;
  invert: boolean;
  gradient: string;
  wordmark?: boolean;
  size?: string;
}

export const IMPORTS: ImportOption[] = [
  { id: 'vscode',   label: 'VS Code',  icon: vscodeIcon,      invert: false, gradient: 'linear-gradient(135deg, #001a30 0%, #003d70 100%)', size: '48px' },
  { id: 'cursor',   label: 'Cursor',   icon: cursorIcon,      invert: true,  gradient: 'linear-gradient(135deg, #0d0d0d 0%, #1e1e1e 100%)', size: '68px' },
  { id: 'windsurf', label: 'Windsurf', icon: windsurfWordmark, invert: false, gradient: 'linear-gradient(135deg, #081525 0%, #183555 100%)', wordmark: true },
];
