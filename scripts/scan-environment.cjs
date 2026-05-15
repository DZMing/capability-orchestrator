#!/usr/bin/env node
// scan-environment.cjs — capability-orchestrator 稳定 CLI 入口
//
// 结构：
//   scripts/lib/scan-core.cjs   扫描与归一化
//   scripts/lib/scan-render.cjs 渲染
//   scripts/lib/user-dir.cjs    用户目录解析
//
// 外部契约保持不变：
//   - 文件路径不变
//   - 导出 API 保持兼容
//   - CLI 参数保持兼容

'use strict';

const core = require('./lib/scan-core.cjs');
const render = require('./lib/scan-render.cjs');
const { resolveUserDir, resolveUserDirWithSource } = require('./lib/user-dir.cjs');

module.exports = {
  ...core,
  ...render,
  resolveUserDir,
  resolveUserDirWithSource,
};

// ─── 入口（CLI 直接运行时执行）──────────────────────────────────────────────

if (require.main !== module) { /* 被 require 时不执行 */ }
else {
  function getArg(name) {
    const prefix = `--${name}=`;
    const a = process.argv.find(x => x.startsWith(prefix));
    return a ? a.slice(prefix.length) : undefined;
  }

  // stdin 带 1s 超时，超时 fallback 到空串（避免 hook 挂起）
  function readStdinTimeout(timeoutMs) {
    return new Promise((resolve) => {
      if (process.stdin.isTTY) return resolve('');
      const chunks = [];
      let settled = false;
      const t = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { process.stdin.destroy(); } catch { /* ignore */ }
          resolve('');
        }
      }, timeoutMs);
      process.stdin.on('data', c => chunks.push(c));
      process.stdin.on('end', () => {
        if (!settled) { settled = true; clearTimeout(t); resolve(Buffer.concat(chunks).toString('utf-8')); }
      });
      process.stdin.on('error', () => {
        if (!settled) { settled = true; clearTimeout(t); resolve(''); }
      });
    });
  }

  (async function main() {
    const VALID_MODES = ['route', 'list', 'awareness'];
    const mode = getArg('mode') || 'route';
    if (!VALID_MODES.includes(mode)) {
      process.stderr.write(`无效模式: ${mode}，支持: ${VALID_MODES.join('/')}\n`);
      process.exit(1);
    }
    let stdinCwd;
    try {
      const raw = await readStdinTimeout(1000);
      const parsed = JSON.parse(raw);
      if (parsed && parsed.cwd) stdinCwd = String(parsed.cwd);
    } catch { /* ignore: stdin may be empty or non-JSON */ }
    const projectDir = stdinCwd || getArg('project-dir') || process.env.CAPABILITY_PROJECT_DIR;
    const userDir = getArg('user-dir') || process.env.CAPABILITY_USER_DIR;
    const { text, errors: errs } = render.renderSnapshot(core.collectSnapshot(projectDir, userDir), mode);
    if (errs.length > 0) {
      process.stderr.write(`扫描部分失败:\n${errs.map(e => '  ' + e).join('\n')}\n`);
    }
    process.stdout.write(text + '\n');
  })().catch(err => {
    process.stderr.write(`致命错误: ${err.message}\n${err.stack}\n`);
    process.stdout.write('[扫描失败，详见 stderr]\n');
    process.exit(1);
  });
}
