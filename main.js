const { app, BrowserWindow, ipcMain, nativeTheme, dialog } = require('electron');
const path = require('node:path');

function createWindow () {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000', // Transparent for vibrancy to shine through
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');

  // Handle IPC for copying (optional if we don't use clipboard from main, but good to have)
  ipcMain.on('copy-to-clipboard', (event, text) => {
    const { clipboard } = require('electron');
    clipboard.writeText(text);
  });

  // Handle IPC for selecting a folder
  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0]; // Return the selected path
    }
    return null;
  });

  // Get User Home directory for default context
  ipcMain.handle('get-default-path', () => {
    const os = require('node:os');
    return os.homedir();
  });

  // Get simple folder contents string for LLM context
  ipcMain.handle('get-folder-contents', (event, folderPath) => {
    const fs = require('node:fs');
    try {
      const files = fs.readdirSync(folderPath, { withFileTypes: true });
      return files.slice(0, 50).map(f => `${f.name}${f.isDirectory() ? '/' : ''}`).join(', ');
    } catch (e) {
      console.error(e);
      return '';
    }
  });

  // Export Chat to Markdown
  ipcMain.handle('export-chat', async (event, markdownContent) => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Chat',
      defaultPath: path.join(os.homedir(), 'Desktop', `warp-chat-export-${Date.now()}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, markdownContent);
      return true;
    }
    return false;
  });

  // Chat History Management
  const chatsFilePath = require('node:path').join(app.getPath('userData'), 'warp-chats.json');

  ipcMain.handle('save-chats', (event, chatsData) => {
    const fs = require('node:fs');
    try {
      fs.writeFileSync(chatsFilePath, JSON.stringify(chatsData));
      return true;
    } catch (e) {
      console.error('Failed to save chats:', e);
      return false;
    }
  });

  ipcMain.handle('load-chats', (event) => {
    const fs = require('node:fs');
    try {
      if (fs.existsSync(chatsFilePath)) {
        return JSON.parse(fs.readFileSync(chatsFilePath, 'utf8'));
      }
    } catch (e) {
      console.error('Failed to load chats:', e);
    }
    return [];
  });
}

// Ensure vibrancy works correcty by making sure hardware acceleration is enabled
app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark'; // Force dark mode for optimal glow and aesthetics
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
