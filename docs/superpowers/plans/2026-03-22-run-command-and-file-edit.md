# run_command and propose_file_edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `run_command` (shell execution with allowlist auto-approve) and `propose_file_edit` (targeted find-and-replace) tools to Warp-Chat's workspace agent.

**Architecture:** Two new tool handlers in main.js, two new tool schemas in renderer.js AGENT_TOOLS[], and updates to the existing approval flow to support both file and command pending change types via a `kind` discriminant field. No new IPC channels — everything routes through the existing `invokeAgentTool` and `resolvePendingAgentChange` bridge.

**Tech Stack:** Vanilla JS, Electron IPC, Node.js child_process

**Spec:** `docs/superpowers/specs/2026-03-22-run-command-and-file-edit-design.md`

---

### Task 1: Add `kind` and `toolName` to existing `proposeFileWriteTool` pending change

**Files:**
- Modify: `main.js:464-474` (proposeFileWriteTool pending change object)
- Modify: `main.js:531` (resolvePendingAgentChange error fallback toolName)
- Modify: `main.js:547` (resolvePendingAgentChange approved toolName)
- Modify: `main.js:559` (resolvePendingAgentChange rejected toolName)

This is the backward-compatibility step — add the new fields to the existing tool before adding new tools, so nothing breaks.

- [ ] **Step 1: Add `kind` and `toolName` to proposeFileWriteTool**

In `main.js`, find the `pendingChange` object in `proposeFileWriteTool` (line 464) and add two fields:

```javascript
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
```

- [ ] **Step 2: Use `pendingChange.toolName` in resolvePendingAgentChange**

Replace all three hardcoded `'propose_file_write'` strings in `resolvePendingAgentChange` with `pendingChange.toolName || 'propose_file_write'`:

Line 531 (error case):
```javascript
        toolName: pendingChange?.toolName || 'propose_file_write',
```

Wait — in the error case, `pendingChange` is null. Keep the fallback for the missing-change error. For the approve/reject cases (lines 547, 559), use the pending change's toolName:
```javascript
        toolName: pendingChange.toolName || 'propose_file_write',
```

- [ ] **Step 3: Verify existing file write flow still works**

Run `npm start`, enable agent tools, select a workspace, ask the agent to create a new file. Confirm the approval card appears and approve/reject works as before.

- [ ] **Step 4: Commit**

```bash
git add main.js
git commit -m "refactor: add kind and toolName fields to pending change objects"
```

---

### Task 2: Implement `runCommandTool` in main.js

**Files:**
- Modify: `main.js` — add constants and function before `invokeAgentTool`
- Modify: `main.js:481-501` — add case in `invokeAgentTool` router

- [ ] **Step 1: Add structured command validation and execution helpers**

Add above `invokeAgentTool` (before line 481):

```javascript
const SAFE_COMMANDS = new Map([
  ['find', { subcommands: null, forbiddenFlags: new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir']) }],
  ['git', { subcommands: new Set(['status', 'diff', 'log', 'branch', 'show', 'rev-parse', 'remote']), forbiddenFlags: new Set() }],
  ['npm', { subcommands: new Set(['ls', 'outdated', 'list']), forbiddenFlags: new Set() }],
  // ... other allowlisted read-only commands
]);

const SHELL_METACHAR_PATTERN = /[;&|`$()><\n\r\\!#~{}\[\]*?]/;

function isCommandSafe(command, workspaceRoot) {
  const argv = parseSimpleArgv(command);
  if (!argv || argv.length === 0) return false;

  const binary = argv[0].toLowerCase();
  const spec = SAFE_COMMANDS.get(binary);
  if (!spec) return false;

  // Validate subcommands, args-only allowlists, and forbidden flags.
  // Reject absolute paths and path traversal outside workspaceRoot.
  return true;
}

function getCommandExecutionSpec(command) {
  const argv = parseSimpleArgv(command);
  if (argv && argv.length > 0) {
    return { executionMode: 'direct', file: resolveBinary(argv[0]), args: argv.slice(1) };
  }
  return { executionMode: 'shell', file: '/bin/sh', args: ['-c', command] };
}
```

- [ ] **Step 2: Add streamed command execution and `runCommandTool`**

Add after `getCommandExecutionSpec`:

```javascript
const MAX_COMMAND_OUTPUT = 64 * 1024;
const COMMAND_TIMEOUT_MS = 30_000;

