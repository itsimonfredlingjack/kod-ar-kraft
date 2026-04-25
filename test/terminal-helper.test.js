const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createTerminalOutputBuffer,
  normalizeCommandMetadata
} = require('../terminal-helper');

test('normalizes optional command explanation metadata', () => {
  const metadata = normalizeCommandMetadata({
    reason: '  Check which scripts this project exposes.  ',
    expectedOutcome: '\nSee dev/start scripts if the project can run locally.\n',
    riskSummary: '   '
  });

  assert.deepEqual(metadata, {
    reason: 'Check which scripts this project exposes.',
    expectedOutcome: 'See dev/start scripts if the project can run locally.',
    riskSummary: ''
  });
});

test('terminal output buffer keeps recent output with truncation marker', () => {
  const buffer = createTerminalOutputBuffer(18);

  buffer.append('first line\n');
  buffer.append('second line\n');
  buffer.append('third line\n');

  const snapshot = buffer.snapshot();
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.output, '... output truncated ...\nd line\nthird line\n');
});
