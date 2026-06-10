#!/usr/bin/env node
'use strict';
// sync-install.cjs — 同步 repo 脚本到已安装插件缓存目录
//
// Usage:
//   node scripts/sync-install.cjs                   # 同步到默认两个 cache 目录
//   node scripts/sync-install.cjs --check           # 只检查差异，不修改文件
//   node scripts/sync-install.cjs --target-a=<dir>  # 指定第一个目标（也可省略 -b）
//   node scripts/sync-install.cjs --target-b=<dir>  # 指定第二个目标
//
// 零外部依赖；只用 Node.js 18+ stdlib。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const REPO_ROOT = path.join(__dirname, '..');
const SRC_SCRIPTS = path.join(REPO_ROOT, 'scripts');

// ── 文件工具 ──────────────────────────────────────────────────────────────────

function hashFile(p) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  } catch { return null; }
}

function collectCjsFiles(dir, relPrefix) {
  const result = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        result.push(...collectCjsFiles(path.join(dir, entry.name), rel));
      } else if (entry.name.endsWith('.cjs')) {
        result.push(rel);
      }
    }
  } catch { /* 目录不存在：返回空 */ }
  return result;
}

// ── 比较 ──────────────────────────────────────────────────────────────────────

// 返回 src 里所有 .cjs 文件与 dst 对应文件的差异列表
function diffDirs(srcDir, dstDir) {
  const diffs = [];
  for (const rel of collectCjsFiles(srcDir, '')) {
    const srcHash = hashFile(path.join(srcDir, rel));
    const dstHash = hashFile(path.join(dstDir, rel));
    if (srcHash !== dstHash) {
      diffs.push({ rel, srcHash: srcHash ? srcHash.slice(0, 8) : '(none)', dstHash: dstHash ? dstHash.slice(0, 8) : '(missing)' });
    }
  }
  return diffs;
}

// ── 同步 ──────────────────────────────────────────────────────────────────────

function syncScripts(srcDir, dstDir) {
  let copied = 0;
  for (const rel of collectCjsFiles(srcDir, '')) {
    const src = path.join(srcDir, rel);
    const dst = path.join(dstDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copied++;
  }
  return copied;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { check: false, targets: [] };
  for (const a of argv.slice(2)) {
    if (a === '--check') { args.check = true; continue; }
    const m = a.match(/^--target-[ab]=(.+)$/);
    if (m) { args.targets.push(m[1]); }
  }
  return args;
}

function defaultTargets() {
  const home = os.homedir();
  return [
    path.join(home, '.claude', 'plugins', 'cache', 'capability-orchestrator'),
    path.join(home, '.codex',  'plugins', 'cache', 'capability-orchestrator'),
  ];
}

function main() {
  const args = parseArgs(process.argv);
  const targets = args.targets.length > 0 ? args.targets : defaultTargets();

  if (args.check) {
    let totalDiffs = 0;
    for (const target of targets) {
      const dstScripts = path.join(target, 'scripts');
      const diffs = diffDirs(SRC_SCRIPTS, dstScripts);
      if (diffs.length === 0) {
        process.stdout.write(`✓ OK: ${target} 一致（0 diff）\n`);
      } else {
        for (const d of diffs) {
          process.stdout.write(`✗ ${path.join(target, 'scripts', d.rel)}: repo=${d.srcHash} installed=${d.dstHash}\n`);
        }
        totalDiffs += diffs.length;
      }
    }
    if (totalDiffs > 0) {
      process.stderr.write(`共 ${totalDiffs} 个文件不一致。运行不带 --check 的命令同步。\n`);
      process.exit(1);
    }
    return;
  }

  // 同步模式
  let anyFailed = false;
  for (const target of targets) {
    const dstScripts = path.join(target, 'scripts');
    try {
      const copied = syncScripts(SRC_SCRIPTS, dstScripts);
      const remaining = diffDirs(SRC_SCRIPTS, dstScripts);
      if (remaining.length === 0) {
        process.stdout.write(`✓ ${target}：同步 ${copied} 个文件，验证一致。\n`);
      } else {
        process.stdout.write(`⚠ ${target}：复制 ${copied} 个文件，仍有 ${remaining.length} 个差异。\n`);
        anyFailed = true;
      }
    } catch (e) {
      process.stderr.write(`✗ ${target}：同步失败：${e.message}\n`);
      anyFailed = true;
    }
  }
  if (anyFailed) process.exit(1);
}

main();
