marked.setOptions({
  breaks: true,
  gfm: true
});

const appLayout = document.getElementById("app-layout");
const launchCopy = document.getElementById("launch-copy");
const messagesList = document.getElementById("messages");
const promptInput = document.getElementById("prompt-input");
const workspacePill = document.getElementById("workspace-pill");
const modelPill = document.getElementById("model-pill");
const activeFolderNameUI = document.getElementById("active-folder-name");
const activeModelNameUI = document.getElementById("active-model-name");
const tokenCounter = document.getElementById("token-counter");
const stopBtn = document.getElementById("stop-btn");
const statusText = document.getElementById("status-text");

const cmdOverlay = document.getElementById("cmd-palette-overlay");
const cmdInput = document.getElementById("cmd-input");
const cmdResults = document.getElementById("cmd-results");
const cmdModeLabel = document.getElementById("cmd-mode-label");
const cmdBackBtn = document.getElementById("cmd-back-btn");

const settingsModalOverlay = document.getElementById("settings-modal-overlay");
const modelSelect = document.getElementById("model-select");
const tempSlider = document.getElementById("temp-slider");
const tempVal = document.getElementById("temp-val");
const ctxSlider = document.getElementById("ctx-slider");
const ctxVal = document.getElementById("ctx-val");
const settingsCloseBtn = document.getElementById("settings-close-btn");
const settingsSaveBtn = document.getElementById("settings-save-btn");

const systemModalOverlay = document.getElementById("system-modal-overlay");
const systemInput = document.getElementById("system-input");
const systemCloseBtn = document.getElementById("system-close-btn");
const systemSaveBtn = document.getElementById("system-save-btn");

const state = {
  currentFolderPath: "",
  workspacePaths: JSON.parse(localStorage.getItem("warp_chat_workspaces") || "[]"),
  conversationHistory: [],
  chatSessions: [],
  currentSessionId: Date.now().toString(),
  currentModel: localStorage.getItem("warp_chat_model") || "qwen3.5:4b",
  currentTemperature: localStorage.getItem("warp_chat_temp") || "0.7",
  currentContextWindow: localStorage.getItem("warp_chat_ctx") || "8192",
  currentSystemPrompt: localStorage.getItem("warp_chat_sys") || "",
  currentAbortController: null,
  isGenerating: false,
  isAudioMuted: localStorage.getItem("warp_chat_muted") === "true",
  lastGeneratedCodeBlocks: [],
  paletteMode: "root",
  paletteItems: [],
  selectedPaletteIndex: 0,
  isCmdPaletteOpen: false
};

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function basename(targetPath) {
  if (!targetPath) return "Global";
  return targetPath.split("/").pop() || targetPath.split("\\").pop() || "Global";
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean))];
}

function rememberWorkspace(targetPath) {
  state.workspacePaths = uniquePaths([targetPath, ...state.workspacePaths]).slice(0, 8);
  localStorage.setItem("warp_chat_workspaces", JSON.stringify(state.workspacePaths));
}

function updateWorkspaceUI() {
  activeFolderNameUI.textContent = basename(state.currentFolderPath);
  activeFolderNameUI.title = state.currentFolderPath || "Global workspace";
}

function updateModelUI() {
  activeModelNameUI.textContent = state.currentModel;
}

function updateStatus(message) {
  statusText.textContent = message;
}

function setEmptyState(isEmpty) {
  appLayout.dataset.empty = isEmpty ? "true" : "false";
  launchCopy.textContent = isEmpty
    ? "Ask a question, inspect a file, or iterate on code. Use Cmd+K for model, workspace, and session controls."
    : "The transcript is active. Use Cmd+K for model, workspace, export, or recent sessions.";
}

function updateTokenCounter() {
  const estimatedTokens = Math.floor(promptInput.value.length / 4);
  const maxCtx = Number.parseInt(state.currentContextWindow, 10);
  tokenCounter.textContent = `${estimatedTokens.toLocaleString()} / ${maxCtx.toLocaleString()} ctx`;

  tokenCounter.className = "token-counter";
  if (estimatedTokens > maxCtx * 0.85) tokenCounter.classList.add("danger");
  else if (estimatedTokens > maxCtx * 0.6) tokenCounter.classList.add("warning");
}