function createOutputCollector(limit = MAX_COMMAND_OUTPUT) {
  // Collect up to `limit` bytes, then keep discarding while marking truncation.
}

async function executeCommand({ file, args = [], cwd }) {
  // Use spawn() so large stdout/stderr do not fail before truncation can happen.
  // Stream stdout/stderr into collectors, enforce the timeout, and return exitCode.
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
    const execution = getCommandExecutionSpec(command);
    const result = await executeCommand({
      file: execution.file,
      args: execution.args,
      cwd: cwdPath
    });
    return {
      ...result,
      toolName: 'run_command',
      command,
      executionMode: execution.executionMode
    };
  }

  // Unsafe command — require approval
  const approvalExecution = getCommandExecutionSpec(command);
  const pendingChange = {
    id: crypto.randomUUID(),
    toolCallId: typeof args.toolCallId === 'string' ? args.toolCallId : '',
    kind: 'command',
    toolName: 'run_command',
    workspaceRoot: rootRealPath,
    command,
    cwd: cwdPath,
    executionMode: approvalExecution.executionMode,
    status: 'pending'
  };

  pendingAgentChanges.set(pendingChange.id, pendingChange);
  return { pendingChange };
}
```

- [ ] **Step 3: Add router case in `invokeAgentTool`**

In `invokeAgentTool`, add before the `propose_file_write` case:

```javascript
    if (toolName === 'run_command') {
      const result = await runCommandTool(args, workspaceRoot);
      if (result.pendingChange) return result;
      return { toolResult: result };
    }
```

- [ ] **Step 4: Branch `resolvePendingAgentChange` on `kind`**

Replace the approve block (lines 540-553) with:

```javascript
  if (decision === 'approve') {
    if (pendingChange.kind === 'command') {
      const execution = getCommandExecutionSpec(pendingChange.command);
      const result = await executeCommand({
        file: execution.file,
        args: execution.args,
        cwd: pendingChange.cwd
      });
      pendingAgentChanges.delete(changeId);
      return {
        toolResult: {
          ...result,
          toolName: pendingChange.toolName || 'run_command',
          decision: 'approved',
          executionMode: execution.executionMode,
          command: pendingChange.command,
          message: result.success
            ? `Executed (${execution.executionMode}): ${pendingChange.command}`
            : result.error || `Command exited with code ${result.exitCode ?? 1} (${execution.executionMode}).`
        }
      };
    }

    // File write/edit
    await fsp.mkdir(path.dirname(pendingChange.absolutePath), { recursive: true });
    await fsp.writeFile(pendingChange.absolutePath, pendingChange.proposedContent);

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
```

And update the reject block to use dynamic toolName and kind-aware fields:

```javascript
  const rejectResult = {
    success: true,
    toolName: pendingChange.toolName || 'propose_file_write',
    decision: 'rejected'
  };

  if (pendingChange.kind === 'command') {
    rejectResult.command = pendingChange.command;
    rejectResult.message = `User rejected the command: ${pendingChange.command}`;
  } else {
    rejectResult.relativePath = pendingChange.relativePath;
    rejectResult.changeType = pendingChange.changeType;
    rejectResult.message = `User rejected the proposed ${pendingChange.changeType} for ${pendingChange.relativePath}.`;
  }

  return { toolResult: rejectResult };
```

- [ ] **Step 5: Syntax check**

```bash
node --check main.js
```

- [ ] **Step 6: Commit**

```bash
git add main.js
git commit -m "feat: add run_command tool with allowlist auto-approve in main.js"
```

---

### Task 3: Implement `proposeFileEditTool` in main.js

**Files:**
- Modify: `main.js` — add function before `invokeAgentTool`
- Modify: `main.js` — add case in `invokeAgentTool` router

- [ ] **Step 1: Add `proposeFileEditTool` function**

Add after `runCommandTool`:

```javascript
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
```

- [ ] **Step 2: Add router case in `invokeAgentTool`**

Add after the `run_command` case:

```javascript
    if (toolName === 'propose_file_edit') {
      return await proposeFileEditTool(args, workspaceRoot);
    }
```

- [ ] **Step 3: Syntax check**

```bash
node --check main.js
```

- [ ] **Step 4: Commit**

```bash
git add main.js
git commit -m "feat: add propose_file_edit tool with find-and-replace in main.js"
```

---

### Task 4: Add tool schemas and update system prompt in renderer.js

**Files:**
- Modify: `renderer.js:62-155` — add to AGENT_TOOLS[]
- Modify: `renderer.js:1160-1180` — update buildSystemMessages

- [ ] **Step 1: Add tool schemas to AGENT_TOOLS[]**

After the `propose_file_write` entry (after line 153), add:

```javascript
  {
    type: "function",
    function: {
      name: "propose_file_edit",
      description: "Edit an existing file by replacing an exact text match. The oldText must appear exactly once in the file. Use read_file first to see the current content.",
      parameters: {
        type: "object",
        properties: {
          relativePath: {
            type: "string",
            description: "File path relative to the selected workspace root."
          },
          oldText: {
            type: "string",
            description: "The exact text to find and replace. Must match exactly once."
          },
          newText: {
            type: "string",
            description: "The replacement text."
          }
        },
        required: ["relativePath", "oldText", "newText"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command in the workspace. Safe read-only commands run immediately. Commands that modify state require user approval.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute."
          },
          cwd: {
            type: "string",
            description: "Working directory relative to workspace root. Defaults to ."
          }
        },
        required: ["command"]
      }
    }
  }
