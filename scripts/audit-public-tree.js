'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const forbiddenFiles = [
  /(^|\/)\.env($|\.)/i,
  /(^|\/)cookies(?:[.-][^/]*)?\.json$/i,
  /(^|\/)targets(?:[.-][^/]*)?\.json$/i,
  /\.(sqlite|sqlite-shm|sqlite-wal|db)$/i,
];

const allowedFiles = new Set(['.env.example', 'cookies.example.json', 'targets.example.json']);
const contentRules = [
  ['endpoint privado legado', new RegExp(['wbot', 'technology', '\\.com'].join(''), 'i')],
  ['ID de grupo potencialmente real', /\b\d{10,}@g\.us\b/i],
  ['endereco de email', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
  ['telefone brasileiro', /\b(?:\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}[- ]?\d{4}\b/],
  ['token do GitHub', /gh[pousr]_[A-Za-z0-9_]{20,}/],
  ['chave privada', /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/],
  ['credencial Bearer', /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i],
];

const findings = [];

for (const file of trackedFiles) {
  const normalized = file.replaceAll('\\', '/');
  if (!allowedFiles.has(normalized) && forbiddenFiles.some((rule) => rule.test(normalized))) {
    findings.push(`${normalized}: arquivo privado rastreado pelo Git`);
  }

  const absolutePath = path.resolve(file);
  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).size > 2_000_000) {
    continue;
  }

  const content = fs.readFileSync(absolutePath);
  if (content.includes(0)) {
    continue;
  }

  const text = content.toString('utf8');
  for (const [label, rule] of contentRules) {
    if (rule.test(text)) {
      findings.push(`${normalized}: ${label}`);
    }
  }
}

if (findings.length > 0) {
  console.error('A auditoria encontrou dados que nao devem ser publicados:');
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(`Auditoria publica concluida em ${trackedFiles.length} arquivo(s), sem achados.`);