function autoResizePrompt() {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 220)}px`;
}

function playTone({ type, start, end, attack, release, gain }) {
  if (state.isAudioMuted) return;
  if (audioCtx.state === "suspended") audioCtx.resume();

  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(start, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(end, audioCtx.currentTime + attack + release);

  gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
  gainNode.gain.linearRampToValueAtTime(gain, audioCtx.currentTime + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + attack + release);

  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + attack + release + 0.01);
}

function playThock() {
  playTone({ type: "triangle", start: 140, end: 48, attack: 0.01, release: 0.045, gain: 0.24 });
}

function playClick() {
  playTone({ type: "sine", start: 740, end: 320, attack: 0.004, release: 0.04, gain: 0.12 });
}

function showToast(message) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 2000);
}

function scrollToBottom() {
  messagesList.scrollTop = messagesList.scrollHeight;
}

function setStopVisibility(visible) {
  stopBtn.classList.toggle("hidden", !visible);
}

function clearMessages() {
  messagesList.innerHTML = "";
  state.lastGeneratedCodeBlocks = [];
  setEmptyState(true);
}

function clearConversation({ silent = false } = {}) {
  state.conversationHistory = [];
  state.currentSessionId = Date.now().toString();
  clearMessages();
  updateStatus(`${state.currentModel} standing by`);
  if (!silent) showToast("Started a fresh session");
}

function getRenderableSessions() {
  return state.chatSessions.filter((session) => Array.isArray(session.history) && session.history.length > 0);
}

async function saveCurrentSession() {
  if (state.conversationHistory.length === 0) return;

  const titleSeed = state.conversationHistory.find((message) => message.role === "user");
  const title = titleSeed
    ? titleSeed.content.slice(0, 38) + (titleSeed.content.length > 38 ? "..." : "")
    : "New session";

  const existingIndex = state.chatSessions.findIndex((session) => session.id === state.currentSessionId);
  const payload = {
    id: state.currentSessionId,
    title,
    timestamp: Date.now(),
    history: [...state.conversationHistory]
  };

  if (existingIndex >= 0) state.chatSessions[existingIndex] = payload;
  else state.chatSessions.unshift(payload);

  state.chatSessions = state.chatSessions
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, 25);

  if (window.electronAPI?.saveChats) {
    await window.electronAPI.saveChats(state.chatSessions);
  }
}

function decorateCodeBlocks(container) {
  container.querySelectorAll("pre").forEach((pre) => {
    if (pre.closest(".code-block-shell")) return;

    const codeEl = pre.querySelector("code");
    const rawCode = codeEl ? codeEl.innerText : pre.innerText;
    const languageClass = codeEl?.className
      ?.split(" ")
      .find((item) => item.startsWith("language-"));
    const language = languageClass ? languageClass.replace("language-", "") : "code";

    state.lastGeneratedCodeBlocks.push(rawCode);

    const shell = document.createElement("div");
    shell.className = "code-block-shell";

    const toolbar = document.createElement("div");
    toolbar.className = "code-block-toolbar";

    const label = document.createElement("span");
    label.className = "code-block-language";
    label.textContent = language;

    const copyBtn = document.createElement("button");
    copyBtn.className = "code-block-action";
    copyBtn.type = "button";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", () => {
      window.electronAPI?.copyToClipboard(rawCode);
      copyBtn.textContent = "Copied";
      window.setTimeout(() => {
        copyBtn.textContent = "Copy";
      }, 1500);
    });

    toolbar.append(label, copyBtn);
    pre.parentNode.insertBefore(shell, pre);
    shell.append(toolbar, pre);
  });
}

function enhanceRenderedContent(container) {
  if (window.renderMathInElement) {
    try {
      renderMathInElement(container, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true }
        ],
        throwOnError: false
      });
    } catch (error) {
      console.error("KaTeX error", error);
    }
  }

  const mermaidNodes = [];
  container.querySelectorAll("pre code").forEach((block) => {
    if (block.className.includes("language-mermaid")) {
      const mermaidDiv = document.createElement("div");
      mermaidDiv.className = "mermaid";
      mermaidDiv.textContent = block.textContent;
      block.parentNode.replaceChild(mermaidDiv, block);
      mermaidNodes.push(mermaidDiv);
    } else {
      hljs.highlightElement(block);
    }
  });

  if (window.mermaid && mermaidNodes.length > 0) {
    mermaid.run({ nodes: mermaidNodes }).catch((error) => {
      console.error("Mermaid run error", error);
    });
  }

  decorateCodeBlocks(container);
}

function createAssistantBlock() {
  const block = document.createElement("article");
  block.className = "message-block message-ai is-loading";

  const surface = document.createElement("div");
  surface.className = "message-surface";

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const metaLeft = document.createElement("div");
  metaLeft.className = "message-meta-left";

  const role = document.createElement("span");
  role.className = "message-role";
  role.textContent = "Assistant";

  const model = document.createElement("span");
  model.className = "message-model";
  model.textContent = state.currentModel;

  const actions = document.createElement("div");
  actions.className = "message-actions";

  const copyBtn = document.createElement("button");
  copyBtn.className = "message-action hidden";
  copyBtn.type = "button";
  copyBtn.textContent = "Copy response";
  copyBtn.addEventListener("click", () => {
    window.electronAPI?.copyToClipboard(block.dataset.rawOutput || "");
    showToast("Copied response");
  });

  actions.append(copyBtn);
  metaLeft.append(role, model);
  meta.append(metaLeft, actions);

  const body = document.createElement("div");
  body.className = "message-body markdown-body";

  surface.append(meta, body);
  block.appendChild(surface);

  return { block, body, copyBtn };
}

function renderAssistantContent(body, text, { showCursor = false } = {}) {
  const rawHtml = marked.parse(text || "");
  const html = showCursor
    ? rawHtml.replace(/<\/([^>]+)>$/, '<span class="ai-cursor"></span></$1>')
    : rawHtml;

  body.innerHTML = DOMPurify.sanitize(html);
}

function appendUserMessage(text) {
  const block = document.createElement("article");
  block.className = "message-block message-user";

  const content = document.createElement("div");
  content.className = "message-user-content";
  content.textContent = text;

  block.appendChild(content);
  messagesList.appendChild(block);
  scrollToBottom();
}

function renderConversation() {
  messagesList.innerHTML = "";
  state.lastGeneratedCodeBlocks = [];

  state.conversationHistory.forEach((message) => {
    if (message.role === "user") {
      appendUserMessage(message.content);
      return;
    }

    const { block, body, copyBtn } = createAssistantBlock();
    renderAssistantContent(body, message.content);
    enhanceRenderedContent(body);
    block.dataset.rawOutput = message.content;
    copyBtn.classList.remove("hidden");
    block.classList.remove("is-loading");
    messagesList.appendChild(block);
  });

  setEmptyState(state.conversationHistory.length === 0);
  scrollToBottom();
}

async function loadStoredChats() {
  if (!window.electronAPI?.loadChats) return;
  state.chatSessions = (await window.electronAPI.loadChats()) || [];
}

async function fetchOllamaModels() {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags");
    if (!response.ok) throw new Error("Network response was not ok");
    const data = await response.json();
    return data.models || [];
  } catch (error) {
    console.error("Failed to fetch Ollama models", error);
    return [];
  }
}

async function populateSettingsModels() {
  const models = await fetchOllamaModels();
  modelSelect.innerHTML = "";

  if (models.length === 0) {
    modelSelect.innerHTML = `<option value="${state.currentModel}">${state.currentModel} (offline)</option>`;
    return;
  }

  models.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.name;
    option.textContent = item.name;
    if (item.name === state.currentModel) option.selected = true;
    modelSelect.appendChild(option);
  });
}

function openSettingsModal() {
  settingsModalOverlay.classList.remove("hidden");
  tempSlider.value = state.currentTemperature;
  tempVal.textContent = state.currentTemperature;
  ctxSlider.value = state.currentContextWindow;
  ctxVal.textContent = state.currentContextWindow;
  populateSettingsModels();
}

function closeSettingsModal() {
  settingsModalOverlay.classList.add("hidden");
  promptInput.focus();
}

function openSystemModal() {
  systemModalOverlay.classList.remove("hidden");
  systemInput.value = state.currentSystemPrompt;
  systemInput.focus();
}

function closeSystemModal() {
  systemModalOverlay.classList.add("hidden");
  promptInput.focus();
}

async function setWorkspace(targetPath) {
  if (!targetPath) return;
  state.currentFolderPath = targetPath;
  localStorage.setItem("warp_chat_workspace", targetPath);
  rememberWorkspace(targetPath);
  updateWorkspaceUI();
  showToast(`Workspace set to ${basename(targetPath)}`);
}

async function chooseWorkspace() {
  closeCmdPalette();
  const folderPath = await window.electronAPI?.selectFolder?.();
  if (folderPath) await setWorkspace(folderPath);
}

async function initWorkspace() {
  const storedWorkspace = localStorage.getItem("warp_chat_workspace");
  if (storedWorkspace) {
    state.currentFolderPath = storedWorkspace;
  } else if (window.electronAPI?.getDefaultPath) {
    state.currentFolderPath = await window.electronAPI.getDefaultPath();
  }

  if (state.currentFolderPath) rememberWorkspace(state.currentFolderPath);
  updateWorkspaceUI();
}

function paletteRootItems() {
  return [
    {
      label: "Switch model",
      detail: state.currentModel,
      meta: "models",
      action: "open-models"
    },
    {
      label: "Select workspace",
      detail: basename(state.currentFolderPath),
      meta: "workspace",
      action: "open-workspaces"
    },
    {
      label: "Recent sessions",
      detail: `${getRenderableSessions().length} saved`,
      meta: "sessions",
      action: "open-sessions"
    },
    {
      label: "System prompt",
      detail: state.currentSystemPrompt ? "Configured" : "Empty",
      meta: "prompt",
      action: "open-system"
    },
    {
      label: "Advanced settings",
      detail: `temp ${state.currentTemperature} · ctx ${state.currentContextWindow}`,
      meta: "settings",
      action: "open-settings"
    },
    {
      label: "Export chat",
      detail: "Save transcript as markdown",
      meta: "export",
      action: "export"
    },
    {
      label: "Clear chat",
      detail: "Start a fresh local session",
      meta: "clear",
      action: "clear"
    },
    {
      label: state.isAudioMuted ? "Enable sounds" : "Disable sounds",
      detail: "Toggle restrained feedback",
      meta: "audio",
      action: "toggle-sound"
    }
  ];
}

async function buildPaletteItems(mode) {
  if (mode === "models") {
    const models = await fetchOllamaModels();
    if (models.length === 0) {
      return [
        {
          label: state.currentModel,
          detail: "Current model · engine offline",
          meta: "current",
          action: "select-model",
          value: state.currentModel
        }
      ];
    }

    return models.map((item) => ({
      label: item.name,
      detail: item.name === state.currentModel ? "Current model" : "Available locally",
      meta: item.name === state.currentModel ? "current" : "local",
      action: "select-model",
      value: item.name
    }));
  }

  if (mode === "workspaces") {
    const recents = state.workspacePaths.map((targetPath) => ({
      label: basename(targetPath),
      detail: targetPath,
      meta: targetPath === state.currentFolderPath ? "current" : "recent",
      action: "select-workspace",
      value: targetPath
    }));

    return [
      {
        label: "Choose folder…",
        detail: "Open the macOS folder picker",
        meta: "browse",
        action: "choose-workspace"
      },
      ...recents
    ];
  }

  if (mode === "sessions") {
    const sessions = getRenderableSessions();
    if (sessions.length === 0) {
      return [
        {
          label: "No saved sessions yet",
          detail: "Recent chats appear here after a response completes",
          meta: "",
          action: "noop",
          disabled: true
        }
      ];
    }

    return sessions.map((session) => ({
      label: session.title,
      detail: new Date(session.timestamp).toLocaleString(),
      meta: session.id === state.currentSessionId ? "current" : "saved",
      action: "load-session",
      value: session.id
    }));
  }

  return paletteRootItems();
}

function paletteTitle(mode) {
  if (mode === "models") return "Models";
  if (mode === "workspaces") return "Workspaces";
  if (mode === "sessions") return "Recent Sessions";
  return "Controls";
}

function filteredPaletteItems() {
  const query = cmdInput.value.trim().toLowerCase();
  if (!query) return state.paletteItems;

  return state.paletteItems.filter((item) => {
    return [item.label, item.detail, item.meta]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(query));
  });
}

function renderPaletteList() {
  const items = filteredPaletteItems();
  if (items.length === 0) {
    cmdResults.innerHTML = '<div class="cmd-empty">No matching controls.</div>';
    return;
  }

  if (state.selectedPaletteIndex >= items.length) state.selectedPaletteIndex = 0;

  cmdResults.innerHTML = "";
  items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cmd-item${index === state.selectedPaletteIndex ? " selected" : ""}`;
    button.disabled = Boolean(item.disabled);

    const main = document.createElement("div");
    main.className = "cmd-item-main";

    const label = document.createElement("span");
    label.className = "cmd-item-label";
    label.textContent = item.label;

    main.appendChild(label);

    if (item.detail) {
      const detail = document.createElement("span");
      detail.className = "cmd-item-detail";
      detail.textContent = item.detail;
      main.appendChild(detail);
    }

    const meta = document.createElement("span");
    meta.className = "cmd-item-meta";
    meta.textContent = item.meta || "";

    button.append(main, meta);
    button.addEventListener("mouseenter", () => {
      state.selectedPaletteIndex = index;
      renderPaletteList();
    });
    button.addEventListener("click", () => {
      void executePaletteItem(items[index]);
    });

    cmdResults.appendChild(button);
  });
}

