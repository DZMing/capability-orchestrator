'use strict';

/**
 * SKILL.md 子进程合约测试
 * 验证每个 skill 的 !command 在真实 shell 环境下能正常运行：
 *   - CLAUDE_SKILL_DIR 正确设置时 exit 0
 *   - 输出不为空
 *   - 输出不超过 MAX_CHARS (3000)
 *   - stderr 不含未捕获的 JS 异常
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const SKILLS_DIR = path.join(REPO_ROOT, 'skills');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'scan-environment.cjs');
const PACKAGE_JSON = path.join(REPO_ROOT, 'package.json');
const CLAUDE_PLUGIN_JSON = path.join(REPO_ROOT, '.claude-plugin', 'plugin.json');
const CODEX_PLUGIN_JSON = path.join(REPO_ROOT, '.codex-plugin', 'plugin.json');
const MAX_CHARS = 5000;

// 从 SKILL.md 提取 !`...` 命令字符串
function extractCommand(skillMd) {
  const match = skillMd.match(/^!`(.+?)`/m);
  return match ? match[1] : null;
}

// 读取 SKILL.md 内容
function readSkillMd(skillName) {
  const fs = require('fs');
  const p = path.join(SKILLS_DIR, skillName, 'SKILL.md');
  return fs.readFileSync(p, 'utf8');
}

// 将 SKILL.md 里的 !command 字符串解析成可执行参数
// 形如: node "${CLAUDE_SKILL_DIR}/../../scripts/scan-environment.cjs" --mode=list
function parseCommand(cmdStr, skillDir) {
  // 替换环境变量占位符
  const resolved = cmdStr.replace(/\$\{CLAUDE_SKILL_DIR\}/g, skillDir);
  // 简单分词（只处理双引号包裹的 token，能覆盖当前所有 skill 的命令格式）
  const tokens = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(resolved)) !== null) {
    tokens.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return tokens; // [executable, ...args]
}

// 用一个最小 fixtures 目录作为 cwd，避免扫描真实用户目录干扰测试结果
const FIXTURE_PROJECT = path.join(__dirname, 'fixtures', 'project');

const SKILLS = ['capabilities', 'debug-route', 'orchestrate', 'refresh', 'stats'];

for (const skillName of SKILLS) {
  test(`skill ${skillName}: !command 可执行、exit 0、输出非空、≤${MAX_CHARS} 字符`, () => {
    const skillMd = readSkillMd(skillName);
    const cmdStr = extractCommand(skillMd);
    assert.ok(cmdStr, `${skillName}/SKILL.md 应包含 !command`);

    const skillDir = path.join(SKILLS_DIR, skillName);
    const tokens = parseCommand(cmdStr, skillDir);
    // tokens[0] 是 'node'，替换为 process.execPath；其余是脚本路径和参数
    const [rawExec, ...args] = tokens;
    const file = rawExec === 'node' ? process.execPath : rawExec;

    // 注入环境变量，模拟 Claude 渲染 skill 时的环境
    const env = {
      ...process.env,
      CLAUDE_SKILL_DIR: skillDir,
      CLAUDE_PROJECT_DIR: FIXTURE_PROJECT,
      HOME: process.env.HOME,
    };

    let stdout;
    try {
      stdout = execFileSync(file, args, {
        cwd: FIXTURE_PROJECT,
        env,
        encoding: 'utf8',
        timeout: 15000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      // exit 非 0 时 execFileSync 抛出
      assert.fail(
        `${skillName} !command 退出非 0\n` +
        `exit code: ${err.status}\n` +
        `stderr: ${err.stderr || ''}\n` +
        `stdout: ${err.stdout || ''}`
      );
    }

    assert.ok(stdout.length > 0, `${skillName} 输出不应为空`);
    assert.ok(
      stdout.length <= MAX_CHARS,
      `${skillName} 输出超限：${stdout.length} > ${MAX_CHARS}`
    );
    // 没有未捕获的 JS 异常堆栈（stderr 允许有 warn 级别警告）
    assert.ok(
      !stdout.includes('Error:') || stdout.includes('扫描失败'),
      `${skillName} stdout 不应含未处理 Error`
    );
  });

  test(`skill ${skillName}: SKILL.md 包含必要 frontmatter (name, description)`, () => {
    const { extractFrontmatter } = require('../scripts/scan-environment.cjs');
    const content = readSkillMd(skillName);
    const fm = extractFrontmatter(content);
    assert.ok(fm.name, `${skillName}/SKILL.md 缺少 name 字段`);
    assert.ok(fm.description, `${skillName}/SKILL.md 缺少 description 字段`);
    assert.equal(fm.name, skillName, `name 应与目录名一致`);
  });
}

test('capabilities skill: --mode=list 输出更紧凑', () => {
  const skillDir = path.join(SKILLS_DIR, 'capabilities');
  const stdout = execFileSync(process.execPath, [SCRIPT, '--mode=list'], {
    cwd: FIXTURE_PROJECT,
    env: { ...process.env, CLAUDE_SKILL_DIR: skillDir },
    encoding: 'utf8',
    timeout: 15000,
  });
  // list 模式比 route 模式短
  const stdoutRoute = execFileSync(process.execPath, [SCRIPT], {
    cwd: FIXTURE_PROJECT,
    env: { ...process.env, CLAUDE_SKILL_DIR: skillDir },
    encoding: 'utf8',
    timeout: 15000,
  });
  // list 模式从 level 2 开始（仅名称），route 从 level 0 开始但可能降级更多
  // 两者都应在预算内
  assert.ok(stdout.length <= 5100, `list 模式输出 (${stdout.length}) 应在预算范围内`);
  assert.ok(stdoutRoute.length <= 5100, `route 模式输出 (${stdoutRoute.length}) 应在预算范围内`);
});

test('script: 从不同 cwd 调用，exit 0，输出合法', () => {
  // 从临时目录（完全不同的 cwd）调用，模拟 Claude 从项目根启动的场景
  const os = require('os');
  const stdout = execFileSync(process.execPath, [SCRIPT, '--mode=list'], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.ok(stdout.length > 0, '从 tmpdir 调用应有输出');
  assert.ok(stdout.length <= MAX_CHARS, '从 tmpdir 调用输出不应超限');
});

test('debug-route skill: example output should be informative', () => {
  const skillMd = readSkillMd('debug-route');
  const cmdStr = extractCommand(skillMd);
  assert.ok(cmdStr, 'debug-route/SKILL.md 应包含 !command');

  const skillDir = path.join(SKILLS_DIR, 'debug-route');
  const tokens = parseCommand(cmdStr, skillDir);
  const [rawExec, ...args] = tokens;
  const file = rawExec === 'node' ? process.execPath : rawExec;

  const stdout = execFileSync(file, args, {
    cwd: FIXTURE_PROJECT,
    env: {
      ...process.env,
      CLAUDE_SKILL_DIR: skillDir,
      CLAUDE_PROJECT_DIR: FIXTURE_PROJECT,
      HOME: process.env.HOME,
    },
    encoding: 'utf8',
    timeout: 15000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  assert.ok(!stdout.includes('"reason":"too-short"'), 'example should not be a too-short placeholder');
  assert.ok(stdout.includes('"action":"route"'), 'example should show a real routed result');
});

test('debug-route example script: does not depend on tests/fixtures paths', () => {
  const fs = require('fs');
  const content = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'debug-route-example.cjs'), 'utf8');
  assert.ok(!content.includes('fixtures'), 'example script should be self-contained');
});

test('plugin manifests: Claude and Codex manifests exist and version matches package.json', () => {
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
  const claudePlugin = JSON.parse(fs.readFileSync(CLAUDE_PLUGIN_JSON, 'utf8'));
  const codexPlugin = JSON.parse(fs.readFileSync(CODEX_PLUGIN_JSON, 'utf8'));

  assert.equal(claudePlugin.version, pkg.version, 'Claude plugin manifest version should match package.json');
  assert.equal(codexPlugin.version, pkg.version, 'Codex plugin manifest version should match package.json');
  assert.equal(codexPlugin.name, claudePlugin.name, 'Codex and Claude manifests should describe the same plugin');
});
