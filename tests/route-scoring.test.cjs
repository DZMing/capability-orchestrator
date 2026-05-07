'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { findBestMatch, findBestMcpMatch } = require('../scripts/lib/route-scoring.cjs');

test('findBestMatch: matches skill by keyword overlap', () => {
  const skills = [
    { name: 'debugging', desc: 'fix bug and debug error in code' },
    { name: 'testing', desc: 'write tests and run test suites' },
  ];
  const match = findBestMatch('there is a bug error in my code', skills);
  assert.ok(match);
  assert.equal(match.name, 'debugging');
});

test('findBestMatch: picks highest overlap', () => {
  const skills = [
    { name: 'general', desc: 'general purpose task handler' },
    { name: 'code-review', desc: 'review code quality and code style and code patterns' },
  ];
  const match = findBestMatch('please review my code quality and code style', skills);
  assert.ok(match);
  assert.equal(match.name, 'code-review');
});

test('findBestMatch: returns null for no match or empty input', () => {
  const skills = [{ name: 'testing', desc: 'write tests' }];
  assert.equal(findBestMatch('deploy to production server', skills), null);
  assert.equal(findBestMatch('something', []), null);
  assert.equal(findBestMatch('', skills), null);
});

test('findBestMatch: single keyword match needs long prompt unless it hits a skill name', () => {
  const skills = [{ name: 'debug', desc: 'debug errors' }];
  assert.equal(findBestMatch('debug', skills), null);
  const match = findBestMatch('can you help me debug this issue', skills);
  assert.ok(match);
  assert.equal(match.name, 'debug');
});

test('findBestMatch: confidence remains in documented range', () => {
  const skills = [{ name: 'debugging', desc: 'fix bug and debug error in code' }];
  const match = findBestMatch('there is a bug error in my code', skills);
  assert.ok(match.confidence >= 0);
  assert.ok(match.confidence <= 1);
});

test('findBestMatch: Chinese prompt with "做" matches skill', () => {
  const skills = [{ name: 'review', desc: '代码审查工具' }];
  const match = findBestMatch('帮我做一个代码审查', skills);
  assert.ok(match);
  assert.equal(match.name, 'review');
});

test('findBestMatch: matches plugin-provided skill', () => {
  const skills = [
    { name: 'alpha', desc: 'Alpha skill for data analysis and reports' },
    { name: 'beta', desc: 'Beta skill for testing frameworks' },
  ];
  const match = findBestMatch('run data analysis and generate reports', skills);
  assert.ok(match);
  assert.equal(match.name, 'alpha');
});

test('findBestMatch: specific keyword match beats generic overlap from long desc', () => {
  const skills = [
    { name: 'auth-quick', desc: '5 分钟认证集成：Supabase Auth 或 Clerk，含 Google OAuth' },
    { name: 'feedback-loop', desc: '用户反馈系统：嵌入式反馈按钮 + 自动分类（Bug/功能请求/好评）+ 邮件通知，15 分钟集成完成' },
    { name: 'user-dashboard', desc: '用户仪表盘：展示用户数据和功能入口' },
    { name: 'user-profile', desc: '用户资料页面：编辑用户信息和功能设置' },
    { name: 'feature-flags', desc: '功能开关系统：灰度发布用户功能' },
    { name: 'analytics', desc: '用户分析工具：追踪用户行为和功能使用' },
  ];
  const match = findBestMatch('写一个用户认证功能', skills);
  assert.ok(match);
  assert.equal(match.name, 'auth-quick');
});

test('findBestMatch: avoids incidental single-keyword matches', () => {
  const skills = [
    { name: 'design-html', desc: 'Design finalization: generates production-quality HTML/CSS' },
    { name: 'frontend-design', desc: 'Create production-grade frontend interfaces' },
  ];
  assert.equal(findBestMatch('I need to deploy this to production', skills), null);
});

test('findBestMatch: deploy intent beats incidental production wording', () => {
  const skills = [
    { name: 'deploy-tool', desc: 'deploy code to staging and production servers' },
    { name: 'design-html', desc: 'Design finalization: generates production-quality HTML/CSS' },
  ];
  const match = findBestMatch('I need to deploy this to production', skills);
  assert.ok(match);
  assert.equal(match.name, 'deploy-tool');
});

test('findBestMatch: single-keyword match on skill name still works', () => {
  const skills = [
    { name: 'production-deploy', desc: 'deploy code to servers' },
    { name: 'design-html', desc: 'Design finalization: generates production-quality HTML/CSS' },
  ];
  const match = findBestMatch('I need to deploy this to production', skills);
  assert.ok(match);
  assert.equal(match.name, 'production-deploy');
});

