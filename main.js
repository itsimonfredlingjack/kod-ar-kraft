const { app, BrowserWindow, ipcMain, nativeTheme, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const pendingAgentChanges = new Map();

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');

  ipcMain.on('copy-to-clipboard', (event, text) => {
    const { clipboard } = require('electron');
    clipboard.writeText(text);
  });

  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }

    return null;
  });

  ipcMain.handle('get-default-path', () => {
    return os.homedir();
  });

  ipcMain.handle('get-folder-contents', async (event, folderPath) => {
    try {
      const files = await fsp.readdir(folderPath, { withFileTypes: true });
      return files
        .slice(0, 50)
        .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`)
        .join(', ');
    } catch (error) {
      console.error(error);
      return '';
    }
  });

  ipcMain.handle('export-chat', async (event, markdownContent) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Chat',
      defaultPath: path.join(os.homedir(), 'Desktop', `warp-chat-export-${Date.now()}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });

    if (!result.canceled && result.filePath) {
      await fsp.writeFile(result.filePath, markdownContent);
      return true;
    }

    return false;
  });

  const chatsFilePath = path.join(app.getPath('userData'), 'warp-chats.json');

  ipcMain.handle('save-chats', async (event, chatsData) => {
    try {
      await fsp.writeFile(chatsFilePath, JSON.stringify(chatsData));
      return true;
    } catch (error) {
      console.error('Failed to save chats:', error);
      return false;
    }
  });

  ipcMain.handle('load-chats', async () => {
    try {
      if (fs.existsSync(chatsFilePath)) {
        return JSON.parse(await fsp.readFile(chatsFilePath, 'utf8'));
      }
    } catch (error) {
      console.error('Failed to load chats:', error);
    }

    return [];
  });

  ipcMain.handle('invoke-agent-tool', async (event, payload) => {
    return invokeAgentTool(payload);
  });

  ipcMain.handle('resolve-pending-agent-change', async (event, payload) => {
    return resolvePendingAgentChange(payload);
  });
}

function createToolError(message, code = 'AGENT_TOOL_ERROR') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

async function fileExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function ensurePathInsideRoot(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    createToolError('Path escapes the selected workspace.', 'WORKSPACE_PATH_ESCAPE');
  }
}

async function resolveWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) {
    createToolError('A workspace must be selected before using agent tools.', 'MISSING_WORKSPACE');
  }

  const rootRealPath = await fsp.realpath(workspaceRoot).catch(() => {
    createToolError('The selected workspace could not be resolved.', 'WORKSPACE_NOT_FOUND');
  });

  return rootRealPath;
}

async function resolveWorkspaceTarget(workspaceRoot, relativePath = '.', { allowMissing = false } = {}) {
  const rootRealPath = await resolveWorkspaceRoot(workspaceRoot);
  const candidatePath = path.resolve(rootRealPath, relativePath || '.');
  ensurePathInsideRoot(rootRealPath, candidatePath);

  if (!allowMissing) {
    const targetRealPath = await fsp.realpath(candidatePath).catch(() => {
      createToolError(`Path not found: ${relativePath}`, 'WORKSPACE_PATH_NOT_FOUND');
    });
    ensurePathInsideRoot(rootRealPath, targetRealPath);
    return {
      rootRealPath,
      targetPath: targetRealPath,
      relativePath: path.relative(rootRealPath, targetRealPath) || '.'
    };
  }

  let existingAncestor = candidatePath;
  while (!(await fileExists(existingAncestor))) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) {
      createToolError(`Unable to resolve path: ${relativePath}`, 'WORKSPACE_PATH_NOT_FOUND');
    }
    existingAncestor = parent;
  }

  const ancestorRealPath = await fsp.realpath(existingAncestor);
  ensurePathInsideRoot(rootRealPath, ancestorRealPath);

  return {
    rootRealPath,
    targetPath: candidatePath,
    relativePath: path.relative(rootRealPath, candidatePath) || '.'
  };
}

function clampInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function buildCreatePreview(content, maxLines = 240) {
  const allLines = content.split('\n');
  const visible = allLines.slice(0, maxLines).map((line) => `+${line}`);
  if (allLines.length > maxLines) {
    visible.push(`+... (${allLines.length - maxLines} more lines)`);
  }
  return ['@@ -0,0 +1,' + allLines.length + ' @@', ...visible].join('\n');
}