async function renderPalette(mode = state.paletteMode) {
  state.paletteMode = mode;
  state.paletteItems = await buildPaletteItems(mode);
  state.selectedPaletteIndex = 0;
  cmdModeLabel.textContent = paletteTitle(mode);
  cmdBackBtn.classList.toggle("hidden", mode === "root");
  renderPaletteList();
}

async function openCmdPalette(mode = "root") {
  state.isCmdPaletteOpen = true;
  cmdOverlay.classList.remove("hidden");
  cmdInput.value = "";
  await renderPalette(mode);
  cmdInput.focus();
}

function closeCmdPalette() {
  state.isCmdPaletteOpen = false;
  cmdOverlay.classList.add("hidden");
  promptInput.focus();
}

async function loadSession(sessionId) {
  const session = state.chatSessions.find((item) => item.id === sessionId);
  if (!session) return;

  state.currentSessionId = session.id;
  state.conversationHistory = [...session.history];
  renderConversation();
  updateStatus(`${state.currentModel} standing by`);
  closeCmdPalette();
}

async function executePaletteItem(item) {
  if (!item || item.disabled) return;

  if (item.action === "open-models") return renderPalette("models");
  if (item.action === "open-workspaces") return renderPalette("workspaces");
  if (item.action === "open-sessions") return renderPalette("sessions");
  if (item.action === "open-system") {
    closeCmdPalette();
    openSystemModal();
    return;
  }
  if (item.action === "open-settings") {
    closeCmdPalette();
    openSettingsModal();
    return;
  }
  if (item.action === "select-model") {
    state.currentModel = item.value;
    localStorage.setItem("warp_chat_model", state.currentModel);
    updateModelUI();
    updateStatus(`${state.currentModel} selected`);
    closeCmdPalette();
    showToast(`Model set to ${state.currentModel}`);
    return;
  }
  if (item.action === "choose-workspace") {
    await chooseWorkspace();
    return;
  }
  if (item.action === "select-workspace") {
    await setWorkspace(item.value);
    closeCmdPalette();
    return;
  }
  if (item.action === "load-session") {
    await loadSession(item.value);
    return;
  }
  if (item.action === "export") {
    closeCmdPalette();
    await exportChat();
    return;
  }
  if (item.action === "clear") {
    closeCmdPalette();
    clearConversation();
    return;
  }
  if (item.action === "toggle-sound") {
    state.isAudioMuted = !state.isAudioMuted;
    localStorage.setItem("warp_chat_muted", String(state.isAudioMuted));
    closeCmdPalette();
    showToast(state.isAudioMuted ? "Sounds off" : "Sounds on");
    if (!state.isAudioMuted) playClick();
  }
}