```

- [ ] **Step 2: Update agent system prompt in `buildSystemMessages`**

Find the agent mode system message (around line 1168) and replace the content array with:

```javascript
    messages.push({
      role: "system",
      content: [
        `You are operating as a workspace-scoped coding agent inside the workspace root: ${state.currentFolderPath}.`,
        "All tool paths must be relative to this workspace root.",
        "Use tools to inspect the project before proposing edits when relevant.",
        "Prefer propose_file_edit for modifying existing files — it does a targeted find-and-replace.",
        "Use propose_file_write only for creating new files or complete rewrites.",
        "Use run_command to verify changes, run tests, check output, or inspect git state.",
        "Safe read-only commands run automatically; commands that modify state require user approval.",
        "Never propose more than one file change or unsafe command at a time.",
        "File writes and edits require explicit user approval before they are applied.",
        "If the backend does not support native tool_calls in responses, emit exactly one JSON object with keys name and arguments, and no surrounding prose."
      ].join(" ")
    });
```

- [ ] **Step 3: Syntax check**

```bash
node --check renderer.js
```

- [ ] **Step 4: Commit**

```bash
git add renderer.js
git commit -m "feat: add propose_file_edit and run_command tool schemas and system prompt"
```

---

### Task 5: Update renderer.js approval flow and transcript

**Files:**
- Modify: `renderer.js` — `createApprovalBlock` (~line 1039)
- Modify: `renderer.js` — `resolvePendingChange` (~line 2020)
- Modify: `renderer.js` — `createToolTranscriptSummary` (~line 1880)
- Modify: `renderer.js` — `executeToolCalls` multi-propose guard (~line 1930)
- Modify: `renderer.js` — `exportChat` (~line 1851)

- [ ] **Step 1: Update `createApprovalBlock` for command cards**

In `createApprovalBlock`, update the role and model textContent to handle commands:

Change the role line:
```javascript
  role.textContent = item.kind === "command" ? "Pending Command" : "Pending Change";
```

Change the model line:
```javascript
  model.textContent = item.kind === "command"
    ? "run_command"
    : `${item.changeType} · ${item.relativePath}`;
```

Change the lead text:
```javascript
  lead.textContent = item.kind === "command"
    ? `The model wants to run a command in ${item.cwd || "the workspace"}.`
    : item.status === "pending"
      ? `The model proposed a ${item.changeType} for ${item.relativePath}. Review the diff below before continuing.`
      : `The proposed ${item.changeType} for ${item.relativePath} was ${item.status}.`;
