# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Warp-Chat MVP — an Electron desktop app that provides a Warp-terminal-inspired chat interface for local LLMs via Ollama. macOS-focused with native vibrancy, glassmorphic dark UI, and aurora gradient backgrounds.

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
- **`renderer.js`** — All frontend logic in one file. Handles: chat messaging with streaming Ollama API, markdown rendering (marked + DOMPurify + highlight.js), command palette (⌘K), projects sidebar (⌘B), typewriter placeholder animation, Web Audio API haptic sounds, code block copy buttons, abort controller for stopping generation.
- **`style.css`** — Full styling with CSS custom properties. Glassmorphism via `backdrop-filter: blur()`, aurora mesh gradient background, neon pulse animations for loading state, macOS-native font stack.
- **`index.html`** — Loads highlight.js theme + marked + DOMPurify from CDN, plus local `renderer.js` and `style.css`.

## LLM Backend

Streams from Ollama at `http://127.0.0.1:11434/api/chat`. Default model is `qwen3.5:4b` (hardcoded in `renderer.js:340`). Uses NDJSON streaming with `ReadableStream` reader. Conversation history is kept in-memory in `conversationHistory[]`.

## Key Keyboard Shortcuts

- `Enter` — Send message (Shift+Enter for newline)
- `⌘K` — Command palette
- `⌘B` — Toggle projects sidebar
- `⌘⇧C` — Copy last generated code block
- `Esc` — Close palette or abort generation

## Patterns to Preserve

- **Security model**: contextIsolation enabled, nodeIntegration disabled, all renderer-to-main communication goes through the preload bridge. DOMPurify sanitizes all AI-generated HTML before DOM insertion.
- **No-framework philosophy**: This is intentionally vanilla JS. Don't introduce React, Vue, or other frameworks.
- **macOS-first aesthetic**: Vibrancy, `-apple-system` font stack, `hiddenInset` titlebar. The visual identity is glassmorphism with accent color `#5e5ce6`.
- **CSS custom properties**: All theme values live in `:root` variables in `style.css`. Use these rather than hardcoding colors.