async function exportChat() {
  if (state.conversationHistory.length === 0) {
    showToast("Nothing to export");
    return;
  }

  let markdownContent = "# Warp-Chat Export\n\n";
  state.conversationHistory.forEach((message) => {
    markdownContent += `### ${message.role.toUpperCase()}\n${message.content}\n\n---\n\n`;
  });

  if (window.electronAPI?.exportChat) {
    const result = await window.electronAPI.exportChat(markdownContent);
    if (result) showToast("Chat exported");
  }
}

function handleSlashCommand(text) {
  const command = text.split(" ")[0].toLowerCase();

  if (command === "/clear") {
    clearConversation();
  } else if (command === "/export") {
    void exportChat();
  } else if (command === "/system") {
    openSystemModal();
  } else {
    showToast(`Unknown command: ${command}`);
  }

  promptInput.value = "";
  autoResizePrompt();
  updateTokenCounter();
}

async function sendMessage(text) {
  promptInput.value = "";
  autoResizePrompt();
  updateTokenCounter();

  state.isGenerating = true;
  state.currentAbortController = new AbortController();
  state.lastGeneratedCodeBlocks = [];

  setEmptyState(false);
  setStopVisibility(true);
  updateStatus(`${state.currentModel} responding`);

  const meshBg = document.querySelector(".mesh-bg");
  meshBg?.classList.add("paused-animation");

  appendUserMessage(text);
  state.conversationHistory.push({ role: "user", content: text });

  const { block, body, copyBtn } = createAssistantBlock();
  messagesList.appendChild(block);
  scrollToBottom();

  let currentText = "";
  let renderScheduled = false;

  const scheduleRender = () => {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      renderAssistantContent(body, currentText, { showCursor: true });
      scrollToBottom();
    });
  };

  try {
    const messagesToSend = [...state.conversationHistory];

    if (state.currentSystemPrompt) {
      messagesToSend.unshift({ role: "system", content: state.currentSystemPrompt });
    }

    if (window.electronAPI?.getFolderContents && state.currentFolderPath) {
      const filesContext = await window.electronAPI.getFolderContents(state.currentFolderPath);
      if (filesContext) {
        messagesToSend.unshift({
          role: "system",
          content: `You are currently working in the local directory: ${state.currentFolderPath}. The files inside this directory are: ${filesContext}. Please contextualize your responses to this workspace when relevant.`
        });
      }
    }

    const response = await fetch("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: state.currentModel,
        messages: messagesToSend,
        stream: true,
        options: {
          temperature: Number.parseFloat(state.currentTemperature),
          num_ctx: Number.parseInt(state.currentContextWindow, 10)
        }
      }),
      signal: state.currentAbortController.signal
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            currentText += data.message.content;
            scheduleRender();
          }
        } catch (error) {
          console.error("JSON parse error on streaming line:", line, error);
        }
      }
    }
  } catch (error) {
    if (error.name === "AbortError") {
      currentText += "\n\nGeneration stopped.";
    } else {
      console.error("Fetch Error:", error);
      block.classList.add("message-error");
      currentText = `Error connecting to Ollama: ${error.message}. Make sure the engine is running and model ${state.currentModel} is available.`;
      updateStatus("Local model unavailable");
    }
  }

  renderAssistantContent(body, currentText);
  enhanceRenderedContent(body);

  block.dataset.rawOutput = currentText;
  block.classList.remove("is-loading");
  copyBtn.classList.remove("hidden");

  if (!block.classList.contains("message-error")) {
    state.conversationHistory.push({ role: "assistant", content: currentText });
    await saveCurrentSession();
    updateStatus(`${state.currentModel} standing by`);
  }

  playClick();
  state.isGenerating = false;
  state.currentAbortController = null;
  setStopVisibility(false);
  meshBg?.classList.remove("paused-animation");
  scrollToBottom();
}

