const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  copyToClipboard: (text) => ipcRenderer.send('copy-to-clipboard', text),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getDefaultPath: () => ipcRenderer.invoke('get-default-path'),
  getFolderContents: (path) => ipcRenderer.invoke('get-folder-contents', path),
  exportChat: (md) => ipcRenderer.invoke('export-chat', md),
  saveChats: (data) => ipcRenderer.invoke('save-chats', data),
  loadChats: () => ipcRenderer.invoke('load-chats'),
  invokeAgentTool: (payload) => ipcRenderer.invoke('invoke-agent-tool', payload),
  resolvePendingAgentChange: (payload) => ipcRenderer.invoke('resolve-pending-agent-change', payload)
});