```

Replace the diff shell section to handle both types:
```javascript
  if (item.kind === "command") {
    const cmdShell = document.createElement("div");
    cmdShell.className = "approval-diff-shell";

    const cmdTitle = document.createElement("div");
    cmdTitle.className = "approval-diff-title";
    cmdTitle.textContent = "Command";

    const cmdPre = document.createElement("pre");
    cmdPre.className = "approval-diff approval-command";
    cmdPre.textContent = item.command || "";

    const cwdLabel = document.createElement("div");
    cwdLabel.className = "approval-diff-title";
    cwdLabel.textContent = `cwd: ${item.cwd || "."}`;

    cmdShell.append(cmdTitle, cmdPre, cwdLabel);
    body.append(lead, cmdShell);
  } else {
    const diffShell = document.createElement("div");
    diffShell.className = "approval-diff-shell";

    const diffTitle = document.createElement("div");
    diffTitle.className = "approval-diff-title";
    diffTitle.textContent = "Diff Preview";

    const diffPre = document.createElement("pre");
    diffPre.className = "approval-diff";
    diffPre.textContent = item.diffPreview || "@@ no preview available @@";

    diffShell.append(diffTitle, diffPre);
    body.append(lead, diffShell);
  }
```

- [ ] **Step 2: Update `resolvePendingChange` to use dynamic toolName**

In `resolvePendingChange`, replace the three hardcoded `"propose_file_write"` references:

The fallback toolResult (around line 2024):
```javascript
    const toolResult = response?.toolResult || {
      success: false,
      toolName: pendingChange.toolName || "propose_file_write",
      error: "The approval flow returned no result."
    };
```

The addTranscriptItem subtitle (around line 2030):
```javascript
      subtitle: pendingChange.toolName || "propose_file_write",
```

The pushToolResultToApiHistory function name (around line 2038):
```javascript
    pushToolResultToApiHistory({
      id: pendingChange.toolCallId,
      transport: pendingChange.transport || "native",
      function: { name: pendingChange.toolName || "propose_file_write" }
    }, toolResult);
```

- [ ] **Step 3: Update `createToolTranscriptSummary`**

Add cases for the new tools before the final return:

```javascript
  if (toolName === "propose_file_edit") {
    if (result.decision === "approved") {
      return `Applied the approved edit for \`${result.relativePath}\`.`;
    }
    if (result.decision === "rejected") {
      return `Rejected the proposed edit for \`${result.relativePath}\`.`;
    }
  }

  if (toolName === "run_command") {
    const cmdSnippet = (args?.command || result?.command || "").slice(0, 60);
    if (result.decision === "approved") {
      return `Ran approved command: \`${cmdSnippet}\`. Exit code ${result.exitCode ?? 0}.`;
    }
    if (result.decision === "rejected") {
      return `User rejected command: \`${cmdSnippet}\`.`;
    }
    return `Ran \`${cmdSnippet}\`. Exit code ${result.exitCode ?? 0}.`;
  }
```

- [ ] **Step 4: Extend multi-propose guard in `executeToolCalls`**

Find the existing guard (around line 1932):
```javascript
  const proposeWriteCalls = toolCalls.filter((toolCall) => toolCall.function?.name === "propose_file_write");
