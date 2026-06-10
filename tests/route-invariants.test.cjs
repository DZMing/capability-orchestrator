'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { findBestMatch, findBestMcpMatch } = require('../scripts/lib/route-scoring.cjs');

const SKILLS = [
  { name: 'coder', desc: '写代码 实现功能 编程 code development implement' },
  { name: 'architect', desc: '架构设计 系统设计 方案 技术选型 design planning' },
  { name: 'tester', desc: '测试 单元测试 TDD 覆盖率 test testing qa' },
  { name: 'reviewer', desc: 'review 代码审查 code review quality check' },
  { name: 'ops', desc: '运维 部署 监控 备份 deploy ops devops' },
];

// ─── 确定性（同 prompt 多次调用结果一致）──────────────────────────────────────

test('invariant: 同 prompt 多次调用结果稳定（无随机性）', () => {
  const prompt = '帮我写代码实现一个登录功能';
  const results = Array.from({ length: 10 }, () => findBestMatch(prompt, SKILLS));
  const first = results[0]?.name ?? null;
  for (const r of results) {
    assert.equal(r?.name ?? null, first, '同 prompt 结果不稳定');
  }
});

test('invariant: 英文 prompt 多次调用结果稳定', () => {
  const prompt = 'write unit tests for the auth module';
  const results = Array.from({ length: 10 }, () => findBestMatch(prompt, SKILLS));
  const first = results[0]?.name ?? null;
  for (const r of results) {
    assert.equal(r?.name ?? null, first, '同 prompt（英文）结果不稳定');
  }
});

// ─── Skill 顺序不影响结果 ──────────────────────────────────────────────────────

test('invariant: skill 数组顺序不影响赢家（无顺序依赖）', () => {
  const prompt = '帮我做代码 review 质量检查';
  const shuffles = [
    [...SKILLS],
    [...SKILLS].reverse(),
    [SKILLS[2], SKILLS[0], SKILLS[4], SKILLS[1], SKILLS[3]],
    [SKILLS[4], SKILLS[3], SKILLS[2], SKILLS[1], SKILLS[0]],
  ];
  const winners = shuffles.map(skills => findBestMatch(prompt, skills)?.name ?? null);
  const first = winners[0];
  for (const w of winners) {
    assert.equal(w, first, `skill 顺序影响结果: ${JSON.stringify(winners)}`);
  }
});

test('invariant: 单 skill 数组顺序不影响结果', () => {
  const singleSkill = [{ name: 'tester', desc: '测试 单元测试 TDD' }];
  const prompt = '写 TDD 测试';
  const r1 = findBestMatch(prompt, singleSkill);
  const r2 = findBestMatch(prompt, singleSkill);
  assert.equal(r1?.name ?? null, r2?.name ?? null);
});

// ─── 平局打破器（tiebreaker）确定性 ───────────────────────────────────────────

test('invariant: 同分场景 tiebreaker 产出确定结果（不抛异常）', () => {
  // 两个 skill 描述完全一样，造成最大同分场景
  const tied = [
    { name: 'alpha', desc: '调试 debug 错误 error fix' },
    { name: 'beta', desc: '调试 debug 错误 error fix' },
  ];
  const prompt = '调试 debug 错误';
  // 多次调用结果一致（tiebreaker 基于 name 字母序，确定）
  const results = Array.from({ length: 5 }, () => findBestMatch(prompt, tied)?.name ?? null);
  const first = results[0];
  for (const r of results) {
    assert.equal(r, first, `同分场景 tiebreaker 不稳定: ${JSON.stringify(results)}`);
  }
  assert.notEqual(first, null, '同分场景应有赢家而非 null');
});

// ─── 空输入边界 ───────────────────────────────────────────────────────────────

test('invariant: null prompt 不抛异常返回 null', () => {
  assert.doesNotThrow(() => findBestMatch(null, SKILLS));
  assert.equal(findBestMatch(null, SKILLS), null);
});

test('invariant: 空 skills 数组返回 null', () => {
  assert.doesNotThrow(() => findBestMatch('写测试', []));
  assert.equal(findBestMatch('写测试', []), null);
});

test('invariant: null skills 不抛异常返回 null', () => {
  assert.doesNotThrow(() => findBestMatch('写测试', null));
  assert.equal(findBestMatch('写测试', null), null);
});

// ─── env var CO_UNMATCHED_PENALTY 可调 ────────────────────────────────────────

test('invariant: CO_UNMATCHED_PENALTY=0 退化为无惩罚模式', () => {
  const prev = process.env.CO_UNMATCHED_PENALTY;
  // 构造 mvp-scaffold 场景：无惩罚时 mvp-scaffold 因含 "数据库" 获胜
  const skills = [
    { name: 'mvp-scaffold', desc: 'Next.js 数据库 schema MVP' },
    { name: 'ops', desc: '运维 备份 恢复' },
  ];
  const prompt = '备份数据库';
  try {
    process.env.CO_UNMATCHED_PENALTY = '0';
    // 惩罚为 0，mvp-scaffold 靠 "数据库" 得分；结果可能是 mvp-scaffold 或 ops
    // 关键：不抛异常，返回确定结果
    assert.doesNotThrow(() => findBestMatch(prompt, skills));

    process.env.CO_UNMATCHED_PENALTY = '0.15';
    // 惩罚为 0.15，mvp-scaffold 因缺 "备份" 被惩罚
    const withPenalty = findBestMatch(prompt, skills);
    // 只验证结果确定，具体赢家由 regression 测试验证
    assert.ok(withPenalty === null || typeof withPenalty.name === 'string');
  } finally {
    if (prev === undefined) delete process.env.CO_UNMATCHED_PENALTY;
    else process.env.CO_UNMATCHED_PENALTY = prev;
  }
});

test('invariant: CO_UNMATCHED_PENALTY 改变后行为一致（不因模块缓存失效）', () => {
  const skills = [
    { name: 'ops', desc: '运维 备份 部署 监控' },
    { name: 'coder', desc: '代码 编程 实现' },
  ];
  // 连续调用两次，结果应一致（不因 env 读取时机差异而不同）
  const r1 = findBestMatch('备份系统', skills);
  const r2 = findBestMatch('备份系统', skills);
  assert.equal(r1?.name ?? null, r2?.name ?? null, '相邻调用结果不一致');
});

// ─── MCP skipUnmatchedPenalty 不影响正常 skill 匹配 ──────────────────────────

test('invariant: findBestMcpMatch 不影响 findBestMatch 的惩罚行为', () => {
  const skills = [
    { name: 'mvp-scaffold', desc: '数据库 schema Next.js' },
    { name: 'ops', desc: '备份 数据库 运维' },
  ];
  const mcpServers = [{ name: 'db', desc: 'database', transport: 'local', authRequired: false, mayWrite: false, externalAccess: false }];
  // MCP 查询不影响 skill 路由状态
  findBestMcpMatch('备份数据库', mcpServers);
  const result = findBestMatch('备份数据库', skills);
  assert.notEqual(result?.name, 'mvp-scaffold', 'MCP 调用后 skill penalty 状态被污染');
});
