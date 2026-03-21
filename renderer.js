// Markdown options (highlighting is handled post-render via DOM)
marked.setOptions({
  breaks: true // Enables line breaks instead of ignoring them
});

// Elements
const messagesList = document.getElementById('messages');
const promptInput = document.getElementById('prompt-input');
const projectsSidebar = document.getElementById('projects-sidebar');
const addProjectBtn = document.getElementById('add-project-btn');
const projectsListUI = document.getElementById('projects-list');
const activeFolderNameUI = document.getElementById('active-folder-name');
const historySidebar = document.getElementById('history-sidebar');
const historyList = document.getElementById('history-list');

let currentFolderPath = '';

// Initialize default path
async function initContext() {
  if (window.electronAPI && window.electronAPI.getDefaultPath) {
    currentFolderPath = await window.electronAPI.getDefaultPath();
    const folderName = currentFolderPath.split('/').pop() || currentFolderPath.split('\\').pop() || 'Global';
    if (activeFolderNameUI) {
      activeFolderNameUI.textContent = folderName;
      activeFolderNameUI.title = currentFolderPath;
    }
  }
}
initContext();

// --- Sidebar Logic ---
let isSidebarOpen = false;

function toggleSidebar() {
  isSidebarOpen = !isSidebarOpen;
  if (isSidebarOpen) {
    projectsSidebar.classList.remove('hidden');
  } else {
    projectsSidebar.classList.add('hidden');
  }
}

// Cmd + B toggles sidebar
document.addEventListener('keydown', (e) => {
  // Cmd+B for Projects Sidebar
  if (e.key === 'b' && e.metaKey) {
    e.preventDefault();
    projectsSidebar.classList.toggle('hidden');
  }
  
  // Cmd+J for History Sidebar
  if (e.key === 'j' && e.metaKey) {
    e.preventDefault();
    historySidebar.classList.toggle('hidden');
  }
});

addProjectBtn.addEventListener('click', async () => {
  const folderPath = await window.electronAPI.selectFolder();
  if (folderPath) {
    // Remove empty state message
    const emptyLi = projectsListUI.querySelector('.empty-projects');
    if (emptyLi) emptyLi.remove();
    
    const folderName = folderPath.split('/').pop() || folderPath.split('\\').pop();
    const li = document.createElement('li');
    li.className = 'project-item';
    li.innerHTML = `<span style="opacity:0.6;font-size:12px">📁</span> <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${folderPath}">${folderName}</span>`;
    
    li.addEventListener('click', () => {
      document.querySelectorAll('.project-item').forEach(item => item.classList.remove('active'));
      li.classList.add('active');
      currentFolderPath = folderPath;
      if (activeFolderNameUI) {
        activeFolderNameUI.textContent = folderName;
        activeFolderNameUI.title = folderPath;
      }
      showToast('Workspace set to: ' + folderName);
    });
    
    projectsListUI.appendChild(li);
    if (projectsListUI.children.length === 1) li.click(); // Auto-select first
  }
});

// --- Typewriter Placeholder Animation ---
const placeholders = [
  "Write a Python script for data analysis...",
  "Explain quantum computing simply...",
  "Refactor this React component...",
  "Translate this code to Rust...",
  "Type a command... (Enter to send)"
];

let placeholderIndex = 0;
let charIndex = 0;
let isDeleting = false;
let typeSpeed = 50;

function typePlaceholder() {
  const currentText = placeholders[placeholderIndex];
  
  if (isDeleting) {
    promptInput.placeholder = currentText.substring(0, charIndex - 1);
    charIndex--;
    typeSpeed = 20; // faster delete
  } else {
    promptInput.placeholder = currentText.substring(0, charIndex + 1);
    charIndex++;
    typeSpeed = 60; // slower type
  }

  // If word is complete
  if (!isDeleting && charIndex === currentText.length) {
    isDeleting = true;
    typeSpeed = 2500; // Pause at end of word
  } else if (isDeleting && charIndex === 0) {
    isDeleting = false;
    placeholderIndex = (placeholderIndex + 1) % placeholders.length;
    typeSpeed = 500; // Pause before new word
  }

  // Don't animate if input has value or is generating
  if (promptInput.value === '' && !isGenerating) {
    setTimeout(typePlaceholder, typeSpeed);
  } else {
    // If user starts typing or generating, wait and check again
    promptInput.placeholder = "Type a message... (Enter to send)";
    setTimeout(typePlaceholder, 2000);
  }
}

