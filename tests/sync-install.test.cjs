'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'sync-install.cjs');
const REPO_ROOT = path.join(__dirname, '..');
const SRC_SCRIPTS = path.join(REPO_ROOT, 'scripts');

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// 递归复制目录
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

test('sync-install: --check 模式在 target 与 repo 完全一致时输出 OK（exit 0）', () => {
  const tmpA = makeTmpDir('co-sync-ok-');
  try {
    // 把 repo 的 scripts/ 原样复制到 target，--check 应报告一致
    copyDir(SRC_SCRIPTS, path.join(tmpA, 'scripts'));
    const result = execFileSync(process.execPath, [SCRIPT, '--check', `--target-a=${tmpA}`],
      { encoding: 'utf8', timeout: 15000 });
    assert.ok(
      result.includes('OK') || result.includes('一致') || result.includes('0 diff'),
      `--check 应报告一致，得到: ${result}`
    );
  } finally {
    fs.rmSync(tmpA, { recursive: true, force: true });
  }
});

test('sync-install: --check 模式检测到 target 文件被篡改时报告差异（exit 1）', () => {
  const tmpA = makeTmpDir('co-sync-diff-');
  try {
    copyDir(SRC_SCRIPTS, path.join(tmpA, 'scripts'));
    // 篡改一个文件
    const tampered = path.join(tmpA, 'scripts', 'route-matcher.cjs');
    fs.writeFileSync(tampered, '// tampered\n');

    let threw = false;
    let output = '';
    try {
      output = execFileSync(process.execPath, [SCRIPT, '--check', `--target-a=${tmpA}`],
        { encoding: 'utf8', timeout: 15000 });
    } catch (e) {
      threw = true;
      output = (e.stdout || '') + (e.stderr || '');
    }
    assert.ok(threw, '--check 检测到差异时应 exit 非 0');
    assert.ok(output.includes('route-matcher.cjs'), `应提及差异文件，得到: ${output}`);
  } finally {
    fs.rmSync(tmpA, { recursive: true, force: true });
  }
});

test('sync-install: --check 模式检测到 target 文件缺失时报告差异（exit 1）', () => {
  const tmpA = makeTmpDir('co-sync-missing-');
  try {
    // 只复制部分文件（lib/ 目录不复制）
    fs.mkdirSync(path.join(tmpA, 'scripts'), { recursive: true });
    // target scripts/ 为空 → 所有 repo 文件都是"差异"
    let threw = false;
    try {
      execFileSync(process.execPath, [SCRIPT, '--check', `--target-a=${tmpA}`],
        { encoding: 'utf8', timeout: 15000 });
    } catch { threw = true; }
    assert.ok(threw, '文件缺失时应 exit 非 0');
  } finally {
    fs.rmSync(tmpA, { recursive: true, force: true });
  }
});

test('sync-install: 默认模式将 repo 脚本同步到 target，同步后内容一致', () => {
  const tmpA = makeTmpDir('co-sync-target-');
  try {
    fs.mkdirSync(path.join(tmpA, 'scripts'), { recursive: true });
    // 放一个旧文件
    const repoScript = path.join(SRC_SCRIPTS, 'route-matcher.cjs');
    fs.writeFileSync(path.join(tmpA, 'scripts', 'route-matcher.cjs'), '// stale\n');

    execFileSync(process.execPath, [SCRIPT, `--target-a=${tmpA}`],
      { encoding: 'utf8', timeout: 15000 });

    const src = fs.readFileSync(repoScript, 'utf8');
    const dst = fs.readFileSync(path.join(tmpA, 'scripts', 'route-matcher.cjs'), 'utf8');
    assert.equal(src, dst, '同步后 target 内容应与 repo 一致');
  } finally {
    fs.rmSync(tmpA, { recursive: true, force: true });
  }
});

test('sync-install: target 目录不存在时自动创建并同步', () => {
  const base = makeTmpDir('co-sync-new-');
  const newTarget = path.join(base, 'deep', 'target');
  try {
    assert.ok(!fs.existsSync(newTarget), '目录应一开始不存在');
    execFileSync(process.execPath, [SCRIPT, `--target-a=${newTarget}`],
      { encoding: 'utf8', timeout: 15000 });
    assert.ok(fs.existsSync(path.join(newTarget, 'scripts')), 'scripts 目录应被创建');
    // 同步后至少有一个 .cjs 文件
    const files = fs.readdirSync(path.join(newTarget, 'scripts')).filter(f => f.endsWith('.cjs'));
    assert.ok(files.length > 0, '应有 .cjs 文件被复制');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('sync-install: --check 模式不修改任何文件', () => {
  const tmpA = makeTmpDir('co-sync-ro-');
  try {
    copyDir(SRC_SCRIPTS, path.join(tmpA, 'scripts'));
    const testFile = path.join(tmpA, 'scripts', 'route-matcher.cjs');
    const mtimeBefore = fs.statSync(testFile).mtimeMs;

    // 等一小会儿确保 mtime 精度足够
    const waitUntil = Date.now() + 100;
    while (Date.now() < waitUntil) { /* spin */ }

    try {
      execFileSync(process.execPath, [SCRIPT, '--check', `--target-a=${tmpA}`],
        { encoding: 'utf8', timeout: 15000 });
    } catch { /* 即使有差异也不影响 mtime 检查 */ }

    const mtimeAfter = fs.statSync(testFile).mtimeMs;
    assert.equal(mtimeBefore, mtimeAfter, '--check 不应修改文件');
  } finally {
    fs.rmSync(tmpA, { recursive: true, force: true });
  }
});
