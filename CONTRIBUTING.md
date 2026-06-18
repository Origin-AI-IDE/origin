# Contributing to Origin

Thanks for your interest in contributing. Origin is a desktop IDE built with Tauri 2.x, React, and TypeScript. This guide covers everything you need to get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)

---

## Code of Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to uphold it. Report unacceptable behavior to [gsvprharsha@gmail.com](mailto:gsvprharsha@gmail.com).

---

## Getting Started

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | 20+ |
| Rust | stable (latest) |
| Windows | 10/11 with WebView2 (pre-installed on Win 11) |

Install Rust via [rustup.rs](https://rustup.rs). Install Node via [nodejs.org](https://nodejs.org).

### Development Setup

```bash
# Clone the repository
git clone https://github.com/Origin-AI-IDE/origin.git
cd origin

# Install frontend dependencies
npm install

# Start the dev server (Tauri + Vite hot-reload)
npm run dev
```

For frontend-only iteration (no Tauri window, faster):
```bash
npm run vite
```

To build a production release:
```bash
npm run build
```

---

## Project Structure

```
origin/
├── src/                              # React + TypeScript frontend
│   ├── App.tsx                       # Root component and app layout
│   ├── main.tsx                      # Entry point, context providers
│   ├── index.css                     # Global styles and theme variables
│   ├── vite-env.d.ts
│   ├── assets/
│   │   ├── ai-icons/                 # Provider SVG icons (17 files)
│   │   └── fonts/                    # Geist Sans + Geist Mono woff2
│   ├── components/
│   │   ├── ActivityBar.tsx
│   │   ├── ContextMenu.tsx
│   │   ├── FileTree.tsx
│   │   ├── SearchPanel.tsx
│   │   ├── Sidebar.tsx
│   │   ├── SourceTreePanel.tsx
│   │   ├── StatusBar.tsx
│   │   ├── StatusIsland.tsx
│   │   ├── TitleBar.tsx
│   │   ├── ai/                       # AI panel, chat, providers
│   │   │   ├── AiPanel.tsx
│   │   │   ├── ChatBox.tsx
│   │   │   ├── MarkdownMessage.tsx
│   │   │   ├── MentionDropdown.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── PlanCard.tsx
│   │   │   ├── PreferencesDropdown.tsx
│   │   │   ├── ToolCallCard.tsx
│   │   │   └── providers.ts
│   │   ├── editor/                   # CodeMirror editor, tabs, diff, preview
│   │   │   ├── AiDiffPane.tsx
│   │   │   ├── Editor.tsx
│   │   │   ├── EditorEmptyState.tsx
│   │   │   ├── TabBar.tsx
│   │   │   ├── WebPreviewPane.tsx
│   │   │   └── languageSupport.ts
│   │   ├── onboarding/
│   │   │   ├── ConnectAIPage.tsx
│   │   │   ├── Onboarding.tsx
│   │   │   ├── PersonalizePage.tsx
│   │   │   ├── WelcomePage.tsx
│   │   │   └── data.ts
│   │   ├── palette/
│   │   │   └── CommandPalette.tsx
│   │   ├── settings/
│   │   │   └── SettingsPanel.tsx
│   │   ├── terminal/                 # XTerm + PTY panel
│   │   │   ├── Terminal.tsx
│   │   │   └── TerminalPanel.tsx
│   │   └── ui/                       # Shared UI primitives
│   │       ├── DropdownMenu.tsx
│   │       ├── ErrorBoundary.tsx
│   │       ├── Toast.tsx
│   │       └── Tooltip.tsx
│   ├── context/
│   │   ├── CommandContext.tsx
│   │   └── WorkspaceContext.tsx
│   ├── hooks/
│   │   ├── useGlobalKeybindings.ts
│   │   ├── useTabs.ts
│   │   └── useWorkspacePersistence.ts
│   ├── lib/                          # Core logic
│   │   ├── __tests__/
│   │   ├── agent/                    # Agentic loop (tools, run, providers)
│   │   │   ├── __tests__/
│   │   │   ├── planTypes.ts
│   │   │   ├── providers.ts
│   │   │   ├── run.ts
│   │   │   └── tools.ts
│   │   ├── ai.ts
│   │   ├── aiAutocomplete.ts
│   │   ├── aiTypes.ts
│   │   ├── applyEdit.ts
│   │   ├── db.ts
│   │   ├── fileColors.ts
│   │   ├── fs.ts
│   │   ├── git.ts
│   │   ├── hunkControls.ts
│   │   ├── lsp.ts
│   │   ├── lspCm6.ts
│   │   ├── pinboardStore.ts
│   │   ├── pricing.ts
│   │   ├── resolvePath.ts
│   │   ├── resolveTargetPath.ts
│   │   ├── search.ts
│   │   ├── secrets.ts
│   │   ├── sessionStore.ts
│   │   ├── settings.ts
│   │   ├── sourceTree.ts
│   │   ├── system.ts
│   │   ├── tauri-fetch.ts
│   │   ├── terminal.ts
│   │   └── usage.ts
│   └── themes/
│       ├── ThemeContext.tsx
│       ├── applyTheme.ts
│       ├── types.ts
│       ├── origin-dark/
│       │   └── theme.json
│       └── origin-light/
│           └── theme.json
├── src-tauri/                        # Rust backend
│   ├── src/
│   │   ├── lib.rs                    # Entry point, all Tauri command registrations
│   │   ├── main.rs
│   │   ├── ai.rs                     # AI streaming proxy
│   │   ├── fs.rs                     # File system commands
│   │   ├── git.rs                    # Git commands
│   │   ├── keychain.rs               # OS keychain (API key storage)
│   │   ├── lsp.rs                    # LSP server harness
│   │   ├── search.rs                 # Find-in-files
│   │   ├── system.rs                 # System info (memory)
│   │   ├── terminal.rs               # PTY terminal
│   │   └── tree.rs                   # File tree and source tree
│   ├── capabilities/
│   │   └── default.json
│   ├── icons/                        # App icons (all sizes)
│   └── Cargo.toml
├── docs/                             # Project docs and changelog
├── media/                            # Marketing assets (logo, mark)
├── public/                           # Static web assets
├── .github/                          # CI workflows
├── eslint.config.js
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

---

## Making Changes

### Styling

**Never use hardcoded Tailwind color classes** (`bg-neutral-900`, `text-zinc-400`, etc.).  
Always use theme CSS variables:

```tsx
// Correct
style={{ color: "var(--origin-fg-muted)" }}
className="text-[var(--origin-fg-muted)]"

// Wrong
className="text-zinc-400"
```

All color tokens are defined in `src/themes/{theme-name}/theme.json`. Adding a new token requires updating both `origin-dark/theme.json` and `origin-light/theme.json`.

### TypeScript

- Strict mode is enabled — no `any` unless unavoidable
- Prefer `const` and functional components
- New Tauri commands need a typed wrapper in `src/lib/`

### Rust

- New commands go in `src-tauri/src/lib.rs` and must be registered in `invoke_handler!`
- Use `CREATE_NO_WINDOW` flag on all child processes spawned on Windows
- Keep commands focused — one command, one responsibility

### Comments

Write comments only when the *why* is non-obvious. No docblocks, no "this does X" comments — well-named identifiers do that already.

---

## Pull Request Guidelines

1. **Fork** the repo and create a branch from `main`
2. **Keep PRs focused** — one feature or fix per PR
3. **TypeScript must compile** — run `npx tsc --noEmit` before submitting
4. **ESLint must pass** — run `npx eslint src/` before submitting
5. **Describe what changed and why** in the PR body — reference any related issues
6. **Screenshots or recordings** are appreciated for UI changes

Branch naming:
- `feat/short-description` for new features
- `fix/short-description` for bug fixes
- `chore/short-description` for maintenance

---

## Reporting Bugs

Open an issue at [github.com/Origin-AI-IDE/origin/issues](https://github.com/Origin-AI-IDE/origin/issues/new) and include:

- OS version and WebView2 version
- Steps to reproduce
- Expected vs actual behavior
- Relevant console output (open DevTools with `Ctrl+Shift+I`)

---

## Requesting Features

Open an issue with the `enhancement` label. Describe the problem you are trying to solve, not just the solution. Feature requests with clear use cases are much easier to evaluate.

If a requested feature is outside the planned roadmap or diverges from the intended direction of Origin, it will be brought to the **Origin Discord** for a community vote before any decision is made. This ensures the project evolves in a direction that reflects what the community actually wants. Join the discussion and cast your vote there.

---

## License

By contributing you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