// Start typewriter
setTimeout(typePlaceholder, 1000);

// --- Audio Haptics System ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let isAudioMuted = localStorage.getItem('warp_chat_muted') === 'true';

function playThock() {
  if (isAudioMuted) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  
  osc.type = 'sine';
  // Rapid pitch drop for a mechanical thock
  osc.frequency.setValueAtTime(150, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.05);
  
  // Very short envelope
  gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
  gainNode.gain.linearRampToValueAtTime(0.4, audioCtx.currentTime + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);
  
  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  
  osc.start();
  osc.stop(audioCtx.currentTime + 0.06);
}

function playClick() {
  if (isAudioMuted) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(800, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.03);
  
  gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
  gainNode.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 0.005);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.04);
  
  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  
  osc.start();
  osc.stop(audioCtx.currentTime + 0.05);
}

// --- Command Palette Logic ---
const cmdOverlay = document.getElementById('cmd-palette-overlay');
const cmdInput = document.getElementById('cmd-input');
const cmdItems = document.querySelectorAll('.cmd-item');
let isCmdPaletteOpen = false;

function toggleCmdPalette() {
  isCmdPaletteOpen = !isCmdPaletteOpen;
  if (isCmdPaletteOpen) {
    cmdOverlay.classList.remove('hidden');
    cmdInput.value = '';
    cmdInput.focus();
    filterCmdItems('');
  } else {
    cmdOverlay.classList.add('hidden');
    promptInput.focus();
  }
}

// Close on escape or stop generation
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (isCmdPaletteOpen) {
      toggleCmdPalette();
    } else if (isGenerating && currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
  }
});

// Cmd + K listener
document.addEventListener('keydown', (e) => {
  if (e.key === 'k' && e.metaKey) {
    e.preventDefault();
    toggleCmdPalette();
  }
});

// Filter commands on type
cmdInput.addEventListener('input', (e) => {
  filterCmdItems(e.target.value.toLowerCase());
});

function filterCmdItems(query) {
  let firstVisible = null;
  cmdItems.forEach(item => {
    item.classList.remove('selected');
    if (item.innerText.toLowerCase().includes(query)) {
      item.style.display = 'flex';
      if (!firstVisible) {
        firstVisible = item;
        item.classList.add('selected');
      }
    } else {
      item.style.display = 'none';
    }
  });
}

// Handle command execution
cmdInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const selectedItem = document.querySelector('.cmd-item.selected');
    if (selectedItem) {
      executeCommand(selectedItem.dataset.action);
    }
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const visibleItems = Array.from(cmdItems).filter(item => item.style.display !== 'none');
    const selectedIndex = visibleItems.findIndex(item => item.classList.contains('selected'));
    
    if (visibleItems.length > 0) {
      visibleItems[selectedIndex].classList.remove('selected');
      let newIndex = e.key === 'ArrowDown' ? selectedIndex + 1 : selectedIndex - 1;
      
      if (newIndex >= visibleItems.length) newIndex = 0;
      if (newIndex < 0) newIndex = visibleItems.length - 1;
      
      visibleItems[newIndex].classList.add('selected');
      visibleItems[newIndex].scrollIntoView({ block: 'nearest' });
    }
  }
});

