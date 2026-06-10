#!/usr/bin/env node
// scan-heavy.cjs — B 类重型信号巡逻 CLI 入口(双模式)
//
// hook 模式(默认,SessionStart 调用,<100ms):
//   ① 读上次后台体检结果 → 有异常且新鲜 → stdout 报告注入会话
//   ② 结果过期(>30min)→ spawn detached worker 后台刷新 → 立即退出
// worker 模式(--worker --cwd <dir>):
//   实际跑 B1~B4 采集(可能数分钟),结果落盘,静默退出。
//
// 故障开放:任何异常静默退出 0,绝不阻塞会话启动。

'use strict';

const path = require('path');
const { spawn } = require('child_process');

const {
  resolveDataDir,
  loadTrust,
  isTrusted,
  saveResult,
  loadLastResult,
  acquireLock,
  releaseLock,
  collectHeavySignals,
  renderHeavyReport,
} = require('./lib/scan-heavy.cjs');

const DEFAULT_MIN_INTERVAL_MS = 30 * 60 * 1000; // 距上次采集不足 30min 不重跑 worker

function readStdinTimeout(timeoutMs) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    const chunks = [];
    let settled = false;
    const finish = (value) => {
      if (!settled) { settled = true; clearTimeout(timer); resolve(value); }
    };
    const timer = setTimeout(() => {
      try { process.stdin.destroy(); } catch { /* ignore */ }
      finish('');
    }, timeoutMs);
    process.stdin.on('data', c => chunks.push(c));
    process.stdin.on('end', () => finish(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', () => finish(''));
  });
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

async function runWorker(cwd) {
  const dataDir = resolveDataDir(process.env);
  if (!dataDir || !cwd) return;
  if (!acquireLock(dataDir, cwd)) return; // 已有 worker 在跑,退让
  try {
    const trusted = isTrusted(cwd, loadTrust(dataDir));
    const lastResult = loadLastResult(dataDir, cwd);
    const result = await collectHeavySignals({ cwd, trusted, env: process.env, lastResult });
    saveResult(dataDir, result);
  } finally {
    releaseLock(dataDir, cwd);
  }
}

function spawnWorker(cwd) {
  const child = spawn(process.execPath, [__filename, '--worker', '--cwd', cwd], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function runHook() {
  let cwd = process.cwd();
  try {
    const parsed = JSON.parse(await readStdinTimeout(1000));
    if (parsed && parsed.cwd) cwd = String(parsed.cwd);
  } catch { /* stdin 为空或非 JSON → 用进程 cwd */ }

  const dataDir = resolveDataDir(process.env);
  if (!dataDir) return; // 无处存结果,巡逻无意义

  const last = loadLastResult(dataDir, cwd);
  const text = renderHeavyReport(last);
  if (text) process.stdout.write(text + '\n');

  if (process.env.CO_PATROL_HEAVY_SPAWN === 'off') return;
  const minInterval = parseInt(process.env.CO_PATROL_HEAVY_MIN_INTERVAL_MS, 10) || DEFAULT_MIN_INTERVAL_MS;
  if (last && Date.now() - (last.at || 0) < minInterval) return; // 结果够新,不重跑
  spawnWorker(cwd);
}

(async function main() {
  try {
    if (process.argv.includes('--worker')) {
      const cwdArg = argValue(process.argv, '--cwd');
      await runWorker(cwdArg ? path.resolve(cwdArg) : null);
    } else {
      await runHook();
    }
  } catch { /* 故障开放:巡逻失败不阻塞会话 */ }
  process.exit(0);
})();
