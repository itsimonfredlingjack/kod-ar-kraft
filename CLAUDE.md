# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Warp-Chat — an Electron desktop app that provides a Warp-terminal-inspired chat interface for local or remote LLMs. macOS-focused with native vibrancy, glassmorphic dark UI, and aurora mesh gradient backgrounds. Hardened for daily use with defense-in-depth security, offline operation, and approval-gated workspace agent tools.

## Commands

```bash
npm start          # Launch the Electron app (alias: npm run dev)
npm install        # Install dependencies after cloning
```

No build step, linter, or test runner is configured. The app runs raw HTML/CSS/JS directly in Electron.

## Architecture

Flat 5-file architecture with no framework, no bundler, no TypeScript:

- **`main.js`** (~1170 lines) — Electron main process. Creates a BrowserWindow with `hiddenInset` titlebar and macOS vibrancy. Hosts all workspace agent tools, the approval-gated write flow, structured command parsing with pinned binary paths, atomic session persistence, CSP injection, and safeStorage credential management.
- **`preload.js`** — Exposes `window.electronAPI` via contextBridge. Context isolation is on, nodeIntegration is off. Bridge surface: `copyToClipboard`, `selectFolder`, `getDefaultPath`, `getFolderContents`, `getWorkspaceTree`, `exportChat`, `createShareSnapshot`, `saveChats`, `loadChats`, `invokeAgentTool`, `resolvePendingAgentChange`, `getApiKey`, `setApiKey`, `updateCspEndpoint`.
- **`renderer.js`** (~4200 lines) — All frontend logic in one file. Key subsystems:
  - **Provider-aware chat** — Ollama native NDJSON streaming (`readOllamaStream`, `readOllamaAgentStream`) and OpenAI-compatible SSE streaming (`readOpenAIStream`, `readOpenAIAgentStream`). Both paths handle `thinking` content — Ollama via its native `message.thinking` field, OpenAI via `<think>` tags in content.
  - **Agent loop** — `runAgentLoop` works on both `ollama-native` and `openai-compatible` modes. Capped at 25 iterations (`AGENT_LOOP_MAX_ITERATIONS`) with user-visible step counter in the status bar.
  - **Pseudo-tool fallback** — `extractPseudoToolCalls` detects tool calls from assistant text when the model doesn't support native `tool_calls`. Switches `toolTransportMode` from `"native"` to `"pseudo"` dynamically.
  - **Dual-history model** — `apiHistory[]` stores provider-facing messages; `transcriptItems[]` stores UI-facing items. Session version is `SESSION_VERSION = 2` with legacy v1 migration and semantic validation on load.
  - **Command palette** — `⌘K` opens a fuzzy-searchable palette. `mouseenter` updates selection class without rebuilding DOM (preserves click targets).
  - **Rendering** — Markdown via `marked` + `DOMPurify` + `highlight.js` (all local vendor bundles). Math via KaTeX. Mermaid diagrams render in sandboxed iframes (click-to-render, `securityLevel: 'strict'`).
  - **Image attachments** — Paste-to-attach and UI control. Images serialized as Ollama `images` or OpenAI content parts depending on provider.
  - **Streaming render throttle** — Full markdown reparse capped at 4/sec (250ms interval) during streaming to reduce layout thrash.
  - **Audio** — Web Audio API synthesized sounds (`playThock`, `playClick`), mutable via state flag.
- **`style.css`** (~1316 lines) — Full styling with CSS custom properties in `:root`. Glassmorphism, aurora mesh gradient background, macOS-native font stack.
- **`index.html`** — Loads local vendor dependencies (no CDN). Mermaid is NOT loaded in the host page — it runs only inside sandboxed iframes.
- **`vendor/`** — Local copies of marked, DOMPurify, highlight.js (IIFE build via esbuild), KaTeX (JS + CSS + fonts), Mermaid. All rendering works offline.

## Security Model

### Content Security Policy (CSP)
- `script-src 'self'` — no `unsafe-eval`, no `unsafe-inline`. Blocks injected scripts even if DOMPurify is bypassed.
- `connect-src` is dynamically narrowed to `'self'` + the user's configured LLM endpoint origin. Pre-seeded with localhost:11434 and the known ai-server IPs. Updated via `update-csp-endpoint` IPC when settings change.
- `frame-src blob:` for sandboxed Mermaid iframes.
- `style-src 'unsafe-inline'` required by KaTeX for computed styles.
- `object-src 'none'; base-uri 'none'; form-action 'none'`.

### Mermaid Isolation
- Mermaid is **not loaded in the host page**. It runs inside `<iframe sandbox="allow-scripts">` with a blob URL containing the inlined Mermaid source.
- The iframe has a null origin — no access to host DOM, localStorage, electronAPI, or fetch to arbitrary origins.
- Click-to-render: the user sees raw mermaid source and explicitly opts in to rendering.
- Config: `securityLevel: 'strict'`, `maxTextSize: 50000`, `htmlLabels: false`.