function executeCommand(action) {
  toggleCmdPalette(); // close it
  if (action === 'clear') {
    conversationHistory = [];
    currentSessionId = Date.now().toString(); // Break into new session
    const msgs = document.getElementById('messages');
    if (msgs) {
      msgs.innerHTML = '<div class="welcome-message text-muted">Awaiting your command...</div>';
    }
    const motd = document.getElementById('motd-container');
    if (motd) motd.classList.remove('hidden');
    showToast('Chat cleared');
    saveCurrentSession(); // Save the cleared state (empty history)
  } else if (action === 'prompt') {
    openSettingsModal();
  } else if (action === 'toggle-sound') {
    isAudioMuted = !isAudioMuted;
    localStorage.setItem('warp_chat_muted', isAudioMuted);
    showToast(isAudioMuted ? 'Sounds muted 🔇' : 'Sounds unmuted 🔊');
    if (!isAudioMuted) playClick();
  } else {
    // generic toast for others
    showToast('Command executed: ' + action);
  }
}

// Focus input on any key press (if not already focused, no modifiers, and not in palette)
document.addEventListener('keydown', (e) => {
  if (e.target !== promptInput && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1) {
    promptInput.focus();
  }
});

const tokenCounter = document.getElementById('token-counter');

function updateTokenCounter() {
  const estimatedTokens = Math.floor(promptInput.value.length / 4);
  const maxCtx = parseInt(currentContextWindow, 10);
  tokenCounter.textContent = `${estimatedTokens.toLocaleString()} / ${maxCtx.toLocaleString()} ctx`;
  
  if (estimatedTokens > maxCtx * 0.85) tokenCounter.className = 'token-counter danger';
  else if (estimatedTokens > maxCtx * 0.6) tokenCounter.className = 'token-counter warning';
  else tokenCounter.className = 'token-counter';
}

// Auto-resize textarea and update tokens
promptInput.addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = (this.scrollHeight) + 'px';
  if (this.value === '') {
    this.style.height = 'auto';
  }
  updateTokenCounter();
});

let isGenerating = false;
let currentAbortController = null;
let lastGeneratedCodeBlocks = [];
const stopBtn = document.getElementById('stop-btn');

if (stopBtn) {
  stopBtn.addEventListener('click', () => {
    if (isGenerating && currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
  });
}

// Handle Enter to send (Shift+Enter for new line)
promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !isCmdPaletteOpen) {
    e.preventDefault();
    const text = promptInput.value.trim();
    if (text.startsWith('/')) {
      handleSlashCommand(text);
      return;
    }
    if (text && !isGenerating) {
      playThock(); // Haptic feedback
      sendMessage(text);
    }
  }
});

function handleSlashCommand(text) {
  const args = text.split(' ');
  const cmd = args[0].toLowerCase();
  
  if (cmd === '/clear') {
    executeCommand('clear');
    promptInput.value = '';
    promptInput.style.height = 'auto';
    updateTokenCounter();
  } else if (cmd === '/export') {
    exportChat();
    promptInput.value = '';
    promptInput.style.height = 'auto';
    updateTokenCounter();
  } else if (cmd === '/system') {
    openSystemModal();
    promptInput.value = '';
    promptInput.style.height = 'auto';
    updateTokenCounter();
  } else {
    showToast(`Unknown command: ${cmd}`);
  }
}

async function exportChat() {
  if (conversationHistory.length === 0) {
    showToast('Nothing to export!');
    return;
  }
  let md = "# Warp-Chat Export\n\n";
  conversationHistory.forEach(msg => {
    md += `### ${msg.role.toUpperCase()}\n${msg.content}\n\n---\n\n`;
  });
  
  if (window.electronAPI && window.electronAPI.exportChat) {
    const result = await window.electronAPI.exportChat(md);
    if (result) {
      showToast('Chat exported successfully! 📝');
    }
  }
}

// Handle Cmd+Shift+C to copy last code block
document.addEventListener('keydown', (e) => {
  if (e.key === 'C' && e.shiftKey && e.metaKey) {
    e.preventDefault();
    if (lastGeneratedCodeBlocks.length > 0) {
      const textToCopy = lastGeneratedCodeBlocks[lastGeneratedCodeBlocks.length - 1];
      window.electronAPI.copyToClipboard(textToCopy);
      showToast('Copied latest code block!');
    } else {
      showToast('No code block to copy');
    }
  }
});

