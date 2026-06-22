import anthropicIcon   from '../../assets/ai-icons/anthropic.svg';
import openaiIcon      from '../../assets/ai-icons/openai.svg';
import geminiColorIcon from '../../assets/ai-icons/gemini-color.svg';
import openrouterIcon  from '../../assets/ai-icons/openrouter.svg';
import mistralColorIcon from '../../assets/ai-icons/mistral-color.svg';
import deepseekColorIcon from '../../assets/ai-icons/deepseek-color.svg';
import groqIcon        from '../../assets/ai-icons/groq.svg';
import cohereColorIcon from '../../assets/ai-icons/cohere-color.svg';
import xaiIcon         from '../../assets/ai-icons/xai.svg';
import ollamaIcon      from '../../assets/ai-icons/ollama.svg';
import claudeColorIcon from '../../assets/ai-icons/claude-color.svg';
import metaColorIcon   from '../../assets/ai-icons/meta-color.svg';

export const DEFAULT_MODEL_ID    = 'claude-sonnet-4-6';
export const DEFAULT_PROVIDER_ID = 'anthropic';

export interface AIModel {
  id: string;
  name: string;
  description: string;
  color: string;
  icon?: string;
  iconInvert?: boolean;
}

export interface AIProvider {
  id: string;
  name: string;
  initial: string;
  icon: string | null;
  invert: boolean;
  color: string;
  textColor: string;
  models: AIModel[];
}

export const PROVIDERS: AIProvider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    initial: 'A',
    icon: anthropicIcon,
    invert: true,
    color: '#c9765a',
    textColor: '#ffffff',
    models: [
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', description: 'Balanced speed and intelligence',      color: '#f97316', icon: claudeColorIcon },
      { id: 'claude-opus-4-8',   name: 'Claude Opus 4.8',   description: 'Most capable, best for complex tasks', color: '#ef4444', icon: claudeColorIcon },
      { id: 'claude-haiku-4-5',  name: 'Claude Haiku 4.5',  description: 'Fast and lightweight',                 color: '#f59e0b', icon: claudeColorIcon },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    initial: 'O',
    icon: openaiIcon,
    invert: true,
    color: '#10a37f',
    textColor: '#ffffff',
    models: [
      { id: 'gpt-4o',      name: 'GPT-4o',      description: 'Most capable multimodal model', color: '#22c55e', icon: openaiIcon, iconInvert: true },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', description: 'Fast and affordable',           color: '#06b6d4', icon: openaiIcon, iconInvert: true },
      { id: 'o3-mini',     name: 'o3-mini',     description: 'Fast reasoning model',           color: '#0ea5e9', icon: openaiIcon, iconInvert: true },
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    initial: 'G',
    icon: geminiColorIcon,
    invert: false,
    color: '#4285f4',
    textColor: '#ffffff',
    models: [
      { id: 'gemini-2.5-pro',   name: 'Gemini 2.5 Pro',   description: 'Most capable Gemini model', color: '#3b82f6', icon: geminiColorIcon },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast multimodal model',     color: '#6366f1', icon: geminiColorIcon },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    initial: 'OR',
    icon: openrouterIcon,
    invert: true,
    color: '#6366f1',
    textColor: '#ffffff',
    models: [],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    initial: 'M',
    icon: mistralColorIcon,
    invert: false,
    color: '#ff7000',
    textColor: '#ffffff',
    models: [
      { id: 'mistral-large-latest', name: 'Mistral Large', description: 'Top-tier reasoning and code', color: '#8b5cf6', icon: mistralColorIcon },
      { id: 'mistral-small-latest', name: 'Mistral Small', description: 'Lightweight and efficient',   color: '#a855f7', icon: mistralColorIcon },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    initial: 'DS',
    icon: deepseekColorIcon,
    invert: false,
    color: '#1a6cf5',
    textColor: '#ffffff',
    models: [
      { id: 'deepseek-chat',     name: 'DeepSeek Chat',     description: 'Strong general-purpose model', color: '#ec4899', icon: deepseekColorIcon },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', description: 'Advanced reasoning model',     color: '#d946ef', icon: deepseekColorIcon },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    initial: 'GQ',
    icon: groqIcon,
    invert: true,
    color: '#f55036',
    textColor: '#ffffff',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', description: "Meta's latest large model via Groq", color: '#84cc16', icon: metaColorIcon },
      { id: 'moonshotai/kimi-k2',      name: 'Kimi K2',        description: 'Long-context reasoning',             color: '#eab308', icon: groqIcon, iconInvert: true },
    ],
  },
  {
    id: 'cohere',
    name: 'Cohere',
    initial: 'Co',
    icon: cohereColorIcon,
    invert: false,
    color: '#39594d',
    textColor: '#ffffff',
    models: [
      { id: 'command-r-plus', name: 'Command R+', description: 'Best for RAG and complex tasks', color: '#14b8a6', icon: cohereColorIcon },
      { id: 'command-r',      name: 'Command R',  description: 'Efficient retrieval model',       color: '#10b981', icon: cohereColorIcon },
    ],
  },
  {
    id: 'xai',
    name: 'xAI',
    initial: 'xA',
    icon: xaiIcon,
    invert: true,
    color: '#111111',
    textColor: '#ffffff',
    models: [
      { id: 'grok-3',      name: 'Grok 3',      description: "xAI's most capable model", color: '#f43f5e', icon: xaiIcon, iconInvert: true },
      { id: 'grok-3-mini', name: 'Grok 3 Mini', description: 'Fast and efficient',        color: '#64748b', icon: xaiIcon, iconInvert: true },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama',
    initial: 'Ol',
    icon: ollamaIcon,
    invert: true,
    color: '#2d2d2d',
    textColor: '#ffffff',
    models: [],
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    initial: 'LM',
    icon: null,
    invert: false,
    color: '#8b5cf6',
    textColor: '#ffffff',
    models: [],
  },
  {
    id: 'vllm',
    name: 'vLLM',
    initial: 'vL',
    icon: null,
    invert: false,
    color: '#374151',
    textColor: '#ffffff',
    models: [],
  },
];