### Command Execution
- Safe commands (ls, cat, git status, etc.) execute via `execFile(binary, args)` directly — **no shell interpretation**.
- Binary paths are pinned to absolute macOS paths where possible (`/bin/ls`, `/usr/bin/git`, etc.) to prevent PATH hijacking. Falls back to PATH lookup for tools with variable install locations (npm, node, python, cargo).
- `parseSimpleArgv` splits commands into argv with quote handling. `SHELL_METACHAR_PATTERN` rejects newlines, semicolons, pipes, backticks, dollar signs, and all shell operators.
- Commands that require shell syntax (pipes, redirects) go through explicit user approval with a `⚠ Shell Command` warning label. Max 300 characters.
- `isCommandSafe` validates binary allowlist, subcommand allowlist, forbidden flags, args-only allowlists, and workspace path containment.

### Credential Storage
- API keys stored via Electron `safeStorage` (macOS Keychain). Never in cleartext localStorage.
- Migration path: existing localStorage keys are migrated to safeStorage on first load, then cleared.

### DOM Security
- All sidebar rendering uses `textContent` (not `innerHTML`) for user-controlled strings (session titles, workspace paths).
- AI-generated content goes through `DOMPurify.sanitize()` before DOM insertion.
- `contextIsolation: true`, `nodeIntegration: false`.

## State & Persistence

- **Renderer state** lives in a single `state` object. Settings persisted to `localStorage` with `warp_chat_*` keys (except API key → safeStorage). Session history persisted via IPC to `main.js`.
- **Atomic writes**: Session file writes use temp-file + rename pattern. Corrupted files are backed up with `.corrupted-TIMESTAMP` suffix.
- **Session validation**: Per-record structural validation (`isValidSessionRecord`) + per-item semantic validation (`isValidTranscriptItem`, `isValidApiHistoryEntry`). Malformed records/items are skipped with console warnings and toast notification.
- **Session cap**: 25 sessions max, oldest evicted with console warning.
- **Generation state machine**: `cancelActiveGeneration()` aborts streams on session switch, clear, or concurrent send. `isGenerating` flag prevents double-sends.

## LLM Backend

Two backend modes configured from Advanced Settings:

- **`ollama-native`** — Default `http://127.0.0.1:11434`, calls `/api/tags` and `/api/chat`. NDJSON streaming. Supports native `thinking` field, native `tool_calls`, and `images` for vision. Agent mode works directly.
- **`openai-compatible`** — For OpenAI-style endpoints, calls `/models` and `/chat/completions`. SSE streaming. Agent mode via OpenAI tool-calling protocol.

Default model is `qwen3.5:9b`. Primary inference server: `ai-server` (RTX 4070) at `100.72.19.25:11434` via Tailscale.

## Agent Tools

- Agent mode is available in **both** `ollama-native` and `openai-compatible` modes with a workspace selected. Controlled by `providerSupportsAgentTools()`.
- Tool definitions live in `AGENT_TOOLS[]` at the top of `renderer.js`.
- Tool execution happens in `main.js` via `invoke-agent-tool` IPC. All paths resolved relative to workspace root with symlink-aware escape prevention.
- `search_workspace` shells out to `rg` (ripgrep) — gracefully degrades if not installed.
- `propose_file_write` / `propose_file_edit` never write directly. They create pending changes with diff previews (line numbers, context lines, file path headers). User must Approve/Reject.
- `run_command` auto-executes safe read-only commands directly (no shell). Unsafe commands require approval with explicit shell/direct labeling.
- **Agent loop cap**: 25 iterations max. Status bar shows `"Agent step N/25..."`. Exceeded cap produces a clear error message.
- Failed approvals keep pending state — the user can retry without losing the proposed change.

## Key Keyboard Shortcuts

- `Enter` — Send message (Shift+Enter for newline)
- `⌘K` — Command palette
- `⌘,` — Open Advanced Settings
- `⌘B` — Toggle the left Workspaces panel
- `⌘J` — Toggle the right Sessions panel
- `⌘⇧C` — Copy last generated code block
- `Esc` — Close palette or abort generation

## Patterns to Preserve

- **Security model**: contextIsolation, CSP with no unsafe-eval, sandboxed Mermaid, DOMPurify, safeStorage for credentials, pinned binary paths, structured command parsing. Do not weaken these boundaries.
- **Tool security boundary**: Renderer never gets raw Node filesystem access. Workspace tools stay in `main.js`, paths resolved relative to workspace, writes are approval-gated.
- **No-framework philosophy**: Intentionally vanilla JS. No React, Vue, or bundler.
- **macOS-first aesthetic**: Vibrancy, `-apple-system` font stack, `hiddenInset` titlebar. Accent color `#6d72ff`.
- **CSS custom properties**: All theme values in `:root` variables. Use these, don't hardcode colors.
- **Single-file renderer**: All frontend logic in `renderer.js`. No module splitting (no bundler).
- **Offline-first**: All rendering deps bundled locally in `vendor/`. No CDN dependencies.
- **Thinking support**: Ollama native `message.thinking` field is streamed live and displayed in a collapsible block. `processThinkingTags` handles both `<think>` tag format and Ollama's separate field format.
