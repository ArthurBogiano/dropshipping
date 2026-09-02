'use strict';

const { execFileSync, spawnSync } = require('node:child_process');

const files = execFileSync('git', ['ls-files', '-z', '--', '*.js'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || result.stdout);
  }
}

if (failed) {
  process.exit(1);
}

console.log(`Sintaxe validada em ${files.length} arquivo(s) JavaScript.`);
