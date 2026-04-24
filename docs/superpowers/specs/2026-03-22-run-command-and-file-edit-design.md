# Design: `run_command` and `propose_file_edit` agent tools

## Context

Warp-Chat's workspace agent can read and search files, and propose new file writes with approval. But it can't run commands (to test changes, check git status, etc.) or make targeted edits to existing files (it must rewrite entire files). These two tools turn it into a real coding agent.

## Tool 1: `run_command`

### Schema

```javascript
{
  name: "run_command",
  description: "Run a shell command in the workspace. Safe read-only commands run immediately. Commands that modify state require user approval.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to execute." },
      cwd: { type: "string", description: "Working directory relative to workspace root. Defaults to ." }
    },
    required: ["command"]
  }
}
```

### Behavior

- **Safe commands** (auto-approved): Parse the command into argv with `parseSimpleArgv()`, reject shell metacharacters, allow only binaries/subcommands from `SAFE_COMMANDS`, and reject forbidden flags such as `find -delete`.
- **Path validation**: For safe commands, reject absolute paths and any relative path argument that resolves outside the workspace root.
- **Unsafe commands**: Everything else requires user approval via the pending change card.
- **Execution**: Safe commands execute directly via `spawn(binary, argv, { cwd })`. Approved complex commands fall back to `spawn('/bin/sh', ['-c', command], { cwd })`.
- **Limits**: 30s timeout. stdout and stderr are streamed, each retaining at most the first 64KB plus a truncation marker when additional output is discarded.
- **Returns**: `{ stdout, stderr, exitCode }` on success.

### Security

- `cwd` validated via existing `resolveWorkspaceTarget` + `ensurePathInsideRoot`.
- Unsafe commands go through `pendingAgentChanges` Map and approval card.
- Safety is enforced per parsed argv, not by raw string prefix matching, so destructive `find` flags and paths outside the workspace are blocked from auto-approval.

## Tool 2: `propose_file_edit`

### Schema

```javascript
{
  name: "propose_file_edit",
  description: "Edit an existing file by replacing an exact text match. The oldText must appear exactly once in the file. Use read_file first to see the current content.",
  parameters: {
    type: "object",
    properties: {
      relativePath: { type: "string", description: "File path relative to workspace root." },
      oldText: { type: "string", description: "The exact text to find and replace. Must match exactly once." },
      newText: { type: "string", description: "The replacement text." }
    },
    required: ["relativePath", "oldText", "newText"]
  }
}
```

### Behavior

1. Read file via `resolveWorkspaceTarget`.
2. Count occurrences using plain string matching (`content.split(oldText).length - 1`), NOT regex:
   - **0 matches** → error: `"oldText not found in {relativePath}. Re-read the file with read_file and pay attention to exact whitespace and indentation."`
   - **2+ matches** → error: `"oldText matches {N} locations in {relativePath}. Include more surrounding context to make it unique."`
   - **1 match** → compute new content via `content.replace(oldText, newText)`, generate focused diff, create pending change.