workspacePill.addEventListener("click", () => {
  void openCmdPalette("workspaces");
});

modelPill.addEventListener("click", () => {
  void openCmdPalette("models");
});

stopBtn.addEventListener("click", () => {
  if (state.isGenerating && state.currentAbortController) {
    state.currentAbortController.abort();
    state.currentAbortController = null;
  }
});

promptInput.addEventListener("input", () => {
  autoResizePrompt();
  updateTokenCounter();
});

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    const text = promptInput.value.trim();
    if (!text || state.isGenerating) return;
    if (text.startsWith("/")) return handleSlashCommand(text);
    playThock();
    void sendMessage(text);
  }
});

cmdInput.addEventListener("input", () => {
  state.selectedPaletteIndex = 0;
  renderPaletteList();
});

cmdInput.addEventListener("keydown", (event) => {
  const items = filteredPaletteItems();
  if (event.key === "ArrowDown") {
    event.preventDefault();
    state.selectedPaletteIndex = items.length === 0 ? 0 : (state.selectedPaletteIndex + 1) % items.length;
    renderPaletteList();
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    state.selectedPaletteIndex = items.length === 0 ? 0 : (state.selectedPaletteIndex - 1 + items.length) % items.length;
    renderPaletteList();
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    void executePaletteItem(items[state.selectedPaletteIndex]);
  }
});

