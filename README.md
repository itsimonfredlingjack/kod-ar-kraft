# Warp-Chat

A blazing fast, keyboard-first, floating macOS desktop client for local LLMs. Built with Electron, Vanilla JS/CSS, and an absolute obsession with developer experience.

![Warp-Chat Interface](https://raw.githubusercontent.com/Poke1650/warp-chat/main/assets/screenshot.png) *(Imagine a beautiful glowing UI here)*

## ✨ Philosophy
Designed to feel like a modern terminal (heavily inspired by Warp). No clutter, no complex history databases, just a blank canvas that melts into your macOS background using native Vibrancy. Built to interact with models like Ollama locally and privately.

## 🚀 Features
- **Native macOS Vibrancy:** The window is frameless, frosted, and blurred, blending perfectly into your desktop environment.
- **Real-time NDJSON Streaming:** Connects directly to local models (defaults to Ollama on `localhost:11434`) with a custom chunk-buffer parser to guarantee zero dropped tokens.
- **Markdown & Code Highlighting:** Live syntax highlighting with the *Tokyo Night Dark* theme via `highlight.js`, dynamically injected into the DOM stream.
- **Keyboard-First Navigation:** 
  - `Enter` : Send prompt
  - `Shift + Enter` : New line
  - `Cmd + K` : Open Command Palette (Clear chat, switch models, etc.)
  - `Cmd + B` : Toggle Local Workspace selection sidebar
  - `Cmd + Shift + C` : Instantly copy the latest generated code block
  - `Esc` : Instantly stop/abort ongoing AI generation
- **Haptic Audio Feedback:** Subtle mechanical "thock" on send, and "click" when generation finishes, powered by the Web Audio API.
- **Zero-UI Aesthetic:** Hidden scrollbars, auto-expanding input, and context token counters (`8,192 ctx`) built natively in CSS.
- **Privacy First:** 100% local. No cloud databases, no external API calls, no tracking. Every app launch is a completely fresh ephemeral session.

## 🛠 Tech Stack
- **Framework:** Electron (Main & Context/Preload IPC)
- **Frontend:** Vanilla HTML, CSS, JavaScript (No heavy frameworks)
- **Rendering:** `marked.js` & `DOMPurify`
- **Highlighting:** `highlight.js` (Tokyo Night Dark)
- **Backend/AI:** Assumes local Ollama instance

## 🏃‍♂️ Getting Started

1. **Start Ollama**  
   Ensure you have Ollama running locally. In this MVP, it targets `qwen3.5:4b` by default, but you can change `currentModel` in `renderer.js`.
   ```bash
   ollama run qwen3.5:4b
   ```

2. **Install Dependencies**  
   ```bash
   npm install
   ```

3. **Launch the App**  
   ```bash
   npm run dev
   ```

## 🧠 What's Next?
- Proper dynamic model selection from the `Cmd+K` palette.
- Advanced context-awareness reading from the selected Workspace folder.

---
*Created with ❤️ during an intense AI Agent collaboration session!*
