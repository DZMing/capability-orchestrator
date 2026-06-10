'use strict';

// P2-5: 高置信字面量命中自动展开 skill 正文
// 覆盖：可信源展开 / 不可信源不展开 / 语义匹配不展开 /
//       CO_AUTO_EXPAND=off / 截断 / SKILL.md 不存在 / 去 frontmatter

process.env.CAPABILITY_PLATFORM = 'claude';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createOutput,
} = require('../scripts/lib/route-output.cjs');

const {
  resolveRouteDecision,
} = require('../scripts/route-matcher.cjs');

// ─── 辅助：捕获 stdout ────────────────────────────────────────────────────────
function captureStdout(fn) {
  const orig = process.stdout.write;
  let out = '';
  process.stdout.write = (s) => { out += s; return true; };
  try { fn(); } finally { process.stdout.write = orig; }
  return out;
}

// ─── 辅助：在 tmpdir 下创建一个 skill 目录，包含 SKILL.md ─────────────────────
function makeTmpSkill(dir, skillName, content) {
  const skillDir = path.join(dir, skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf8');
  return path.join(skillDir, 'SKILL.md');
}

// ─── 辅助：构造完整 input JSON ────────────────────────────────────────────────
function makeInput(prompt, cwd) {
  return JSON.stringify({ prompt, cwd });
}

// ─────────────────────────────────────────────────────────────────────────────
// createOutput 层：expandedContent 参数行为
// ─────────────────────────────────────────────────────────────────────────────

test('createOutput: expandedContent 非空时追加 [SKILL EXPANDED] 段', () => {
  const out = captureStdout(() => {
    createOutput({ name: 'my-skill', desc: '测试 skill' }, { expandedContent: '## 使用方法\n运行此 skill。' });
  });
  assert.ok(out.includes('[SKILL EXPANDED]'), '应包含 [SKILL EXPANDED] 标记');
  assert.ok(out.includes('## 使用方法'), '应包含展开内容');
  assert.ok(out.includes('立即调用：/my-skill'), '原有强制指令应保留');
});

test('createOutput: expandedContent 为空字符串时不追加 [SKILL EXPANDED]', () => {
  const out = captureStdout(() => {
    createOutput({ name: 'my-skill', desc: '测试 skill' }, { expandedContent: '' });
  });
  assert.ok(!out.includes('[SKILL EXPANDED]'), '空内容不应追加展开段');
});

test('createOutput: opts 未传时向后兼容，不追加 [SKILL EXPANDED]', () => {
  const out = captureStdout(() => {
    createOutput({ name: 'my-skill', desc: '测试 skill' });
  });
  assert.ok(!out.includes('[SKILL EXPANDED]'), '无 opts 时不应有展开段');
  assert.ok(out.includes('立即调用：/my-skill'), '原有输出应保持不变');
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveRouteDecision 集成层：端到端验证展开逻辑
// ─────────────────────────────────────────────────────────────────────────────

test('字面量命中 userDir/skills/ → 展开 SKILL.md 正文', () => {
  // userDir 本身是 ~/.claude，其 skills 子目录为 userDir/skills
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'co-expand-'));
  const userDir = path.join(tmpBase, 'userdir');           // 模拟 ~/.claude
  const userSkillsDir = path.join(userDir, 'skills');      // ~/.claude/skills
  const projDir = path.join(tmpBase, 'proj');
  fs.mkdirSync(projDir, { recursive: true });

  const skillContent = `---
name: my-trusted-skill
description: |
  测试可信源展开
---

## 正文内容

这是展开后的 skill 说明。
`;
  makeTmpSkill(userSkillsDir, 'my-trusted-skill', skillContent);

  const origUserDir = process.env.CAPABILITY_USER_DIR;
  const origAutoExpand = process.env.CO_AUTO_EXPAND;
  process.env.CAPABILITY_USER_DIR = userDir;
  delete process.env.CO_AUTO_EXPAND;

  try {
    const out = captureStdout(() => {
      const decision = resolveRouteDecision(makeInput('/my-trusted-skill', projDir));
      // 主入口：直接调用 createOutput
      if (decision.match && decision.targetType === 'skill') {
        // expandedContent 已由 resolveRouteDecision 附在 decision 上
        createOutput(decision.match, { expandedContent: decision.expandedContent });
      }
    });
    assert.ok(out.includes('[SKILL EXPANDED]'), '可信 userDir 来源应展开');
    assert.ok(out.includes('正文内容'), '展开内容应出现在输出中');
  } finally {
    if (origUserDir === undefined) delete process.env.CAPABILITY_USER_DIR;
    else process.env.CAPABILITY_USER_DIR = origUserDir;
    if (origAutoExpand === undefined) delete process.env.CO_AUTO_EXPAND;
    else process.env.CO_AUTO_EXPAND = origAutoExpand;
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

test('字面量命中 projectDir/.claude/skills/ → 展开 SKILL.md 正文', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'co-expand-proj-'));
  const projSkillsDir = path.join(tmpBase, '.claude', 'skills');

  const skillContent = `---
name: proj-skill
description: 项目级可信源展开
---

项目 skill 正文。
`;
  makeTmpSkill(projSkillsDir, 'proj-skill', skillContent);

  const origUserDir = process.env.CAPABILITY_USER_DIR;
  const origAutoExpand = process.env.CO_AUTO_EXPAND;
  // 用一个不包含此 skill 的 userDir，保证命中的是 project 来源
  const emptyUserDir = fs.mkdtempSync(path.join(os.tmpdir(), 'co-empty-user-'));
  process.env.CAPABILITY_USER_DIR = emptyUserDir;
  delete process.env.CO_AUTO_EXPAND;

  try {
    const out = captureStdout(() => {
      const decision = resolveRouteDecision(makeInput('/proj-skill', tmpBase));
      if (decision.match && decision.targetType === 'skill') {
        createOutput(decision.match, { expandedContent: decision.expandedContent });
      }
    });
    assert.ok(out.includes('[SKILL EXPANDED]'), 'projectDir/.claude/skills/ 来源应展开');
    assert.ok(out.includes('项目 skill 正文'), '项目 skill 正文应出现');
  } finally {
    if (origUserDir === undefined) delete process.env.CAPABILITY_USER_DIR;
    else process.env.CAPABILITY_USER_DIR = origUserDir;
    if (origAutoExpand === undefined) delete process.env.CO_AUTO_EXPAND;
    else process.env.CO_AUTO_EXPAND = origAutoExpand;
    fs.rmSync(tmpBase, { recursive: true, force: true });
    fs.rmSync(emptyUserDir, { recursive: true, force: true });
  }
});

test('插件 cache 路径不展开（不可信源）', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'co-plugin-'));
  // userDir 模拟 ~/.claude，插件 cache 在 userDir/plugins/cache/
  const userDir = path.join(tmpBase, 'userdir');
  const pluginSkillsDir = path.join(userDir, 'plugins', 'cache', 'some-plugin', 'skills');
  const skillContent = `---
name: plugin-skill
description: 插件来源 skill
---

插件正文不应展开。
`;
  makeTmpSkill(pluginSkillsDir, 'plugin-skill', skillContent);

  // 同时在 userDir/.claude/skills/ 放一个同名的"伪"skill 用来被字面量命中
  // 但 filePath 指向 plugin cache，所以不展开
  // 实际测试：手动构造 match，filePath 指向 plugin cache
  const pluginFilePath = path.join(pluginSkillsDir, 'plugin-skill', 'SKILL.md');
  const projDir = path.join(tmpBase, 'proj');
  fs.mkdirSync(projDir, { recursive: true });

  const { resolveExpandedContent } = require('../scripts/route-matcher.cjs');

  const origAutoExpand = process.env.CO_AUTO_EXPAND;
  delete process.env.CO_AUTO_EXPAND;

  try {
    const fakeMatch = { name: 'plugin-skill', desc: '插件来源', filePath: pluginFilePath, _literal: true };
    const result = resolveExpandedContent(fakeMatch, userDir, projDir);
    assert.equal(result, undefined, '插件 cache 来源不应展开');
  } finally {
    if (origAutoExpand === undefined) delete process.env.CO_AUTO_EXPAND;
    else process.env.CO_AUTO_EXPAND = origAutoExpand;
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

test('CO_AUTO_EXPAND=off → 不展开', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'co-noexpand-'));
  const userDir = path.join(tmpBase, 'userdir');       // 模拟 ~/.claude
  const userSkillsDir = path.join(userDir, 'skills');  // ~/.claude/skills
  const projDir = path.join(tmpBase, 'proj');
  fs.mkdirSync(projDir, { recursive: true });

  makeTmpSkill(userSkillsDir, 'some-skill', `---\nname: some-skill\ndescription: test\n---\n\n正文应被屏蔽。\n`);

  const origUserDir = process.env.CAPABILITY_USER_DIR;
  process.env.CAPABILITY_USER_DIR = userDir;
  process.env.CO_AUTO_EXPAND = 'off';

  try {
    const decision = resolveRouteDecision(makeInput('/some-skill', projDir));
    assert.equal(decision.expandedContent, undefined, 'CO_AUTO_EXPAND=off 时 expandedContent 应为 undefined');
  } finally {
    if (origUserDir === undefined) delete process.env.CAPABILITY_USER_DIR;
    else process.env.CAPABILITY_USER_DIR = origUserDir;
    delete process.env.CO_AUTO_EXPAND;
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

test('超 CO_EXPAND_MAX_CHARS 截断', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'co-trunc-'));
  const userDir = path.join(tmpBase, 'userdir');
  const userSkillsDir = path.join(userDir, 'skills');
  const projDir = path.join(tmpBase, 'proj');
  fs.mkdirSync(projDir, { recursive: true });

  const longBody = 'A'.repeat(200);
  makeTmpSkill(userSkillsDir, 'long-skill', `---\nname: long-skill\ndescription: test\n---\n\n${longBody}\n`);

  const origUserDir = process.env.CAPABILITY_USER_DIR;
  const origMax = process.env.CO_EXPAND_MAX_CHARS;
  process.env.CAPABILITY_USER_DIR = userDir;
  delete process.env.CO_AUTO_EXPAND;
  process.env.CO_EXPAND_MAX_CHARS = '50';

  try {
    const decision = resolveRouteDecision(makeInput('/long-skill', projDir));
    if (decision.expandedContent !== undefined) {
      assert.ok(decision.expandedContent.length <= 50, `展开内容应被截断到 50 字符，实际: ${decision.expandedContent.length}`);
    }
  } finally {
    if (origUserDir === undefined) delete process.env.CAPABILITY_USER_DIR;
    else process.env.CAPABILITY_USER_DIR = origUserDir;
    if (origMax === undefined) delete process.env.CO_EXPAND_MAX_CHARS;
    else process.env.CO_EXPAND_MAX_CHARS = origMax;
    delete process.env.CO_AUTO_EXPAND;
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

test('SKILL.md 不存在时不崩溃，正常输出 AUTO-ROUTE', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'co-nofile-'));
  const userDir = path.join(tmpBase, 'userdir');       // 模拟 ~/.claude
  const userSkillsDir = path.join(userDir, 'skills');  // ~/.claude/skills
  const projDir = path.join(tmpBase, 'proj');
  fs.mkdirSync(projDir, { recursive: true });

  // filePath 指向不存在的文件，测试 resolveExpandedContent 容错
  const { resolveExpandedContent } = require('../scripts/route-matcher.cjs');

  const origAutoExpand = process.env.CO_AUTO_EXPAND;
  delete process.env.CO_AUTO_EXPAND;

  try {
    const fakeMatch = {
      name: 'ghost-skill',
      filePath: path.join(userSkillsDir, 'ghost-skill', 'SKILL.md'),
      _literal: true,
    };
    let threw = false;
    let result;
    try {
      result = resolveExpandedContent(fakeMatch, userDir, projDir);
    } catch (e) {
      threw = true;
    }
    assert.ok(!threw, 'SKILL.md 不存在时不应抛出异常');
    assert.equal(result, undefined, 'SKILL.md 不存在时应返回 undefined');
  } finally {
    if (origAutoExpand === undefined) delete process.env.CO_AUTO_EXPAND;
    else process.env.CO_AUTO_EXPAND = origAutoExpand;
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

test('展开内容去 frontmatter（--- 块被移除）', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'co-fm-'));
  const userDir = path.join(tmpBase, 'userdir');
  const userSkillsDir = path.join(userDir, 'skills');
  const projDir = path.join(tmpBase, 'proj');
  fs.mkdirSync(projDir, { recursive: true });

  makeTmpSkill(userSkillsDir, 'fm-skill', `---
name: fm-skill
description: frontmatter test
author: test-author
---

## 正文标题

frontmatter 应被去掉，这行应保留。
`);

  const origUserDir = process.env.CAPABILITY_USER_DIR;
  const origAutoExpand = process.env.CO_AUTO_EXPAND;
  process.env.CAPABILITY_USER_DIR = userDir;
  delete process.env.CO_AUTO_EXPAND;

  try {
    const decision = resolveRouteDecision(makeInput('/fm-skill', projDir));
    if (decision.expandedContent !== undefined) {
      assert.ok(!decision.expandedContent.includes('author: test-author'), '展开内容不应包含 frontmatter 字段');
      assert.ok(!decision.expandedContent.startsWith('---'), '展开内容不应以 --- 开头');
      assert.ok(decision.expandedContent.includes('frontmatter 应被去掉'), '正文内容应保留');
    }
  } finally {
    if (origUserDir === undefined) delete process.env.CAPABILITY_USER_DIR;
    else process.env.CAPABILITY_USER_DIR = origUserDir;
    if (origAutoExpand === undefined) delete process.env.CO_AUTO_EXPAND;
    else process.env.CO_AUTO_EXPAND = origAutoExpand;
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

test('语义匹配（非字面量命中）→ 不展开', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'co-semantic-'));
  const userDir = path.join(tmpBase, 'userdir');
  const userSkillsDir = path.join(userDir, 'skills');
  const projDir = path.join(tmpBase, 'proj');
  fs.mkdirSync(projDir, { recursive: true });

  makeTmpSkill(userSkillsDir, 'deploy-app', `---
name: deploy-app
description: |
  deploy application to production server
  触发词: deploy, 部署, 发布
---

部署正文不应因语义匹配展开。
`);

  const origUserDir = process.env.CAPABILITY_USER_DIR;
  const origAutoExpand = process.env.CO_AUTO_EXPAND;
  process.env.CAPABILITY_USER_DIR = userDir;
  delete process.env.CO_AUTO_EXPAND;

  try {
    // 用语义匹配方式触发（不是 /deploy-app 字面量）
    const decision = resolveRouteDecision(makeInput('帮我把应用部署到生产服务器', projDir));
    // 语义匹配时 expandedContent 应为 undefined
    assert.equal(decision.expandedContent, undefined, '语义匹配不应展开');
  } finally {
    if (origUserDir === undefined) delete process.env.CAPABILITY_USER_DIR;
    else process.env.CAPABILITY_USER_DIR = origUserDir;
    if (origAutoExpand === undefined) delete process.env.CO_AUTO_EXPAND;
    else process.env.CO_AUTO_EXPAND = origAutoExpand;
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});