cmdBackBtn.addEventListener("click", () => {
  void renderPalette("root");
});

settingsCloseBtn.addEventListener("click", closeSettingsModal);
settingsSaveBtn.addEventListener("click", () => {
  state.currentModel = modelSelect.value || state.currentModel;
  state.currentTemperature = tempSlider.value;
  state.currentContextWindow = ctxSlider.value;

  localStorage.setItem("warp_chat_model", state.currentModel);
  localStorage.setItem("warp_chat_temp", state.currentTemperature);
  localStorage.setItem("warp_chat_ctx", state.currentContextWindow);

  updateModelUI();
  updateTokenCounter();
  updateStatus(`${state.currentModel} selected`);
  closeSettingsModal();
  showToast("Settings saved");
});

tempSlider.addEventListener("input", (event) => {
  tempVal.textContent = event.target.value;
});

ctxSlider.addEventListener("input", (event) => {
  ctxVal.textContent = event.target.value;
});

systemCloseBtn.addEventListener("click", closeSystemModal);
systemSaveBtn.addEventListener("click", () => {
  state.currentSystemPrompt = systemInput.value.trim();
  localStorage.setItem("warp_chat_sys", state.currentSystemPrompt);
  closeSystemModal();
  showToast(state.currentSystemPrompt ? "System prompt saved" : "System prompt cleared");
});