function buildUpdatePreview(existingContent, nextContent) {
  if (existingContent === nextContent) {
    return '@@ no changes @@';
  }

  const before = existingContent.split('\n');
  const after = nextContent.split('\n');

  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const removed = before.slice(prefix, before.length - suffix);
  const added = after.slice(prefix, after.length - suffix);
  const previewLines = [
    `@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`
  ];

  removed.slice(0, 120).forEach((line) => previewLines.push(`-${line}`));
  added.slice(0, 120).forEach((line) => previewLines.push(`+${line}`));

  if (removed.length > 120 || added.length > 120) {
    previewLines.push('... diff preview truncated ...');
  }

  return previewLines.join('\n');
}

async function listWorkspaceTool(args, workspaceRoot) {
  const relativePath = typeof args.relativePath === 'string' && args.relativePath.trim()
    ? args.relativePath.trim()
    : '.';
  const maxEntries = clampInteger(args.maxEntries, 50, { min: 1, max: 200 });
  const { rootRealPath, targetPath, relativePath: resolvedRelativePath } = await resolveWorkspaceTarget(
    workspaceRoot,
    relativePath
  );

  const stats = await fsp.stat(targetPath);
  if (!stats.isDirectory()) {
    createToolError(`${resolvedRelativePath} is not a directory.`, 'WORKSPACE_NOT_DIRECTORY');
  }

  const entries = await fsp.readdir(targetPath, { withFileTypes: true });
  const sortedEntries = entries
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    })
    .slice(0, maxEntries)
    .map((entry) => {
      const absoluteEntryPath = path.join(targetPath, entry.name);
      return {
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
        relativePath: path.relative(rootRealPath, absoluteEntryPath) || '.'
      };
    });

  return {
    success: true,
    toolName: 'list_workspace',
    relativePath: resolvedRelativePath,
    entries: sortedEntries,
    truncated: entries.length > sortedEntries.length
  };
}

async function readFileTool(args, workspaceRoot) {
  if (typeof args.relativePath !== 'string' || !args.relativePath.trim()) {
    createToolError('read_file requires a relativePath.', 'INVALID_TOOL_ARGS');
  }

  const { relativePath, targetPath } = await resolveWorkspaceTarget(workspaceRoot, args.relativePath.trim());
  const stats = await fsp.stat(targetPath);
  if (!stats.isFile()) {
    createToolError(`${relativePath} is not a file.`, 'WORKSPACE_NOT_FILE');
  }

  const content = await fsp.readFile(targetPath, 'utf8');
  const lines = content.split('\n');
  const startLine = clampInteger(args.startLine, 1, { min: 1, max: lines.length || 1 });
  const endLine = clampInteger(args.endLine, lines.length || 1, { min: startLine, max: lines.length || 1 });
  const slicedContent = lines.slice(startLine - 1, endLine).join('\n');

  return {
    success: true,
    toolName: 'read_file',
    relativePath,
    startLine,
    endLine,
    totalLines: lines.length,
    content: slicedContent
  };
}

async function searchWorkspaceTool(args, workspaceRoot) {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) {
    createToolError('search_workspace requires a query.', 'INVALID_TOOL_ARGS');
  }

  const rootRealPath = await resolveWorkspaceRoot(workspaceRoot);
  const maxResults = clampInteger(args.maxResults, 20, { min: 1, max: 100 });
  const commandArgs = [
    '--line-number',
    '--column',
    '--with-filename',
    '--color',
    'never',
    '--smart-case'
  ];

  if (typeof args.glob === 'string' && args.glob.trim()) {
    commandArgs.push('--glob', args.glob.trim());
  }

  commandArgs.push(query, '.');

  try {
    const { stdout } = await execFileAsync('rg', commandArgs, {
      cwd: rootRealPath,
      maxBuffer: 1024 * 1024 * 4
    });

    const matches = stdout
      .split('\n')
      .filter(Boolean)
      .slice(0, maxResults)
      .map((line) => {
        const match = line.match(/^(.*?):(\d+):(\d+):(.*)$/);
        if (!match) return null;
        return {
          relativePath: match[1],
          line: Number.parseInt(match[2], 10),
          column: Number.parseInt(match[3], 10),
          preview: match[4].trim()
        };
      })
      .filter(Boolean);

    return {
      success: true,
      toolName: 'search_workspace',
      query,
      matches,
      truncated: stdout.split('\n').filter(Boolean).length > matches.length
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        success: false,
        toolName: 'search_workspace',
        error: 'ripgrep (rg) is not installed on this machine, so workspace search is unavailable.'
      };
    }

    if (error.code === 1) {
      return {
        success: true,
        toolName: 'search_workspace',
        query,
        matches: []
      };
    }

    throw error;
  }
}

