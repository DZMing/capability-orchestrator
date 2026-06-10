#!/usr/bin/env node
// stop-patrol.cjs — Stop hook 收尾检查(主动 Agent 第二阶段)
//
// 会话即将结束时复用 A 类快信号查"烂尾":真实脏文件 / 本地领先远端 /
// 干完活停错分支。发现烂尾 → 输出 {"decision":"block","reason":...} 让
// 模型收尾一次;无烂尾或任何异常 → 静默放行。
//
// 防死循环硬规则:stop_hook_active=true(本次停止已是 Stop hook 续命的
// 结果)时无条件放行,保证最多 block 一次。
// 收尾动作不擅自越权:reason 指示模型按本会话已有授权分档处理 ——
// 用户授权过提交/推送则直接收尾报备,没授权则只向用户列出未收尾项。

'use strict';

const { collectStatusSignals } = require('./lib/scan-status.cjs');

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

function buildLooseEnds(signals) {
  const items = [];
  if (signals.dirty) {
    items.push(`工作区有 ${signals.dirty.count} 个未提交文件(${signals.dirty.samples.join('、')}${signals.dirty.count > signals.dirty.samples.length ? '…' : ''})`);
  }
  if (signals.unpushed) {
    items.push(`本地领先远端 ${signals.unpushed.count} 个提交,尚未推送`);
  }
  if (signals.wrongBranch) {
    items.push(`活已干完但仍停在 ${signals.wrongBranch.current} 分支(主分支 ${signals.wrongBranch.main})`);
  }
  return items;
}

(async function main() {
  try {
    let input = null;
    try { input = JSON.parse(await readStdinTimeout(1000)); } catch { return; /* 坏输入 → 放行 */ }
    if (!input || typeof input !== 'object') return;

    // 硬规则:已经是 Stop hook 续命的回合,必须放行,防死循环
    if (input.stop_hook_active) return;
    if (process.env.CO_STOP_PATROL === 'off') return;

    // Stop hook 输入必带 cwd;缺失即异常态,不猜目录(误 block 比漏报严重)
    if (!input.cwd) return;
    const items = buildLooseEnds(collectStatusSignals({ cwd: String(input.cwd) }));
    if (items.length === 0) return;

    const reason = [
      `[PATROL] 会话收尾检查发现 ${items.length} 件未收尾:`,
      ...items.map((t, i) => `${i + 1}. ${t}`),
      '按本会话已有授权分档处理:用户授权过提交/推送 → 直接收尾并简短报备;未授权 → 向用户列出以上未收尾项,由用户决定。处理完或已汇报后即可正常结束,不要重复检查。',
    ].join('\n');

    process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
  } catch { /* 故障开放:检查失败绝不卡住会话结束 */ }
  process.exit(0);
})();
