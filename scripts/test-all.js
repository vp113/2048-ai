'use strict';

/*
 * Run the terminal unit tests, then the default headless browser smoke test.
 * No visible browser is opened by this entry point.
 *
 *   node scripts/test-all.js
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

function run(args) {
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    windowsHide: true,
  });
  return result.status === null ? 1 : result.status;
}

const unit = run([path.join(__dirname, '..', 'test.js')]);
if (unit !== 0) {
  console.error('Unit tests failed; skipping browser test.');
  process.exit(unit);
}

const browser = run([path.join(__dirname, 'browser-test.js')]);
process.exit(browser);
