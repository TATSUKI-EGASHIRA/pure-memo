const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { CodexClient, PROFILE } = require('./codex.cjs');

async function main() {
  const blocked = mkdtempSync(path.join(os.tmpdir(), 'pure-blocked-'));
  const client = new CodexClient();
  const allowed = client.directory;
  const allowedText = 'PURE_ALLOWED_SYNTHETIC_FILE';
  const blockedText = 'PURE_BLOCKED_SYNTHETIC_CANARY';
  const allowedFile = path.join(allowed, 'allowed.txt');
  const blockedFile = path.join(blocked, 'blocked.txt');
  writeFileSync(allowedFile, allowedText);
  writeFileSync(blockedFile, blockedText);

  try {
    await client.start();
    const exec = file => client.request('command/exec', {
      command: ['/bin/cat', file],
      cwd: allowed,
      permissionProfile: PROFILE,
      timeoutMs: 10000
    }, 15000);
    const permitted = await exec(allowedFile);
    assert.equal(permitted.exitCode, 0, `Allowed read failed: ${permitted.stderr}`);
    assert.equal(permitted.stdout.trim(), allowedText);

    const denied = await exec(blockedFile);
    assert.notEqual(denied.exitCode, 0, 'A file outside readableRoots was readable.');
    assert.ok(!denied.stdout.includes(blockedText), 'Synthetic canary appeared in stdout.');
    console.log('PASS: allowed synthetic file is readable; outside synthetic file is denied.');
  } finally {
    client.stop();
    rmSync(blocked, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
