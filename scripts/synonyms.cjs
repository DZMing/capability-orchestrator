'use strict';
// 同义词/翻译映射表 — 双向展开模式（追加同义词，不替换原词）
// 覆盖：中英互通 + 常见技术近义词
// 维护：新增 skill 时按需添加对应映射

const SYNONYM_MAP = new Map([
  // ── 认证 / 授权 ──────────────────────────────────────────────────────────
  ['认证', ['auth', 'authentication', 'login']],
  ['auth', ['认证', 'authentication', 'login']],
  ['authentication', ['auth', '认证']],
  ['授权', ['authorization', 'permission']],
  ['authorization', ['授权', 'permission']],
  ['登录', ['login', 'signin', 'auth']],
  ['login', ['登录', 'signin', 'auth', '认证']],
  ['oauth', ['认证', 'auth']],

  // ── 部署 / 发布 ──────────────────────────────────────────────────────────
  ['部署', ['deploy', 'release', 'ship']],
  ['deploy', ['部署', 'release', 'ship']],
  ['发布', ['deploy', 'release', 'ship']],
  ['release', ['发布', 'deploy', 'ship']],
  ['ship', ['deploy', '发布', '部署']],
  ['上线', ['deploy', 'release']],

  // ── 调试 / 错误 ──────────────────────────────────────────────────────────
  ['调试', ['debug', 'fix', 'troubleshoot']],
  ['debug', ['调试', 'fix', 'troubleshoot']],
  ['修复', ['fix', 'debug', 'repair', 'patch']],
  ['fix', ['修复', 'debug', 'repair']],
  ['错误', ['error', 'bug', 'issue']],
  ['error', ['错误', 'bug', 'issue']],
  ['bug', ['错误', 'error', 'issue']],
  ['issue', ['bug', 'error', '问题']],
  ['问题', ['issue', 'bug', 'error', 'problem']],
  ['problem', ['问题', 'issue', 'bug']],

  // ── 审查 / 审计 ──────────────────────────────────────────────────────────
  ['审查', ['review', 'audit', 'check']],
  ['review', ['审查', 'audit', 'check']],
  ['代码审查', ['code-review', 'review']],
  ['audit', ['审查', 'audit']],

  // ── 测试 ─────────────────────────────────────────────────────────────────
  ['测试', ['test', 'testing', 'qa', 'spec']],
  ['test', ['测试', 'qa']],
  ['testing', ['测试', 'qa']],
  ['qa', ['测试', 'test']],

  // ── 数据 / 分析 ──────────────────────────────────────────────────────────
  ['数据分析', ['analytics', 'analysis', 'data']],
  ['analytics', ['数据分析', 'analysis']],
  ['analysis', ['分析', 'analytics']],
  ['分析', ['analysis', 'analytics']],

  // ── 设计 / UI ────────────────────────────────────────────────────────────
  ['设计', ['design', 'ui', 'ux']],
  ['design', ['设计', 'ui']],
  ['界面', ['ui', 'interface', 'design']],
  ['ui', ['界面', 'design', '设计']],

  // ── 配置 / 环境 ──────────────────────────────────────────────────────────
  ['配置', ['config', 'configuration', 'setup']],
  ['config', ['配置', 'configuration', 'setup']],
  ['configuration', ['配置', 'config', 'setup']],
  ['setup', ['配置', 'config', 'init']],
  ['初始化', ['init', 'setup', 'scaffold']],
  ['init', ['初始化', 'setup']],

  // ── 性能 / 优化 ──────────────────────────────────────────────────────────
  ['优化', ['optimize', 'performance', 'improve']],
  ['optimize', ['优化', 'improve']],
  ['performance', ['性能', 'perf', 'optimize']],
  ['性能', ['performance', 'perf', 'optimize']],

  // ── 搜索 ─────────────────────────────────────────────────────────────────
  ['搜索', ['search', 'find', 'query']],
  ['search', ['搜索', 'find', 'query']],

  // ── 文档 ─────────────────────────────────────────────────────────────────
  ['文档', ['docs', 'documentation']],
  ['docs', ['文档', 'documentation']],
  ['documentation', ['文档', 'docs']],

  // ── 数据库 ───────────────────────────────────────────────────────────────
  ['数据库', ['database', 'db', 'storage']],
  ['database', ['数据库', 'db']],
  ['db', ['数据库', 'database']],
]);

function expandSynonyms(tokens) {
  const result = new Set(tokens);
  for (const t of tokens) {
    const syns = SYNONYM_MAP.get(t);
    if (syns) {
      for (const s of syns) result.add(s);
    }
  }
  return [...result];
}

module.exports = { expandSynonyms, SYNONYM_MAP };
