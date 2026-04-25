const TERMINAL_OUTPUT_TRUNCATED_MARKER = '... output truncated ...\n';

function normalizeCommandMetadata(args = {}) {
  return {
    reason: typeof args.reason === 'string' ? args.reason.trim() : '',
    expectedOutcome: typeof args.expectedOutcome === 'string' ? args.expectedOutcome.trim() : '',
    riskSummary: typeof args.riskSummary === 'string' ? args.riskSummary.trim() : ''
  };
}

function createTerminalOutputBuffer(limit = 16 * 1024) {
  let output = '';
  let truncated = false;

  return {
    append(chunk) {
      if (chunk == null) return;

      output += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);

      if (output.length > limit) {
        output = output.slice(output.length - limit);
        truncated = true;
      }
    },
    snapshot() {
      return {
        output: truncated ? TERMINAL_OUTPUT_TRUNCATED_MARKER + output : output,
        truncated
      };
    }
  };
}

module.exports = {
  TERMINAL_OUTPUT_TRUNCATED_MARKER,
  createTerminalOutputBuffer,
  normalizeCommandMetadata
};
