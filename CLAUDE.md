# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Warp-Chat MVP — an Electron desktop app that provides a Warp-terminal-inspired chat interface for local or remote LLMs. macOS-focused with native vibrancy, glassmorphic dark UI, and aurora gradient backgrounds.

## Commands

```bash
npm start          # Launch the Electron app (alias: npm run dev)
npm install        # Install dependencies after cloning
```

No build step, linter, or test runner is configured. The app runs raw HTML/CSS/JS directly in Electron.

## Architecture

Flat 4-file architecture with no framework, no bundler, no TypeScript:

- **`main.js`** — Electron main process. Creates a BrowserWindow with `hiddenInset` titlebar and macOS `vibrancy: 'under-window'`. Forces dark mode via `nativeTheme`. Handles two IPC channels: `copy-to-clipboard` (one-way) and `select-folder` (invoke/handle).
- **`preload.js`** — Exposes `window.electronAPI` via contextBridge with `copyToClipboard()` and `selectFolder()`. Context isolation is on, nodeIntegration is off.
- **`renderer.js`** — All frontend logic in one file. Handles: provider-aware chat messaging for Ollama native and OpenAI-compatible APIs, OpenAI tool-calling agent mode, transcript rendering, markdown rendering (marked + DOMPurify + highlight.js), command palette (⌘K), projects sidebar (⌘B), typewriter placeholder animation, Web Audio API haptic sounds, code block copy buttons, abort controller for stopping generation.
- **`style.css`** — Full styling with CSS custom properties. Glassmorphism via `backdrop-filter: blur()`, aurora mesh gradient background, neon pulse animations for loading state, macOS-native font stack.
- **`index.html`** — Loads highlight.js theme + marked + DOMPurify from CDN, plus local `renderer.js` and `style.css`.

## LLM Backend

The app now supports two backend modes configured from Advanced Settings:

- **`ollama-native`** — Uses `http://127.0.0.1:11434` by default, calls `/api/tags` and `/api/chat`, and parses NDJSON streaming responses.
- **`openai-compatible`** — Intended for endpoints such as `http://<tailscale-ip>:11434/v1`, calls `/models` and `/chat/completions`, and parses SSE `data:` streaming responses.

Default model is `qwen3.5:4b`. Phase 2 replaces the old single `conversationHistory[]` shape with:

- `apiHistory[]` for provider-facing messages, including assistant `tool_calls` and `tool` results
- `transcriptItems[]` for UI-facing chat, tool activity, approval cards, and errors

## Current Scope

Phase 2 introduces an OpenAI-compatible workspace agent:

- Plain chat still streams for both provider modes when `Agent Tools` is off
- Agent mode is available only in `openai-compatible`
- Tool surface is intentionally small and workspace-scoped:
  - `list_workspace`
  - `read_file`
  - `search_workspace`
  - `propose_file_write`
- File writes always require inline approval before they hit disk
- No shell execution, delete/rename/move tools, or out-of-workspace access in v1

## Key Keyboard Shortcuts

- `Enter` — Send message (Shift+Enter for newline)
- `⌘K` — Command palette
- `⌘,` — Open Advanced Settings
- `⌘B` — Toggle the left Workspaces panel
- `⌘J` — Toggle the right Sessions panel
- `⌘⇧C` — Copy last generated code block
- `Esc` — Close palette or abort generation

## Patterns to Preserve

- **Security model**: contextIsolation enabled, nodeIntegration disabled, all renderer-to-main communication goes through the preload bridge. DOMPurify sanitizes all AI-generated HTML before DOM insertion.
- **Tool security boundary**: Renderer never gets raw Node filesystem access. Workspace tools stay in `main.js`, paths are resolved relative to the selected workspace, and pending writes are approval-gated.
- **No-framework philosophy**: This is intentionally vanilla JS. Don't introduce React, Vue, or other frameworks.
- **macOS-first aesthetic**: Vibrancy, `-apple-system` font stack, `hiddenInset` titlebar. The visual identity is glassmorphism with accent color `#5e5ce6`.
- **CSS custom properties**: All theme values live in `:root` variables in `style.css`. Use these rather than hardcoding colors.
