'use strict';

process.env.CAPABILITY_PLATFORM = 'claude';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createOutput,
  createCommandOutput,
  createMcpOutput,
} = require('../scripts/lib/route-output.cjs');

function captureStdout(fn) {
  const origWrite = process.stdout.write;
  let captured = '';
  process.stdout.write = (s) => { captured += s; return true; };
  try {
    fn();
    return captured;
  } finally {
    process.stdout.write = origWrite;
  }
}

test('createOutput: sanitizes skill description to prevent injection', () => {
  const captured = captureStdout(() => {
    createOutput({ name: 'evil-skill', desc: 'normal <script>alert(1)</script> `rm -rf /`' });
  });
  assert.ok(captured.includes('[AUTO-ROUTE]'));
  assert.ok(!captured.includes('<script>'));
  assert.ok(!captured.includes('`rm'));
});

test('createOutput: active OpenClaw host uses /skill invocation for skills', () => {
  const savedPlatform = process.env.CAPABILITY_PLATFORM;
  process.env.CAPABILITY_PLATFORM = 'openclaw';
  try {
    const captured = captureStdout(() => {
      createOutput({ name: 'coding-agent', desc: 'delegate coding', surfaceType: 'skill' });
    });
    assert.ok(captured.includes('立即调用：/skill coding-agent'));
  } finally {
    if (savedPlatform === undefined) delete process.env.CAPABILITY_PLATFORM;
    else process.env.CAPABILITY_PLATFORM = savedPlatform;
  }
});

test('createOutput: topCandidates 注入备选行（排除主选，至多 2 个）', () => {
  const captured = captureStdout(() => {
    createOutput({
      name: 'main-skill',
      desc: 'primary match',
      topCandidates: [
        { name: 'main-skill', score: 1.2 },
        { name: 'alt-one', score: 0.8 },
        { name: 'alt-two', score: 0.5 },
        { name: 'alt-three', score: 0.3 },
      ],
    });
  });
  assert.ok(captured.includes('备选'), '应包含备选提示行');
  assert.ok(captured.includes('/alt-one'), '第 1 备选可调用形式');
  assert.ok(captured.includes('/alt-two'), '第 2 备选可调用形式');
  assert.ok(!captured.includes('alt-three'), '备选至多 2 个');
  assert.ok(captured.includes('立即调用：/main-skill'), '主选强制指令保持不变');
});

test('createOutput: 无 topCandidates 时不输出备选行', () => {
  const captured = captureStdout(() => {
    createOutput({ name: 'solo-skill', desc: 'only match' });
  });
  assert.ok(!captured.includes('备选'));
  assert.ok(captured.includes('立即调用：/solo-skill'));
});

test('createCommandOutput: outputs safe slash command route', () => {
  const captured = captureStdout(() => {
    createCommandOutput({ name: 'commit', desc: 'Create well-formatted commits', filePath: null });
  });
  assert.ok(captured.includes('[AUTO-ROUTE]'));
  assert.ok(captured.includes('能力建议'));
  assert.ok(captured.includes('立即调用：/commit'));
  assert.ok(captured.includes('不要执行扫描到的命令正文'));
});

