# Warp-Chat

A blazing fast, keyboard-first, floating macOS desktop client for local and remote LLMs. Built with Electron, Vanilla JS/CSS, and a focus on helping non-coders understand projects, terminal output, and safe next steps.

![Warp-Chat Interface](https://raw.githubusercontent.com/Poke1650/warp-chat/main/assets/screenshot.png) *(Imagine a beautiful glowing UI here)*

## ✨ Philosophy
Designed to feel like a modern terminal (heavily inspired by Warp). No clutter, no complex history databases, just a blank canvas that melts into your macOS background using native Vibrancy. Built to interact with models through either local Ollama endpoints or remote OpenAI-compatible endpoints over your own network.

## 🚀 Features
- **Native macOS Vibrancy:** The window is frameless, frosted, and blurred, blending perfectly into your desktop environment.
- **Dual Provider Support:** Switch between Ollama native mode (`/api/tags`, `/api/chat`) and OpenAI-compatible mode (`/v1/models`, `/v1/chat/completions`) from Advanced Settings.
- **Streaming Chat Responses:** Handles Ollama NDJSON streams and OpenAI-style SSE streams without changing the chat UI.
- **Terminal Helper Mode:** Enable `Terminal Helper` to let the model inspect the selected workspace, explain terminal steps, run safe read-only checks, start approved long-running tasks, and propose file changes with inline approval.
- **Markdown & Code Highlighting:** Live syntax highlighting with the *Tokyo Night Dark* theme via `highlight.js`, dynamically injected into the DOM stream.
- **Keyboard-First Navigation:** 
  - `Enter` : Send prompt
  - `Shift + Enter` : New line
  - `Cmd + K` : Open Command Palette (Clear chat, switch models, etc.)
  - `Cmd + ,` : Open Advanced Settings directly
  - `Cmd + B` : Toggle the left Workspaces panel
  - `Cmd + J` : Toggle the right Sessions panel
  - `Cmd + Shift + C` : Instantly copy the latest generated code block
  - `Esc` : Instantly stop/abort ongoing AI generation
- **Haptic Audio Feedback:** Subtle mechanical "thock" on send, and "click" when generation finishes, powered by the Web Audio API.
- **Zero-UI Aesthetic:** Hidden scrollbars, auto-expanding input, and context token counters (`8,192 ctx`) built natively in CSS.
- **Flexible Privacy Model:** Works fully locally with Ollama, or against a remote server you control such as a Tailscale-hosted OpenAI-compatible endpoint. No cloud database or app-side tracking.

## 🛠 Tech Stack
- **Framework:** Electron (Main & Context/Preload IPC)
- **Frontend:** Vanilla HTML, CSS, JavaScript (No heavy frameworks)
- **Rendering:** `marked.js` & `DOMPurify`
- **Highlighting:** `highlight.js` (Tokyo Night Dark)
- **Backend/AI:** Ollama native or OpenAI-compatible HTTP APIs

## 🏃‍♂️ Getting Started

1. **Choose Your Backend**  
   You can use either:

   - Local Ollama native mode:
     ```bash
     ollama run qwen3.5:4b
     ```

   - Remote OpenAI-compatible mode over Tailscale:
     Set the app Base URL to something like `http://<tailscale-ip>:11434/v1`.

   The default model is still `qwen3.5:4b`, but you can change it from Advanced Settings.

2. **Install Dependencies**  
   ```bash
   npm install
   ```

3. **Launch the App**  
   ```bash
   npm run dev
   ```

4. **Configure the Provider**  
   Open Advanced Settings and choose:

   - `API Mode`: `ollama-native` or `openai-compatible`
   - `Base URL`: `http://127.0.0.1:11434` or `http://<tailscale-ip>:11434/v1`
   - `API Key`: optional, only if your server requires it

## Terminal Helper

Terminal Helper is a guided workspace operator for people who do not want to reason through every terminal command alone:

- `Terminal Helper` lives in Advanced Settings and is off by default.
- It runs against native Ollama or OpenAI-compatible backends that support tool use or the app's pseudo-tool fallback.
- It is scoped to the currently selected workspace.
- Available tools are:
  - `list_workspace`
  - `read_file`
  - `search_workspace`
  - `run_command`
  - `start_terminal_task`
  - `get_terminal_task_output`
  - `stop_terminal_task`
  - `propose_file_edit`
  - `propose_file_write`
- Safe read-only commands can run automatically. Package scripts, shell-interpreted commands, installs, long-running terminal tasks, and file changes require approval.
- Terminal tasks render as cards with recent output, refresh, and stop controls.
- File writes are never applied immediately. The app shows an inline diff preview with `Approve` and `Reject` buttons, and the helper loop only resumes after your decision.

Plain chat still streams exactly like before when Terminal Helper is disabled.

## 🧠 What's Next?
- More beginner task templates for common project setup and debugging flows.
- Smarter workspace context selection and file relevance ranking.
- Clearer terminal risk labels for package manager and build commands.

---
*Created with ❤️ during an intense AI Agent collaboration session!*