3. Diff preview shows only the changed region with surrounding context.
4. `changeType` is `"edit"` (distinct from `propose_file_write`'s `"create"` / `"update"`).
5. Approval flow identical to `propose_file_write`.

### Security

- Same path validation as all workspace tools.
- Never writes directly — always goes through approval card.

## Pending change object shapes

### File changes (write and edit)

```javascript
{
  id: crypto.randomUUID(),
  toolCallId: "call_xxx",
  kind: "file",                    // discriminant field
  toolName: "propose_file_write",  // or "propose_file_edit"
  workspaceRoot: "/abs/path",
  absolutePath: "/abs/path/to/file",
  relativePath: "path/to/file",
  changeType: "create" | "update" | "edit",
  proposedContent: "full file content after change",
  diffPreview: "...",
  status: "pending"
}
```

### Command execution

```javascript
{
  id: crypto.randomUUID(),
  toolCallId: "call_xxx",
  kind: "command",                 // discriminant field
  toolName: "run_command",
  workspaceRoot: "/abs/path",
  command: "npm install express",
  cwd: "/abs/path/to/subdir",
  status: "pending"
}
```

## Changes to `resolvePendingAgentChange` in main.js

The existing function is hardwired to write files. Must branch on `pendingChange.kind`:

```javascript
if (pendingChange.kind === "command") {
  // const execution = getCommandExecutionSpec(pendingChange.command)
  // const result = await executeCommand({ file: execution.file, args: execution.args, cwd })
  // return { toolResult: { stdout, stderr, exitCode } }
} else {
  // existing file write logic
}
```

## Changes to `resolvePendingChange` in renderer.js

The existing function hardcodes `"propose_file_write"` in three places:
- The fallback `toolResult` object
- The `addTranscriptItem("approval-result", ...)` subtitle
- The `pushToolResultToApiHistory(...)` function name

All three must use `pendingChange.toolName` instead of the hardcoded string.

## Changes to `executeToolCalls` one-at-a-time guard

The existing guard at the top of `executeToolCalls` only checks for `propose_file_write`. Must widen to check all three approval-generating tools:

```javascript
const approvalTools = new Set(["propose_file_write", "propose_file_edit", "run_command"]);
```

Note: for `run_command`, only unsafe commands generate pending changes. But the guard runs before execution, so it should check the tool name conservatively. The agent loop will still proceed if the command turns out to be safe (returns `toolResult` not `pendingChange`).

Actually, the simpler approach: only check for `state.pendingAgentChange` being set (which is already checked at line 1770). The multi-propose guard specifically handles multiple `propose_file_write` calls — extend it to cover `propose_file_edit` too. Safe `run_command` calls won't produce pending changes, so they don't need guarding.

## File changes

### `main.js` (~170 lines added)

- `SAFE_COMMANDS` allowlist plus `parseSimpleArgv()` / `isCommandSafe(command, workspaceRoot)`
- `getCommandExecutionSpec()` and `executeCommand()` helpers for direct-vs-shell execution and streamed output capture
- `runCommandTool(args, workspaceRoot)` function
- `proposeFileEditTool(args, workspaceRoot)` function
- Two new cases in `invokeAgentTool` router
- `resolvePendingAgentChange` branched on `pendingChange.kind`
- Add `kind: "file"` and `toolName` to existing `proposeFileWriteTool` pending change

Reuses: `resolveWorkspaceTarget`, `ensurePathInsideRoot`, `pendingAgentChanges`, `buildUpdatePreview`, `createToolError`, `clampInteger`.

### `renderer.js` (~60 lines changed/added)

- Two new entries in `AGENT_TOOLS[]`
- `createToolTranscriptSummary` — add cases: `run_command` → `"Ran \`{command}\`"`, `propose_file_edit` → mirror file write pattern with `"edit"` type
- `buildSystemMessages` — update agent prompt (prefer edit over write, mention run_command)
- `createApprovalBlock` — render command approvals (show command in monospace instead of diff)
- `resolvePendingChange` — use `pendingChange.toolName` instead of hardcoded `"propose_file_write"`
- `executeToolCalls` multi-propose guard — extend to cover `propose_file_edit`
- `exportChat` — handle command-type approval items (show command instead of diff)

### `style.css` (~10 lines added)

- `.approval-command` style for command preview in approval cards (monospace, subtle background)

### `preload.js`

No changes.

## Approval card rendering

### File edit card
- Title: "Pending Change"
- Subtitle: `edit · {relativePath}`
- Body: focused diff preview (same as file write)
- Buttons: Approve / Reject

### Command card
- Title: "Pending Command"
- Subtitle: `run_command`
- Body: command in monospace pre block, cwd shown below
- Buttons: Approve / Reject

## System prompt updates

Add to agent mode system message:
- Prefer `propose_file_edit` for modifying existing files — it does a targeted find-and-replace.
- Use `propose_file_write` only for creating new files or complete rewrites.
- Use `run_command` to verify changes (run tests, check output, inspect git state).
- Safe read-only commands run automatically; commands that modify state require user approval.
- Never propose more than one file change or unsafe command at a time.