test('findBestMatch: bigram match weighs more than single-char matches', () => {
  const skills = [
    { name: 'code-review', desc: '代码审查工具' },
    { name: 'code-gen', desc: '代码生成器，自动生成代码模板' },
  ];
  const match = findBestMatch('帮我做代码审查', skills);
  assert.ok(match);
  assert.equal(match.name, 'code-review');
});

test('findBestMatch: rare bigram beats common single-char noise in large skill set', () => {
  const skills = [
    { name: 'auth-quick', desc: '5 分钟认证集成：Supabase Auth 或 Clerk，含 Google OAuth' },
    { name: 'feedback-loop', desc: '用户反馈系统：嵌入式反馈按钮 + 自动分类（Bug/功能请求/好评）+ 邮件通知' },
    { name: 'user-dashboard', desc: '用户仪表盘：展示用户数据和功能入口' },
    { name: 'user-profile', desc: '用户资料页面：编辑用户信息和功能设置' },
    { name: 'feature-flags', desc: '功能开关系统：灰度发布用户功能' },
    { name: 'analytics', desc: '用户分析工具：追踪用户行为和功能使用' },
    { name: 'security-scan', desc: '安全认定扫描：确认代码合规性和证明安全等级' },
    { name: 'identity-verify', desc: '身份验证服务：证件识别和认可自动化' },
    { name: 'data-validation', desc: '数据验证工具：认真校验格式和证据链完整性' },
    { name: 'compliance', desc: '合规认定系统：许可证管理和认可流程自动化' },
    { name: 'audit-log', desc: '审计日志：确认操作记录和证据保存' },
    { name: 'permission-mgr', desc: '权限管理：认可授权和证书分发' },
  ];
  const match = findBestMatch('写一个用户认证功能', skills);
  assert.ok(match);
  assert.equal(match.name, 'auth-quick');
});

test('findBestMatch: NFC prompt matches NFD skill description', () => {
  const skills = [{ name: 'cafe-tool', desc: 'cafe\u0301 helper for re\u0301sume\u0301' }];
  const match = findBestMatch('I need the caf\u00e9 helper for my r\u00e9sum\u00e9 today', skills);
  assert.ok(match);
  assert.equal(match.name, 'cafe-tool');
});

test('stemming: findBestMatch matches across word forms via stemming', () => {
  const skills = [{ name: 'bug-tracker', desc: 'track and fix bug in code' }];
  const match = findBestMatch('there are bugs errors in my code', skills);
  assert.ok(match);
  assert.equal(match.name, 'bug-tracker');
});

test('synonym: findBestMatch matches across Chinese and English descriptions', () => {
  const auth = findBestMatch('用户认证集成方案', [
    { name: 'auth-quick', desc: 'Supabase Auth Clerk OAuth authentication integration' },
    { name: 'other', desc: 'general purpose helper' },
  ]);
  assert.ok(auth);
  assert.equal(auth.name, 'auth-quick');

  const debug = findBestMatch('help me debug this code issue', [
    { name: 'debug-tool', desc: '代码调试分析错误诊断' },
    { name: 'other', desc: 'general helper only' },
  ]);
  assert.ok(debug);
  assert.equal(debug.name, 'debug-tool');
});

test('mutation: scoring threshold boundaries stay stable', () => {
  const exactOverlap = findBestMatch('deploy to production environment', [
    { name: 'deploy', desc: 'deploy production server application' },
  ]);
  assert.ok(exactOverlap);
  assert.equal(exactOverlap.name, 'deploy');

  const longPrompt = 'please deploy this thing for me now';
  assert.ok(findBestMatch(longPrompt, [{ name: 'deploy', desc: 'deploy application' }]));
  assert.equal(findBestMatch('deploy it', [{ name: 'deploy', desc: 'deploy application' }]), null);
});

test('findBestMcpMatch: matches MCP servers by keyword overlap', () => {
  const servers = [
    { name: 'chrome-devtools', desc: '控制真实 Chrome 浏览器，截图，DOM 操作' },
    { name: 'context7', desc: '文档检索库文档查询API文档' },
  ];
  assert.equal(findBestMcpMatch('帮我截图当前页面', servers).name, 'chrome-devtools');
  assert.equal(findBestMcpMatch('查一下 React 的文档', servers).name, 'context7');
  assert.equal(findBestMcpMatch('帮我写一首诗', [{ name: 'chrome-devtools', desc: '控制浏览器截图' }]), null);
  assert.equal(findBestMcpMatch('anything', []), null);
});