async function proposeFileWriteTool(args, workspaceRoot) {
  if (typeof args.relativePath !== 'string' || !args.relativePath.trim()) {
    createToolError('propose_file_write requires a relativePath.', 'INVALID_TOOL_ARGS');
  }

  if (typeof args.content !== 'string') {
    createToolError('propose_file_write requires string content.', 'INVALID_TOOL_ARGS');
  }

  const { rootRealPath, targetPath, relativePath } = await resolveWorkspaceTarget(
    workspaceRoot,
    args.relativePath.trim(),
    { allowMissing: true }
  );

  const existing = await fileExists(targetPath);
  const existingContent = existing ? await fsp.readFile(targetPath, 'utf8') : '';
  const changeType = existing ? 'update' : 'create';
  const diffPreview = existing
    ? buildUpdatePreview(existingContent, args.content)
    : buildCreatePreview(args.content);

  const pendingChange = {
    id: crypto.randomUUID(),
    toolCallId: typeof args.toolCallId === 'string' ? args.toolCallId : '',
    workspaceRoot: rootRealPath,
    absolutePath: targetPath,
    relativePath,
    changeType,
    proposedContent: args.content,
    diffPreview,
    status: 'pending'
  };

  pendingAgentChanges.set(pendingChange.id, pendingChange);

  return { pendingChange };
}

async function invokeAgentTool(payload = {}) {
  const toolName = payload.toolName;
  const args = payload.args && typeof payload.args === 'object' ? payload.args : {};
  const workspaceRoot = payload.workspaceRoot;

  try {
    if (toolName === 'list_workspace') {
      return { toolResult: await listWorkspaceTool(args, workspaceRoot) };
    }

    if (toolName === 'read_file') {
      return { toolResult: await readFileTool(args, workspaceRoot) };
    }

    if (toolName === 'search_workspace') {
      return { toolResult: await searchWorkspaceTool(args, workspaceRoot) };
    }

    if (toolName === 'propose_file_write') {
      return await proposeFileWriteTool(args, workspaceRoot);
    }

    return {
      toolResult: {
        success: false,
        toolName,
        error: `Unsupported tool: ${toolName}`
      }
    };
  } catch (error) {
    return {
      toolResult: {
        success: false,
        toolName,
        error: error.message || 'Unknown tool error',
        code: error.code || 'AGENT_TOOL_ERROR'
      }
    };
  }
}

async function resolvePendingAgentChange(payload = {}) {
  const changeId = payload.changeId;
  const decision = payload.decision;
  const pendingChange = pendingAgentChanges.get(changeId);

  if (!pendingChange) {
    return {
      toolResult: {
        success: false,
        toolName: 'propose_file_write',
        error: 'The pending file change could not be found. It may have expired after an app restart.',
        code: 'PENDING_CHANGE_MISSING'
      }
    };
  }

  pendingAgentChanges.delete(changeId);

  if (decision === 'approve') {
    await fsp.mkdir(path.dirname(pendingChange.absolutePath), { recursive: true });
    await fsp.writeFile(pendingChange.absolutePath, pendingChange.proposedContent);

    return {
      toolResult: {
        success: true,
        toolName: 'propose_file_write',
        decision: 'approved',
        relativePath: pendingChange.relativePath,
        changeType: pendingChange.changeType,
        message: `Applied ${pendingChange.changeType} to ${pendingChange.relativePath}.`
      }
    };
  }

  return {
    toolResult: {
      success: true,
      toolName: 'propose_file_write',
      decision: 'rejected',
      relativePath: pendingChange.relativePath,
      changeType: pendingChange.changeType,
      message: `User rejected the proposed ${pendingChange.changeType} for ${pendingChange.relativePath}.`
    }
  };
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
