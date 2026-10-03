import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
const splitPaths = buffer => buffer.toString('utf8').split('\0').filter(Boolean);
const tracked = new Set(splitPaths(git(['ls-files', '--cached', '-z'])));
const candidates = [...new Set(splitPaths(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])))].sort();
const findings = [];
const report = (file, reason) => findings.push(`${file}: ${reason}`);
const forbiddenPath = /(?:^|\/)(?:node_modules|dist|coverage|\.dev-data|backups|\.codex|\.claude|\.agents|\.aws|\.ssh|\.idea|\.vscode)(?:\/|$)|^docs\/internal\/|^local\/|^app\/eval\/results\/|^app\/native\/(?:embedding|context)-helper$|(?:^|\/)(?:\.DS_Store|auth\.json|credentials\.json|tokens\.json)$|\.(?:sqlite(?:-[^/]*)?|db(?:-[^/]*)?|db3|pem|key|p12|pfx|dmg|zip|log|tsbuildinfo)$|\.app(?:\/|$)|^app\/eval\/(?:.*-(?:report|prepared)|memory-baseline)\.json$/i;
const contentPatterns = [
  ['秘密鍵', /-{5}BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-{5}/],
  ['既知の認証トークン', /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{20,})\b/],
  ['個人の絶対パス', /\/(?:Users|home)\/[^\s/"'<>]+\//],
];
let bytes = 0;
const inspectContent = (file, buffer, version) => {
  if (buffer.includes(0)) {
    report(file, `${version}: バイナリ。公開前に内容・利用権を個別確認してください`);
    return;
  }
  const body = buffer.toString('utf8');
  for (const [reason, pattern] of contentPatterns) {
    if (pattern.test(body)) report(file, `${version}: ${reason}`);
  }
};

for (const file of candidates) {
  const basename = file.split('/').at(-1);
  if (forbiddenPath.test(file) || (basename.startsWith('.env') && basename !== '.env.example')) {
    report(file, '公開対象外の配置・ファイル');
    continue;
  }
  const absolute = resolve(root, file);
  const stat = lstatSync(absolute, { throwIfNoEntry: false });
  if (stat) {
    if (!stat.isFile()) {
      report(file, '通常ファイルではありません');
      continue;
    }
    const buffer = readFileSync(absolute);
    bytes += buffer.length;
    inspectContent(file, buffer, '作業ファイル');
  }
  // An older staged version can contain data already removed from the working file.
  if (tracked.has(file)) inspectContent(file, git(['show', `:${file}`]), 'Git index');
}

if (findings.length) {
  console.error('公開候補に確認が必要な項目があります（値は表示しません）。');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`公開候補 ${candidates.length} ファイル / ${(bytes / 1024).toFixed(1)} KiB: 除外対象・既知の認証文字列・個人パスの検出なし。`);
}