function appendUserMessage(text) {
  const msgDiv = document.createElement('div');
  msgDiv.className = 'message-block message-user';
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-user-content';
  contentDiv.textContent = text; // Plain text for user (or we could use marked too)
  
  msgDiv.appendChild(contentDiv);
  messagesList.appendChild(msgDiv);
  scrollToBottom();
}

let conversationHistory = [];
let chatSessions = [];
let currentSessionId = Date.now().toString();
let currentModel = localStorage.getItem('warp_chat_model') || 'qwen3.5:4b';
let currentTemperature = localStorage.getItem('warp_chat_temp') || '0.7';
let currentContextWindow = localStorage.getItem('warp_chat_ctx') || '8192';
let currentSystemPrompt = localStorage.getItem('warp_chat_sys') || '';

// Function to fake a streaming LLM response for demonstration
async function sendMessage(text) {
  promptInput.value = '';
  promptInput.style.height = 'auto';
  isGenerating = true;
  lastGeneratedCodeBlocks = []; // Reset for new generation
  currentAbortController = new AbortController();
  
  if (stopBtn) stopBtn.classList.remove('hidden');

  // Re-init token counter
  updateTokenCounter();

  // Remove welcome message if exists
  const welcome = document.querySelector('.welcome-message');
  if (welcome) welcome.remove();

  // Hide MOTD
  const motd = document.getElementById('motd-container');
  if (motd && !motd.classList.contains('hidden')) {
    motd.classList.add('hidden');
  }

  appendUserMessage(text);
  conversationHistory.push({ role: 'user', content: text });

  // Setup AI block
  const aiBlock = document.createElement('div');
  aiBlock.className = 'message-block message-ai is-loading markdown-body';
  messagesList.appendChild(aiBlock);
  scrollToBottom();

  // Pause background animation gracefully
  const meshBg = document.querySelector('.mesh-bg');
  if (meshBg) meshBg.classList.add('paused-animation');

  let currentText = "";

  try {
    // Inject Contextual System Prompt
    let messagesToSend = [...conversationHistory];

    if (currentSystemPrompt) {
      messagesToSend.unshift({
        role: 'system',
        content: currentSystemPrompt
      });
    }

    if (window.electronAPI && window.electronAPI.getFolderContents && currentFolderPath) {
      const filesContext = await window.electronAPI.getFolderContents(currentFolderPath);
      if (filesContext) {
        messagesToSend.unshift({
          role: 'system',
          content: `You are currently working in the local directory: ${currentFolderPath}. The files inside this directory are: ${filesContext}. Please contextualize your responses to this workspace when relevant.`
        });
      }
    }

    const response = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: currentModel,
        messages: messagesToSend,
        stream: true,
        options: {
          temperature: parseFloat(currentTemperature),
          num_ctx: parseInt(currentContextWindow, 10)
        }
      }),
      signal: currentAbortController.signal
    });

    if (!response.ok) {
      throw new Error(`Ollama API Error: HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      
      // The last line might be incomplete, keep it in the buffer
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.message && data.message.content) {
            currentText += data.message.content;
            
            // Parse partial markdown
            const rawHtml = marked.parse(currentText);
            
            // Add the AI cursor to the very end during stream
            const htmlWithCursor = rawHtml.replace(/<\/([^>]+)>$/, '<span class="ai-cursor"></span></$1>');
            
            aiBlock.innerHTML = DOMPurify.sanitize(htmlWithCursor);
            
            // Simple syntax highlight during stream (exclude mermaid)
            aiBlock.querySelectorAll('pre code').forEach(block => {
              if (!block.className.includes('language-mermaid')) {
                hljs.highlightElement(block);
              }
            });
            scrollToBottom();
          }
        } catch (e) {
          console.error("JSON parse error on streaming line:", line, e);
        }
      }
    }

  } catch (error) {
    if (error.name === 'AbortError') {
      currentText += '\n\n*(Generation stopped by user)*';
      console.log('Generation aborted.');
    } else {
      console.error("Fetch Error:", error);
      aiBlock.classList.remove('markdown-body');
      aiBlock.classList.add('message-error');
      currentText = `Error connecting to Ollama: ${error.message}. Make sure the engine is running and model ${currentModel} is pulled.`;
    }
  }

  // Final render without cursor
  aiBlock.innerHTML = DOMPurify.sanitize(marked.parse(currentText));

  // 1. Process KaTeX Math
  if (window.renderMathInElement) {
    try {
      renderMathInElement(aiBlock, {
        delimiters: [
          {left: '$$', right: '$$', display: true},
          {left: '$', right: '$', display: false},
          {left: '\\(', right: '\\)', display: false},
          {left: '\\[', right: '\\]', display: true}
        ],
        throwOnError: false
      });
    } catch (e) {
      console.error("KaTeX error", e);
    }
  }

  // 2. Process Highlight.js & Convert Mermaid Blocks
  const mermaidNodes = [];
  aiBlock.querySelectorAll('pre code').forEach(block => {
    if (block.className.includes('language-mermaid')) {
      const mermaidDiv = document.createElement('div');
      mermaidDiv.className = 'mermaid';
      mermaidDiv.textContent = block.textContent;
      block.parentNode.replaceChild(mermaidDiv, block);
      mermaidNodes.push(mermaidDiv);
    } else {
      hljs.highlightElement(block);
    }
  });

  // 3. Render Mermaid Diagrams
  if (window.mermaid && mermaidNodes.length > 0) {
    try {
      await mermaid.run({ nodes: mermaidNodes });
    } catch (e) {
      console.error("Mermaid run error", e);
    }
  }

  // Only save to history if it wasn't an error
  if (!currentText.startsWith('*Error')) {
    conversationHistory.push({ role: 'assistant', content: currentText });
    saveCurrentSession();
  }
  
  // Done
  aiBlock.classList.remove('is-loading');
  aiBlock.classList.add('is-done');
  
  // Post-process the final DOM to add "Copy" buttons to code blocks
  injectCodeCopyButtons(aiBlock);
  injectMsgToolbar(aiBlock, currentText);
  
  // Terminal blinking cursor removal sound
  playClick();

  isGenerating = false;
  currentAbortController = null;
  if (stopBtn) stopBtn.classList.add('hidden');
  
  // Resume background animation if window has focus
  if (meshBg && document.hasFocus()) {
    meshBg.classList.remove('paused-animation');
  }
}

function injectMsgToolbar(block, fullText) {
  const toolbar = document.createElement('div');
  toolbar.className = 'msg-toolbar';
  
  const copyBtn = document.createElement('button');
  copyBtn.className = 'msg-tool-btn';
  copyBtn.innerHTML = '⎘';
  copyBtn.title = 'Copy Output';
  copyBtn.onclick = () => {
    window.electronAPI.copyToClipboard(fullText);
    showToast('Copied full AI output!');
  };

  const regenBtn = document.createElement('button');
  regenBtn.className = 'msg-tool-btn';
  regenBtn.innerHTML = '↻';
  regenBtn.title = 'Regenerate';
  regenBtn.onclick = () => showToast('Regenerating...'); // Dummy

  const pinBtn = document.createElement('button');
  pinBtn.className = 'msg-tool-btn';
  pinBtn.innerHTML = '📌';
  pinBtn.title = 'Pin to Context';
  pinBtn.onclick = () => showToast('Pinned to context'); // Dummy

  toolbar.appendChild(pinBtn);
  toolbar.appendChild(regenBtn);
  toolbar.appendChild(copyBtn);
  
  block.appendChild(toolbar);
}

function injectCodeCopyButtons(container) {
  const preElements = container.querySelectorAll('pre');
  
  preElements.forEach((pre) => {
    // Save raw code for Cmd+Shift+C
    const codeEl = pre.querySelector('code');
    const rawCode = codeEl ? codeEl.innerText : pre.innerText;
    lastGeneratedCodeBlocks.push(rawCode);

    // Wrap the pre inside a relative div
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';
    
    // Create copy button
    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.textContent = 'Copy';
    
    btn.addEventListener('click', () => {
      window.electronAPI.copyToClipboard(rawCode);
      btn.textContent = 'Copied!';
      btn.style.color = 'var(--text-main)';
      setTimeout(() => {
        btn.textContent = 'Copy';
        btn.style.color = 'var(--text-muted)';
      }, 2000);
    });

    // Replace pre with wrapper > pre + btn
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);
    wrapper.appendChild(btn);
  });
}

function scrollToBottom() {
  messagesList.scrollTop = messagesList.scrollHeight;
}

// Temporary simple toast system
function showToast(message) {
  const toast = document.createElement('div');
  toast.innerText = message;
  toast.style.position = 'fixed';
  toast.style.bottom = '80px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.background = 'rgba(255, 255, 255, 0.1)';
  toast.style.color = 'white';
  toast.style.padding = '8px 16px';
  toast.style.borderRadius = '20px';
  toast.style.fontSize = '12px';
  toast.style.backdropFilter = 'blur(10px)';
  toast.style.zIndex = '1000';
  toast.style.transition = 'opacity 0.3s ease';
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// Global Window Focus / Blur Hooks
window.addEventListener('blur', () => {
  const meshBg = document.querySelector('.mesh-bg');
  if (meshBg) meshBg.classList.add('paused-animation');
});

window.addEventListener('focus', () => {
  const meshBg = document.querySelector('.mesh-bg');
  if (meshBg && !isGenerating) {
    meshBg.classList.remove('paused-animation');
  }
});

// --- Settings Modal Logic ---
const settingsModalOverlay = document.getElementById('settings-modal-overlay');
const modelSelect = document.getElementById('model-select');
const tempSlider = document.getElementById('temp-slider');
const tempVal = document.getElementById('temp-val');
const ctxSlider = document.getElementById('ctx-slider');
const ctxVal = document.getElementById('ctx-val');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const settingsSaveBtn = document.getElementById('settings-save-btn');

async function fetchOllamaModels() {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags');
    if (!res.ok) throw new Error('Network response was not ok');
    const data = await res.json();
    modelSelect.innerHTML = '';
    if (data.models && data.models.length > 0) {
      data.models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.textContent = m.name;
        if (m.name === currentModel) opt.selected = true;
        modelSelect.appendChild(opt);
      });
    } else {
      modelSelect.innerHTML = '<option value="">No models found</option>';
    }
  } catch (err) {
    console.error("Failed to fetch Ollama models", err);
    modelSelect.innerHTML = `<option value="${currentModel}">${currentModel} (offline)</option>`;
  }
}

function openSettingsModal() {
  settingsModalOverlay.classList.remove('hidden');
  
  tempSlider.value = currentTemperature;
  tempVal.textContent = currentTemperature;
  ctxSlider.value = currentContextWindow;
  ctxVal.textContent = currentContextWindow;
  
  fetchOllamaModels();
}

function closeSettingsModal() {
  settingsModalOverlay.classList.add('hidden');
  promptInput.focus();
}

tempSlider.addEventListener('input', (e) => tempVal.textContent = e.target.value);
ctxSlider.addEventListener('input', (e) => ctxVal.textContent = e.target.value);

settingsCloseBtn.addEventListener('click', closeSettingsModal);

settingsSaveBtn.addEventListener('click', () => {
  currentModel = modelSelect.value || currentModel;
  currentTemperature = tempSlider.value;
  currentContextWindow = ctxSlider.value;

  localStorage.setItem('warp_chat_model', currentModel);
  localStorage.setItem('warp_chat_temp', currentTemperature);
  localStorage.setItem('warp_chat_ctx', currentContextWindow);

  closeSettingsModal();
  showToast('Settings saved ⚙️');
  updateTokenCounter();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!settingsModalOverlay.classList.contains('hidden')) {
      closeSettingsModal();
    } else if (!systemModalOverlay.classList.contains('hidden')) {
      closeSystemModal();
    }
  }
});

// --- System Prompt Modal Logic ---
const systemModalOverlay = document.getElementById('system-modal-overlay');
const systemInput = document.getElementById('system-input');
const systemCloseBtn = document.getElementById('system-close-btn');
const systemSaveBtn = document.getElementById('system-save-btn');

function openSystemModal() {
  systemModalOverlay.classList.remove('hidden');
  systemInput.value = currentSystemPrompt;
  systemInput.focus();
}

function closeSystemModal() {
  systemModalOverlay.classList.add('hidden');
  promptInput.focus();
}

systemCloseBtn.addEventListener('click', closeSystemModal);

systemSaveBtn.addEventListener('click', () => {
  currentSystemPrompt = systemInput.value.trim();
  localStorage.setItem('warp_chat_sys', currentSystemPrompt);
  closeSystemModal();
  showToast('System prompt saved 🧠');
});

// --- History Sessions Logic ---

async function saveCurrentSession() {
  if (conversationHistory.length === 0) return;
  
  let sessionIndex = chatSessions.findIndex(s => s.id === currentSessionId);
  const firstUserMsg = conversationHistory.find(m => m.role === 'user');
  const title = firstUserMsg ? firstUserMsg.content.substring(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '') : 'New Chat';

  if (sessionIndex !== -1) {
    chatSessions[sessionIndex].history = [...conversationHistory];
    chatSessions[sessionIndex].title = title;
  } else {
    chatSessions.unshift({
      id: currentSessionId,
      title: title,
      timestamp: Date.now(),
      history: [...conversationHistory]
    });
  }
  
  if (window.electronAPI && window.electronAPI.saveChats) {
    await window.electronAPI.saveChats(chatSessions);
  }
  renderHistorySidebar();
}

function renderHistorySidebar() {
  if (!historyList) return;
  historyList.innerHTML = '';
  
  if (chatSessions.length === 0) {
    historyList.innerHTML = '<li class="empty-projects">No history found.</li>';
    return;
  }
  
  chatSessions.forEach(session => {
    const li = document.createElement('li');
    li.className = `project-item ${session.id === currentSessionId ? 'active' : ''}`;
    
    li.innerHTML = `<span class="project-icon" style="opacity:0.6">💬</span> <span class="project-name" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${session.title}">${session.title}</span>`;
    
    li.addEventListener('click', () => {
      loadSession(session.id);
    });
    
    historyList.appendChild(li);
  });
}