```

Change to cover both proposal tools:
```javascript
  const proposalToolNames = new Set(["propose_file_write", "propose_file_edit"]);
  const proposalCalls = toolCalls.filter((toolCall) => proposalToolNames.has(toolCall.function?.name));
  if (proposalCalls.length > 1) {
```

And update the error message and the rest of the guard to use `proposalCalls` instead of `proposeWriteCalls`.

- [ ] **Step 5: Update `exportChat` for command approval items**

Replace the approval export line (around line 1851):
```javascript
    if (item.type === "approval") {
      if (item.kind === "command") {
        markdownContent += `### PENDING COMMAND\n\`${item.command}\`\n\n---\n\n`;
      } else {
        markdownContent += `### PENDING CHANGE\n${item.relativePath} (${item.changeType})\n\n\`\`\`diff\n${item.diffPreview || ""}\n\`\`\`\n\n---\n\n`;
      }
    }
```

- [ ] **Step 6: Update `executeToolCalls` pending-change transcript summary for commands**

In `executeToolCalls`, find the block where `result.pendingChange` is handled (around line 2050). The summary and details are hardcoded for file changes. Make them kind-aware:

```javascript
      const isCommand = result.pendingChange.kind === "command";
      updateTranscriptItem(transcriptItem.id, {
        title: "Tool Result",
        subtitle: toolName,
        status: "result",
        summary: isCommand
          ? `Wants to run \`${result.pendingChange.command}\`. Waiting for approval.`
          : `Prepared a ${result.pendingChange.changeType} for \`${result.pendingChange.relativePath}\`. Waiting for approval.`,
        details: isCommand
          ? prettyJson({ command: result.pendingChange.command, cwd: result.pendingChange.cwd })
          : prettyJson({ relativePath: result.pendingChange.relativePath, changeType: result.pendingChange.changeType })
      });
```

- [ ] **Step 7: Update `loadSession` expired pending change handler**

In `loadSession`, find the expired-change block (around line 1536). Update the three hardcoded `"propose_file_write"` references and make the summary kind-aware:

```javascript
  if (state.pendingAgentChange) {
    const expiredChange = state.pendingAgentChange;
    state.pendingAgentChange = null;
    updateTranscriptItem(expiredChange.id, { status: "expired" });
    const isCommand = expiredChange.kind === "command";
    addTranscriptItem("approval-result", {
      title: "Tool Result",
      subtitle: expiredChange.toolName || "propose_file_write",
      status: "result",
      variant: "error",
      summary: isCommand
        ? "This command approval expired when the app restarted."
        : "This file change proposal expired when the app restarted. The agent will need to propose it again.",
      details: isCommand
        ? prettyJson({ command: expiredChange.command, reason: "expired_after_restart" })
        : prettyJson({ relativePath: expiredChange.relativePath, changeType: expiredChange.changeType, reason: "expired_after_restart" })
    });
    pushToolResultToApiHistory({
      id: expiredChange.toolCallId,
      transport: expiredChange.transport || "native",
      function: { name: expiredChange.toolName || "propose_file_write" }
    }, {
      success: false,
      toolName: expiredChange.toolName || "propose_file_write",
      error: isCommand
        ? "This command approval expired after an app restart."
        : "This file change proposal expired after an app restart.",
      code: "PENDING_CHANGE_EXPIRED"
    });
  }
```

- [ ] **Step 8: Syntax check**

```bash
node --check renderer.js
```

- [ ] **Step 9: Commit**

```bash
git add renderer.js
git commit -m "feat: update approval flow, transcript, and export for new tools"
```

---

### Task 6: Add CSS for command approval cards

**Files:**
- Modify: `style.css` — add after `.approval-diff` rules

- [ ] **Step 1: Add command card style**

Add after the `.approval-diff` rules (around line 595):

```css
.approval-command {
  color: var(--accent-color);
  font-family: var(--font-mono);
  font-size: 0.88rem;
  white-space: pre-wrap;
  word-break: break-all;
}
```

- [ ] **Step 2: Commit**

```bash
git add style.css
git commit -m "feat: add approval-command CSS for run_command cards"
```

---

### Task 7: Integration test

- [ ] **Step 1: Start the app**

```bash
npm start
```

- [ ] **Step 2: Test safe command (auto-approve)**

Enable agent tools, select a workspace, ask: "Run `ls -la` in this workspace"

Expected: command runs immediately, output shown in tool result. No approval card.

- [ ] **Step 3: Test unsafe command (requires approval)**

Ask: "Run `npm install`"

Expected: approval card appears showing the command. Click Approve → command runs, output shown. Agent loop resumes.

- [ ] **Step 4: Test command rejection**

Ask: "Run `rm -rf node_modules`"

Expected: approval card appears. Click Reject → agent told the user declined.

- [ ] **Step 5: Test file edit**

Ask: "In package.json, change the version from 1.0.0 to 1.0.1"

Expected: agent calls `read_file` first, then `propose_file_edit` with the old/new text. Approval card shows a focused diff. Click Approve → edit applied.

- [ ] **Step 6: Test shell metacharacter blocking**

Ask: "Run `ls && echo pwned`"

Expected: approval card appears (not auto-approved despite starting with `ls`).

- [ ] **Step 7: Test edit with no match**

Ask the agent to edit text that doesn't exist in a file.

Expected: tool returns an error message telling the agent to re-read the file.

- [ ] **Step 8: Commit final state**

```bash
git add -A
git commit -m "feat: add run_command and propose_file_edit agent tools"
```