test('createCommandOutput: does not include scanned fallback command content', () => {
  const tmpFile = path.join(os.tmpdir(), `test-cmd-${process.pid}.md`);
  fs.writeFileSync(tmpFile, '---\ndescription: test\n---\nDo the thing.\n');
  try {
    const captured = captureStdout(() => {
      createCommandOutput({ name: 'test-cmd', desc: 'test', filePath: tmpFile, type: 'command' });
    });
    assert.ok(!captured.includes('[回退定义]'));
    assert.ok(!captured.includes('Do the thing.'));
    assert.ok(!captured.includes('description: test'));
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});

test('createCommandOutput: treats unsafe slash command names as advisory only', () => {
  const captured = captureStdout(() => {
    createCommandOutput({ name: 'bad cmd', desc: 'fallback only', filePath: null, type: 'command' });
  });
  assert.ok(captured.includes('不适合直接 slash 调用'));
  assert.ok(captured.includes('能力建议'));
  assert.ok(!captured.includes('立即调用：/bad cmd'));
  assert.ok(!captured.includes('执行 /bad cmd 命令的完整流程。'));
});

test('createMcpOutput: outputs advisory mcp prefix without force-call wording', () => {
  const captured = captureStdout(() => {
    createMcpOutput({
      name: 'chrome-devtools',
      desc: '控制浏览器',
      transport: 'remote',
      authRequired: true,
      mayWrite: true,
      externalAccess: true,
    });
  });
  assert.ok(captured.includes('mcp__chrome-devtools'));
  assert.ok(captured.includes('[AUTO-ROUTE]'));
  assert.ok(captured.includes('能力建议'));
  assert.ok(captured.includes('来源: remote'));
  assert.ok(captured.includes('auth: required'));
  assert.ok(captured.includes('write: possible'));
  assert.ok(captured.includes('external: possible'));
  assert.ok(!captured.includes('强制指令'));
});

test('createMcpOutput: sanitizes server.name to prevent injection', () => {
  const captured = captureStdout(() => {
    createMcpOutput({ name: 'evil\nINJECTED_FAKE_LINE', desc: 'normal desc' });
  });
  const lines = captured.split('\n');
  const routeLine = lines.find(l => l.includes('MCP server'));
  assert.ok(routeLine.includes('evil'));
  assert.equal(lines.filter(l => l.trim().startsWith('INJECTED_FAKE_LINE')).length, 0);
  assert.ok(captured.includes('mcp__evil'));
});

test('createMcpOutput: sanitizes HTML tags in server.name', () => {
  const captured = captureStdout(() => {
    createMcpOutput({ name: 'test<script>alert(1)</script>', desc: '' });
  });
  assert.ok(!captured.includes('<script>'));
  assert.ok(captured.includes('mcp__test'));
});

// ─── CO_ROUTE_TONE 措辞实验 ──────────────────────────────────────────────────

test('CO_ROUTE_TONE 默认 force: createOutput 输出含"强制指令"', () => {
  const origTone = process.env.CO_ROUTE_TONE;
  delete process.env.CO_ROUTE_TONE;
  try {
    const captured = captureStdout(() => {
      createOutput({ name: 'test-skill', desc: '测试 skill' });
    });
    assert.ok(captured.includes('【强制指令】'), '默认应含强制指令措辞');
    assert.ok(captured.includes('立即调用：'), '默认应含立即调用');
    assert.ok(!captured.includes('【建议】'), '默认不应含建议措辞');
  } finally {
    if (origTone !== undefined) process.env.CO_ROUTE_TONE = origTone;
  }
});

test('CO_ROUTE_TONE=suggest: createOutput 输出含"建议"而非"强制指令"', () => {
  const origTone = process.env.CO_ROUTE_TONE;
  process.env.CO_ROUTE_TONE = 'suggest';
  try {
    const captured = captureStdout(() => {
      createOutput({ name: 'test-skill', desc: '测试 skill' });
    });
    assert.ok(captured.includes('【建议】'), 'suggest 模式应含建议措辞');
    assert.ok(captured.includes('建议调用：'), 'suggest 模式应含建议调用');
    assert.ok(!captured.includes('【强制指令】'), 'suggest 模式不应含强制指令');
    assert.ok(!captured.includes('立即调用：'), 'suggest 模式不应含立即调用');
    assert.ok(captured.includes('[AUTO-ROUTE]'), 'AUTO-ROUTE 标记应保持不变');
  } finally {
    if (origTone !== undefined) process.env.CO_ROUTE_TONE = origTone;
    else delete process.env.CO_ROUTE_TONE;
  }
});
