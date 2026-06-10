'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { findBestMatch, findBestMcpMatch } = require('../scripts/lib/route-scoring.cjs');

// 历史误推 fixture：真实导致误推的 skill 描述对
const MVP_SCAFFOLD = {
  name: 'mvp-scaffold',
  desc: 'Next.js MVP 脚手架初始化 App Router Supabase 数据库 schema 设计',
};
const OPS = {
  name: 'ops',
  desc: '运维 备份 恢复 迁移 监控 告警 部署 回滚 数据库 PostgreSQL MySQL Redis',
};
const ARCHITECT = {
  name: 'architect',
  desc: '架构设计 系统设计 微服务 数据湖 仓库 技术选型 高并发',
};
const TESTER = {
  name: 'tester',
  desc: '测试 单元测试 集成测试 TDD 覆盖率 回归测试 基准测试',
};

const ALL_SKILLS = [MVP_SCAFFOLD, OPS, ARCHITECT, TESTER];

// ─── 备份数据库 误推回归 ─────────────────────────────────────────────────────

test('regression: "备份数据库" 不误推 mvp-scaffold', () => {
  const result = findBestMatch('备份数据库', ALL_SKILLS);
  assert.notEqual(result?.name, 'mvp-scaffold', `"备份数据库" 误推到 mvp-scaffold`);
});

test('regression: "备份数据库" 命中 ops 或无匹配（不得是 mvp-scaffold）', () => {
  const result = findBestMatch('备份数据库', ALL_SKILLS);
  if (result !== null) {
    assert.equal(result.name, 'ops', `期望 ops 或 no-match，实际: ${result?.name}`);
  }
});

test('regression: "数据库迁移" 不误推 mvp-scaffold', () => {
  const result = findBestMatch('数据库迁移', ALL_SKILLS);
  assert.notEqual(result?.name, 'mvp-scaffold', `"数据库迁移" 误推到 mvp-scaffold`);
});

test('regression: "迁移到 PostgreSQL" 不误推 mvp-scaffold', () => {
  const result = findBestMatch('迁移到 PostgreSQL', ALL_SKILLS);
  assert.notEqual(result?.name, 'mvp-scaffold', `"迁移到 PostgreSQL" 误推到 mvp-scaffold`);
});

test('regression: "监控告警配置" 不误推 mvp-scaffold', () => {
  const result = findBestMatch('监控告警配置', ALL_SKILLS);
  assert.notEqual(result?.name, 'mvp-scaffold', `"监控告警配置" 误推到 mvp-scaffold`);
});

test('regression: "恢复 PostgreSQL" 不误推 mvp-scaffold', () => {
  const result = findBestMatch('恢复 PostgreSQL', ALL_SKILLS);
  assert.notEqual(result?.name, 'mvp-scaffold', `"恢复 PostgreSQL" 误推到 mvp-scaffold`);
});

// ─── 负向惩罚生效 ─────────────────────────────────────────────────────────────

test('regression: 负向惩罚令 mvp-scaffold 在运维场景分数低于 ops', () => {
  const { findBestMatch: fbm } = require('../scripts/lib/route-scoring.cjs');
  // 通过两次单独对比确认惩罚方向
  const withPenalty = fbm('备份数据库', [MVP_SCAFFOLD, OPS]);
  // mvp-scaffold 因含 "数据库" 有正向 overlap，但缺少 "备份" 应被惩罚
  // ops 同时有 "数据库" + "备份"，综合分更高
  if (withPenalty !== null) {
    assert.equal(withPenalty.name, 'ops', `负向惩罚未生效，赢家: ${withPenalty?.name}`);
  }
});

// ─── MCP 路由不被 unmatched penalty 干掉 ──────────────────────────────────────

test('regression: MCP 路由跳过 unmatched penalty（E.1 修复）', () => {
  const servers = [
    {
      name: 'postgres-db',
      desc: 'Postgres database access',
      transport: 'local',
      authRequired: false,
      mayWrite: false,
      externalAccess: false,
    },
  ];
  // MCP desc 极短，prompt 中大量 CJK 词若按 skill 惩罚则全军覆没
  const result = findBestMcpMatch('查询 Postgres 数据库表结构', servers);
  assert.notEqual(result, null, 'MCP 路由被 penalty 清零为 null（E.1 回归）');
});

test('regression: MCP penalty 宽松于 skill（相同 prompt MCP 不负分）', () => {
  const mcpServers = [
    {
      name: 'data-tool',
      desc: 'database query analytics',
      transport: 'local',
      authRequired: false,
      mayWrite: false,
      externalAccess: false,
    },
  ];
  const result = findBestMcpMatch('run a database query analytics report', mcpServers);
  assert.notEqual(result, null, 'MCP 匹配在 skipUnmatchedPenalty 后应命中');
});