function loadSession(id) {
  const session = chatSessions.find(s => s.id === id);
  if (!session) return;
  
  currentSessionId = id;
  conversationHistory = [...session.history];
  
  const messagesDiv = document.getElementById('messages');
  messagesDiv.innerHTML = '';
  
  session.history.forEach(msg => {
    const block = document.createElement('div');
    block.className = `message-block message-${msg.role}`;
    
    if (msg.role === 'user') {
      block.innerHTML = `<div class="message-user-content">${msg.content}</div>`;
    } else {
      block.innerHTML = DOMPurify.sanitize(marked.parse(msg.content));
      
      if (window.renderMathInElement) {
        try {
          renderMathInElement(block, {
            delimiters: [
              {left: '$$', right: '$$', display: true},
              {left: '$', right: '$', display: false},
              {left: '\\(', right: '\\)', display: false},
              {left: '\\[', right: '\\]', display: true}
            ],
            throwOnError: false
          });
        } catch (e) {}
      }
      block.querySelectorAll('pre code').forEach(c => {
         if(!c.className.includes('language-mermaid')) hljs.highlightElement(c);
      });
    }
    messagesDiv.appendChild(block);
  });
  
  scrollToBottom();
  renderHistorySidebar();
}

document.addEventListener('DOMContentLoaded', async () => {
  if (window.electronAPI && window.electronAPI.loadChats) {
    chatSessions = await window.electronAPI.loadChats() || [];
    renderHistorySidebar();
  }
});
