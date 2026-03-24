const { app, BrowserWindow, ipcMain, nativeTheme, dialog, shell, safeStorage, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const pendingAgentChanges = new Map();

function sanitizeShareFilename(input) {
  const trimmed = typeof input === 'string' ? input.trim() : '';
  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized.slice(0, 64) || 'warp-chat-share';
}

async function createShareSnapshot(payload = {}) {
  const html = typeof payload.html === 'string' ? payload.html : '';
  const title = typeof payload.title === 'string' ? payload.title : 'Warp Chat Share';

  if (!html.trim()) {
    return {
      success: false,
      error: 'Share snapshot content was empty.'
    };
  }

  const sharesDirectory = path.join(app.getPath('desktop'), 'Warp-Chat Shares');
  await fsp.mkdir(sharesDirectory, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${sanitizeShareFilename(title)}-${timestamp}.html`;
  const filePath = path.join(sharesDirectory, fileName);
  await fsp.writeFile(filePath, html, 'utf8');

  const openError = await shell.openPath(filePath);

  return {
    success: true,
    fileName,
    filePath,
    directory: sharesDirectory,
    opened: !openError,
    openError: openError || null
  };
}

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

  // Content Security Policy: defense-in-depth against XSS.
  // script-src 'self' — no unsafe-eval, no unsafe-inline. Mermaid is isolated in sandboxed iframes.
  // style-src 'unsafe-inline' is required by KaTeX for computed styles.
  // frame-src blob: allows sandboxed Mermaid iframes using blob: URLs.
  // connect-src is dynamically updated by updateCsp() based on the configured endpoint.
  // At startup, common local origins are pre-allowed so Ollama/local endpoints work immediately.
  const cspAllowedOrigins = new Set([
    'http://127.0.0.1:11434',
    'http://localhost:11434',
    'http://100.72.19.25:11434',
    'http://192.168.86.32:11434'
  ]);

  function buildCsp() {
    const connectSrc = ["'self'", ...cspAllowedOrigins].join(' ');
    return (
      "default-src 'self';" +
      " script-src 'self';" +
      " style-src 'self' 'unsafe-inline';" +
      " font-src 'self';" +
      " img-src 'self' data:;" +
      " frame-src blob:;" +
      ` connect-src ${connectSrc};` +
      " object-src 'none';" +
      " base-uri 'none';" +
      " form-action 'none'"
    );
  }

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [buildCsp()]
      }
    });
  });

  ipcMain.handle('update-csp-endpoint', (event, baseUrl) => {
    try {
      const parsed = new URL(baseUrl);
      cspAllowedOrigins.add(parsed.origin);
    } catch {
      // Invalid URL — no change to CSP
    }
  });

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

  const TREE_IGNORE = new Set([
    'node_modules', '.git', '__pycache__', '.next', '.nuxt', 'dist', 'build',
    '.cache', '.turbo', '.svelte-kit', 'coverage', '.DS_Store', '.venv', 'venv',
    'env', '.env', '.idea', '.vscode', '.output', 'target', 'out'
  ]);

  async function buildWorkspaceTree(rootPath, { maxDepth = 3, maxEntries = 200 } = {}) {
    const lines = [];
    let count = 0;

    async function walk(dirPath, prefix, depth) {
      if (depth > maxDepth || count >= maxEntries) return;

      let entries;
      try {
        entries = await fsp.readdir(dirPath, { withFileTypes: true });
      } catch {
        return;
      }

      entries = entries
        .filter((e) => !TREE_IGNORE.has(e.name) && !e.name.startsWith('.'))
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      for (let i = 0; i < entries.length && count < maxEntries; i++) {
        const entry = entries[i];
        const isLast = i === entries.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const suffix = entry.isDirectory() ? '/' : '';
        lines.push(`${prefix}${connector}${entry.name}${suffix}`);
        count++;

        if (entry.isDirectory() && depth < maxDepth) {
          const childPrefix = prefix + (isLast ? '    ' : '│   ');
          await walk(path.join(dirPath, entry.name), childPrefix, depth + 1);
        }
      }
    }

    const rootName = path.basename(rootPath);
    lines.push(`${rootName}/`);
    count++;
    await walk(rootPath, '', 1);

    if (count >= maxEntries) {
      lines.push(`... (tree truncated at ${maxEntries} entries)`);
    }

    return lines.join('\n');
  }

  ipcMain.handle('get-workspace-tree', async (event, folderPath) => {
    try {
      return await buildWorkspaceTree(folderPath);
    } catch (error) {
      console.error('Failed to build workspace tree:', error);
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

  ipcMain.handle('create-share-snapshot', async (event, payload) => {
    try {
      return await createShareSnapshot(payload);
    } catch (error) {
      console.error('Failed to create share snapshot:', error);
      return {
        success: false,
        error: error.message || 'Failed to create share snapshot.'
      };
    }
  });

  const chatsFilePath = path.join(app.getPath('userData'), 'warp-chats.json');

  ipcMain.handle('save-chats', async (event, chatsData) => {
    try {
      const jsonData = JSON.stringify(chatsData);
      // Atomic write: write to temp file, then rename
      const tmpPath = chatsFilePath + '.tmp';
      await fsp.writeFile(tmpPath, jsonData, 'utf8');
      await fsp.rename(tmpPath, chatsFilePath);
      return true;
    } catch (error) {
      console.error('Failed to save chats:', error);
      // Clean up temp file if rename failed
      try { await fsp.unlink(chatsFilePath + '.tmp'); } catch { /* ignore */ }
      return false;
    }
  });

  ipcMain.handle('load-chats', async () => {
    try {
      if (!fs.existsSync(chatsFilePath)) return [];

      const raw = await fsp.readFile(chatsFilePath, 'utf8');
      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        console.error('Chats file is not an array — treating as empty.');
        return [];
      }

      return parsed;
    } catch (error) {
      console.error('Failed to load chats:', error);

      // Attempt to preserve the corrupted file for manual recovery
      try {
        const backupPath = chatsFilePath + '.corrupted-' + Date.now();
        await fsp.copyFile(chatsFilePath, backupPath);
        console.error(`Corrupted chats file backed up to: ${backupPath}`);
      } catch { /* ignore backup failure */ }

      return [];
    }
  });

  ipcMain.handle('invoke-agent-tool', async (event, payload) => {
    return invokeAgentTool(payload);
  });

  ipcMain.handle('resolve-pending-agent-change', async (event, payload) => {
    return resolvePendingAgentChange(payload);
  });

  // Secure credential storage via OS keychain
  const credentialsFilePath = path.join(app.getPath('userData'), 'warp-credentials.json');

  async function readCredentials() {
    try {
      if (!fs.existsSync(credentialsFilePath)) return {};
      const raw = await fsp.readFile(credentialsFilePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  async function writeCredentials(data) {
    const tmpPath = credentialsFilePath + '.tmp';
    await fsp.writeFile(tmpPath, JSON.stringify(data), 'utf8');
    await fsp.rename(tmpPath, credentialsFilePath);
  }

  ipcMain.handle('get-api-key', async () => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return '';
      const creds = await readCredentials();
      if (!creds.apiKeyEncrypted) return '';
      const encrypted = Buffer.from(creds.apiKeyEncrypted, 'base64');
      return safeStorage.decryptString(encrypted);
    } catch (error) {
      console.error('Failed to read API key from safeStorage:', error);
      return '';
    }
  });

  ipcMain.handle('set-api-key', async (event, apiKey) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn('safeStorage encryption not available — API key will not be persisted securely.');
        return false;
      }
      const creds = await readCredentials();
      if (apiKey) {
        const encrypted = safeStorage.encryptString(apiKey);
        creds.apiKeyEncrypted = encrypted.toString('base64');
      } else {
        delete creds.apiKeyEncrypted;
      }
      await writeCredentials(creds);
      return true;
    } catch (error) {
      console.error('Failed to save API key to safeStorage:', error);
      return false;
    }
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

  // Context lines (up to 3 before and after the changed region)
  const contextBefore = 3;
  const contextAfter = 3;
  const ctxStart = Math.max(0, prefix - contextBefore);
  const ctxEndBefore = Math.min(before.length, before.length - suffix + contextAfter);

  const previewLines = [
    `@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`
  ];

  // Context lines before the change (with line numbers)
  for (let i = ctxStart; i < prefix; i++) {
    const lineNum = String(i + 1).padStart(4, ' ');
    previewLines.push(`${lineNum}  ${before[i]}`);
  }

  // Removed lines
  removed.slice(0, 120).forEach((line, idx) => {
    const lineNum = String(prefix + idx + 1).padStart(4, ' ');
    previewLines.push(`${lineNum} -${line}`);
  });

  // Added lines
  added.slice(0, 120).forEach((line, idx) => {
    const lineNum = String(prefix + idx + 1).padStart(4, ' ');
    previewLines.push(`${lineNum} +${line}`);
  });

  // Context lines after the change
  const afterStart = before.length - suffix;
  const afterEnd = Math.min(before.length, afterStart + contextAfter);
  for (let i = afterStart; i < afterEnd; i++) {
    const lineNum = String(i + 1).padStart(4, ' ');
    previewLines.push(`${lineNum}  ${before[i]}`);
  }

  if (removed.length > 120 || added.length > 120) {
    previewLines.push('... diff preview truncated (showing first 120 lines) ...');
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
    kind: 'file',
    toolName: 'propose_file_write',
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

// Structured safe-command validation.
// Instead of prefix-matching raw strings, we parse the command into argv
// and validate the actual binary + subcommand + flags.

// Pinned binary paths for macOS.
// These are resolved at module load: if the pinned path exists, use it.
// If not (e.g., non-macOS or unusual install), fall back to bare name for PATH lookup.
const PINNED_PATHS = {
  ls: '/bin/ls',
  cat: '/bin/cat',
  head: '/usr/bin/head',
  tail: '/usr/bin/tail',
  wc: '/usr/bin/wc',
  pwd: '/bin/pwd',
  which: '/usr/bin/which',
  file: '/usr/bin/file',
  find: '/usr/bin/find',
  echo: '/bin/echo',
  git: '/usr/bin/git'
  // npm, node, python, pip, cargo: resolved via PATH (install paths vary)
};

const resolvedBinaryPaths = new Map();
for (const [name, pinnedPath] of Object.entries(PINNED_PATHS)) {
  try {
    fs.accessSync(pinnedPath, fs.constants.X_OK);
    resolvedBinaryPaths.set(name, pinnedPath);
  } catch {
    resolvedBinaryPaths.set(name, name); // fall back to PATH lookup
  }
}

function resolveBinary(name) {
  return resolvedBinaryPaths.get(name.toLowerCase()) || name;
}

const SAFE_COMMANDS = new Map([
  // [binary]: { subcommands (null = no subcommand required), forbiddenFlags }
  ['ls',      { subcommands: null, forbiddenFlags: new Set() }],
  ['cat',     { subcommands: null, forbiddenFlags: new Set() }],
  ['head',    { subcommands: null, forbiddenFlags: new Set() }],
  ['tail',    { subcommands: null, forbiddenFlags: new Set() }],
  ['wc',      { subcommands: null, forbiddenFlags: new Set() }],
  ['pwd',     { subcommands: null, forbiddenFlags: new Set() }],
  ['which',   { subcommands: null, forbiddenFlags: new Set() }],
  ['file',    { subcommands: null, forbiddenFlags: new Set() }],
  ['find',    { subcommands: null, forbiddenFlags: new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir']) }],
  ['echo',    { subcommands: null, forbiddenFlags: new Set() }],
  ['git',     { subcommands: new Set(['status', 'diff', 'log', 'branch', 'show', 'rev-parse', 'remote']), forbiddenFlags: new Set() }],
  ['npm',     { subcommands: new Set(['ls', 'outdated', 'list']), forbiddenFlags: new Set() }],
  ['node',    { subcommands: null, forbiddenFlags: new Set(), argsAllowlist: new Set(['--version', '-v', '-e']) }],
  ['python',  { subcommands: null, forbiddenFlags: new Set(), argsAllowlist: new Set(['--version', '-V']) }],
  ['python3', { subcommands: null, forbiddenFlags: new Set(), argsAllowlist: new Set(['--version', '-V']) }],
  ['pip',     { subcommands: new Set(['list', 'show', 'freeze']), forbiddenFlags: new Set() }],
  ['pip3',    { subcommands: new Set(['list', 'show', 'freeze']), forbiddenFlags: new Set() }],
  ['cargo',   { subcommands: new Set(['check', 'test', 'clippy']), forbiddenFlags: new Set() }],
]);

// Characters that indicate shell interpretation beyond simple argv splitting.
// Includes newlines, carriage returns, and all standard shell metacharacters.
const SHELL_METACHAR_PATTERN = /[;&|`$()><\n\r\\!#~{}\[\]*?]/;

function parseSimpleArgv(command) {
  // Split a command string into argv tokens, respecting single/double quotes.
  // Returns null if the command uses shell features that can't be safely parsed.
  const trimmed = command.trim();
  if (!trimmed) return null;

  // Reject any shell metacharacters before attempting to parse
  if (SHELL_METACHAR_PATTERN.test(trimmed)) return null;

  const tokens = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if ((ch === ' ' || ch === '\t') && !inSingle && !inDouble) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) tokens.push(current);
  if (inSingle || inDouble) return null; // Unclosed quotes
  if (tokens.length === 0) return null;

  return tokens;
}

function isCommandSafe(command, workspaceRoot) {
  const argv = parseSimpleArgv(command);
  if (!argv || argv.length === 0) return false;

  const binary = argv[0].toLowerCase();
  const spec = SAFE_COMMANDS.get(binary);
  if (!spec) return false;

  const restArgs = argv.slice(1);

  // Validate subcommand if required
  if (spec.subcommands) {
    const subcommand = restArgs[0]?.toLowerCase();
    if (!subcommand || !spec.subcommands.has(subcommand)) return false;
  }

  // Check for args-only allowlist (e.g., node --version)
  if (spec.argsAllowlist) {
    if (restArgs.length === 0) return false;
    if (!restArgs.every((arg) => spec.argsAllowlist.has(arg))) return false;
  }

  // Check for forbidden flags
  if (spec.forbiddenFlags.size > 0) {
    for (const arg of restArgs) {
      if (spec.forbiddenFlags.has(arg.toLowerCase())) return false;
    }
  }

  // Ensure all path-like arguments stay within the workspace.
  // Reject absolute paths and path traversal attempts.
  if (workspaceRoot) {
    for (const arg of restArgs) {
      if (arg.startsWith('-')) continue; // Skip flags
      if (path.isAbsolute(arg)) return false;
      const resolved = path.resolve(workspaceRoot, arg);
      const relative = path.relative(workspaceRoot, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
    }
  }

  return true;
}

const MAX_COMMAND_OUTPUT = 64 * 1024;

function truncateOutput(text, max = MAX_COMMAND_OUTPUT) {
  if (typeof text !== 'string') return '';
  if (text.length <= max) return text;
  return text.slice(0, max) + '\n... output truncated ...';
}

async function runCommandTool(args, workspaceRoot) {
  const command = typeof args.command === 'string' ? args.command.trim() : '';
  if (!command) {
    createToolError('run_command requires a command.', 'INVALID_TOOL_ARGS');
  }

  const cwdRelative = typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : '.';
  const { rootRealPath, targetPath: cwdPath } = await resolveWorkspaceTarget(workspaceRoot, cwdRelative);

  const cwdStats = await fsp.stat(cwdPath);
  if (!cwdStats.isDirectory()) {
    createToolError(`${cwdRelative} is not a directory.`, 'WORKSPACE_NOT_DIRECTORY');
  }

  if (isCommandSafe(command, rootRealPath)) {
    // Safe commands: execute directly without shell interpretation.
    // parseSimpleArgv already validated and split the command.
    // Binary is resolved to a pinned absolute path where available.
    const argv = parseSimpleArgv(command);
    const binary = resolveBinary(argv[0]);
    const args = argv.slice(1);
    try {
      const { stdout, stderr } = await execFileAsync(binary, args, {
        cwd: cwdPath,
        timeout: 30000,
        maxBuffer: MAX_COMMAND_OUTPUT * 2,
        env: { ...process.env, PATH: process.env.PATH }
      });
      return {
        success: true,
        toolName: 'run_command',
        command,
        executionMode: 'direct',
        exitCode: 0,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr)
      };
    } catch (error) {
      if (error.killed) {
        return {
          success: false,
          toolName: 'run_command',
          command,
          error: 'Command timed out after 30 seconds.',
          stdout: truncateOutput(error.stdout),
          stderr: truncateOutput(error.stderr)
        };
      }
      return {
        success: true,
        toolName: 'run_command',
        command,
        executionMode: 'direct',
        exitCode: error.code ?? 1,
        stdout: truncateOutput(error.stdout),
        stderr: truncateOutput(error.stderr)
      };
    }
  }

  // Reject commands that are too complex to safely approve
  if (command.length > 300) {
    createToolError(
      'Command is too long for approval (max 300 characters). Break it into smaller steps.',
      'COMMAND_TOO_COMPLEX'
    );
  }

  // Determine whether the command can be executed directly or requires shell
  const approvalArgv = parseSimpleArgv(command);
  const approvalExecMode = approvalArgv && approvalArgv.length > 0 ? 'direct' : 'shell';

  const pendingChange = {
    id: crypto.randomUUID(),
    toolCallId: typeof args.toolCallId === 'string' ? args.toolCallId : '',
    kind: 'command',
    toolName: 'run_command',
    workspaceRoot: rootRealPath,
    command,
    cwd: cwdPath,
    executionMode: approvalExecMode,
    status: 'pending'
  };

  pendingAgentChanges.set(pendingChange.id, pendingChange);
  return { pendingChange };
}

async function proposeFileEditTool(args, workspaceRoot) {
  if (typeof args.relativePath !== 'string' || !args.relativePath.trim()) {
    createToolError('propose_file_edit requires a relativePath.', 'INVALID_TOOL_ARGS');
  }
  if (typeof args.oldText !== 'string' || !args.oldText) {
    createToolError('propose_file_edit requires oldText.', 'INVALID_TOOL_ARGS');
  }
  if (typeof args.newText !== 'string') {
    createToolError('propose_file_edit requires newText.', 'INVALID_TOOL_ARGS');
  }

  const { rootRealPath, targetPath, relativePath } = await resolveWorkspaceTarget(
    workspaceRoot,
    args.relativePath.trim()
  );

  const stats = await fsp.stat(targetPath);
  if (!stats.isFile()) {
    createToolError(`${relativePath} is not a file.`, 'WORKSPACE_NOT_FILE');
  }

  const content = await fsp.readFile(targetPath, 'utf8');
  const matchCount = content.split(args.oldText).length - 1;

  if (matchCount === 0) {
    createToolError(
      `oldText not found in ${relativePath}. Re-read the file with read_file and pay attention to exact whitespace and indentation.`,
      'EDIT_NO_MATCH'
    );
  }

  if (matchCount > 1) {
    createToolError(
      `oldText matches ${matchCount} locations in ${relativePath}. Include more surrounding context to make it unique.`,
      'EDIT_AMBIGUOUS'
    );
  }

  const proposedContent = content.replace(args.oldText, args.newText);
  const diffPreview = buildUpdatePreview(content, proposedContent);

  const pendingChange = {
    id: crypto.randomUUID(),
    toolCallId: typeof args.toolCallId === 'string' ? args.toolCallId : '',
    kind: 'file',
    toolName: 'propose_file_edit',
    workspaceRoot: rootRealPath,
    absolutePath: targetPath,
    relativePath,
    changeType: 'edit',
    proposedContent,
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

    if (toolName === 'run_command') {
      const result = await runCommandTool(args, workspaceRoot);
      if (result.pendingChange) return result;
      return { toolResult: result };
    }

    if (toolName === 'propose_file_edit') {
      return await proposeFileEditTool(args, workspaceRoot);
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
        toolName: pendingChange?.toolName || 'propose_file_write',
        error: 'The pending file change could not be found. It may have expired after an app restart.',
        code: 'PENDING_CHANGE_MISSING'
      }
    };
  }

  if (decision === 'approve') {
    if (pendingChange.kind === 'command') {
      // Attempt direct execution (no shell) if the command can be parsed into argv.
      // Fall back to shell only for commands with shell-specific syntax (pipes, etc.).
      const argv = parseSimpleArgv(pendingChange.command);
      const useDirectExec = argv && argv.length > 0;
      const execArgs = useDirectExec
        ? [resolveBinary(argv[0]), argv.slice(1)]
        : ['/bin/sh', ['-c', pendingChange.command]];
      const executionMode = useDirectExec ? 'direct' : 'shell';

      try {
        const { stdout, stderr } = await execFileAsync(execArgs[0], execArgs[1], {
          cwd: pendingChange.cwd,
          timeout: 30000,
          maxBuffer: MAX_COMMAND_OUTPUT * 2,
          env: { ...process.env, PATH: process.env.PATH }
        });
        pendingAgentChanges.delete(changeId);
        return {
          toolResult: {
            success: true,
            toolName: pendingChange.toolName || 'run_command',
            decision: 'approved',
            executionMode,
            command: pendingChange.command,
            exitCode: 0,
            stdout: truncateOutput(stdout),
            stderr: truncateOutput(stderr),
            message: `Executed (${executionMode}): ${pendingChange.command}`
          }
        };
      } catch (error) {
        pendingAgentChanges.delete(changeId);
        return {
          toolResult: {
            success: true,
            toolName: pendingChange.toolName || 'run_command',
            decision: 'approved',
            executionMode,
            command: pendingChange.command,
            exitCode: error.code ?? 1,
            stdout: truncateOutput(error.stdout),
            stderr: truncateOutput(error.stderr),
            message: `Command exited with code ${error.code ?? 1} (${executionMode}).`
          }
        };
      }
    }

    // File write/edit
    try {
      await fsp.mkdir(path.dirname(pendingChange.absolutePath), { recursive: true });
      await fsp.writeFile(pendingChange.absolutePath, pendingChange.proposedContent);
      pendingAgentChanges.delete(changeId);
    } catch (error) {
      return {
        toolResult: {
          success: false,
          toolName: pendingChange.toolName || 'propose_file_write',
          decision: 'approve',
          relativePath: pendingChange.relativePath,
          changeType: pendingChange.changeType,
          error: error.message || `Failed to apply ${pendingChange.relativePath}.`,
          code: 'LOCAL_APPLY_FAILED'
        }
      };
    }

    return {
      toolResult: {
        success: true,
        toolName: pendingChange.toolName || 'propose_file_write',
        decision: 'approved',
        relativePath: pendingChange.relativePath,
        changeType: pendingChange.changeType,
        message: `Applied ${pendingChange.changeType} to ${pendingChange.relativePath}.`
      }
    };
  }

  const rejectResult = {
    success: true,
    toolName: pendingChange.toolName || 'propose_file_write',
    decision: 'rejected'
  };
  pendingAgentChanges.delete(changeId);

  if (pendingChange.kind === 'command') {
    rejectResult.command = pendingChange.command;
    rejectResult.message = `User rejected the command: ${pendingChange.command}`;
  } else {
    rejectResult.relativePath = pendingChange.relativePath;
    rejectResult.changeType = pendingChange.changeType;
    rejectResult.message = `User rejected the proposed ${pendingChange.changeType} for ${pendingChange.relativePath}.`;
  }

  return { toolResult: rejectResult };
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