document.addEventListener("keydown", (event) => {
  if (event.metaKey && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (state.isCmdPaletteOpen) closeCmdPalette();
    else void openCmdPalette("root");
    return;
  }

  if (event.metaKey && event.shiftKey && event.key.toLowerCase() === "c") {
    event.preventDefault();
    const code = state.lastGeneratedCodeBlocks[state.lastGeneratedCodeBlocks.length - 1];
    if (code) {
      window.electronAPI?.copyToClipboard(code);
      showToast("Copied latest code block");
    } else {
      showToast("No code block available");
    }
    return;
  }

  if (event.key === "Escape") {
    if (state.isCmdPaletteOpen) {
      closeCmdPalette();
      return;
    }
    if (!settingsModalOverlay.classList.contains("hidden")) {
      closeSettingsModal();
      return;
    }
    if (!systemModalOverlay.classList.contains("hidden")) {
      closeSystemModal();
      return;
    }
    if (state.isGenerating && state.currentAbortController) {
      state.currentAbortController.abort();
      state.currentAbortController = null;
    }
    return;
  }

  if (
    event.target !== promptInput &&
    !state.isCmdPaletteOpen &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    event.key.length === 1
  ) {
    promptInput.focus();
  }
});

window.addEventListener("blur", () => {
  document.querySelector(".mesh-bg")?.classList.add("paused-animation");
});

window.addEventListener("focus", () => {
  if (!state.isGenerating) document.querySelector(".mesh-bg")?.classList.remove("paused-animation");
});

document.addEventListener("DOMContentLoaded", async () => {
  await loadStoredChats();
  await initWorkspace();
  updateModelUI();
  updateStatus(`${state.currentModel} standing by`);
  updateTokenCounter();
  autoResizePrompt();
  setStopVisibility(false);
  setEmptyState(true);
});
