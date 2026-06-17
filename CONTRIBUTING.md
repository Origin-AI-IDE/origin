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

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to uphold it. Report unacceptable behavior to [gsvprharsha@gmail.com](mailto:gsvprharsha@gmail.com).

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
├── src/                        # React + TypeScript frontend
│   ├── components/             # UI components
│   │   ├── ai/                 # AI panel, chat, providers
│   │   ├── editor/             # CodeMirror editor, tab bar, diff pane
│   │   ├── terminal/           # XTerm + PTY panel
│   │   ├── settings/           # Settings panel
│   │   └── ui/                 # Shared UI primitives (Toast, Tooltip, etc.)
│   ├── hooks/                  # Custom React hooks
│   ├── lib/                    # Core logic (AI, LSP, git, fs, db, agent)
│   │   └── agent/              # Agentic loop (tools, run, providers)
│   ├── themes/                 # Theme JSON files
│   └── context/                # React context (WorkspaceContext)
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── lib.rs              # All Tauri commands (file, git, terminal, AI)
│   │   └── lsp.rs              # LSP server harness
│   ├── capabilities/           # Tauri capability grants
│   └── Cargo.toml
├── docs/                       # Project docs and changelog
└── public/                     # Static assets
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

By contributing you agree that your contributions will be licensed under the [MIT License](LICENSE).
