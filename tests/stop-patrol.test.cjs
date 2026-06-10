'use strict';

// stop-patrol.test.cjs — Stop hook 收尾检查集成测试
// 覆盖:防死循环放行 + 烂尾 block + 噪音过滤 + 开关 + 故障开放

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ENTRY = path.join(__dirname, '..', 'scripts', 'stop-patrol.cjs');

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function makeGitRepo() {
  const dir = makeTmpDir('co-stop-');
  git(dir, ['init', '-q', '-b', 'master']);
  git(dir, ['config', 'user.email', 'test@test.local']);
  git(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'init\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

function runStop(input, env = {}) {
  return execFileSync(process.execPath, [ENTRY], {
    encoding: 'utf8',
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...process.env, CO_STOP_PATROL: undefined, ...env },
    timeout: 15000,
  });
}

test('stop_hook_active=true:即使工作区脏也必须放行(防死循环硬规则)', () => {
  const dir = makeGitRepo();
  fs.writeFileSync(path.join(dir, 'dirty.js'), 'x\n');
  const out = runStop({ cwd: dir, stop_hook_active: true });
  assert.strictEqual(out.trim(), '');
});

test('CO_STOP_PATROL=off:一键关闭,直接放行', () => {
  const dir = makeGitRepo();
  fs.writeFileSync(path.join(dir, 'dirty.js'), 'x\n');
  const out = runStop({ cwd: dir, stop_hook_active: false }, { CO_STOP_PATROL: 'off' });
  assert.strictEqual(out.trim(), '');
});

test('干净 repo:无烂尾,放行', () => {
  const dir = makeGitRepo();
  const out = runStop({ cwd: dir, stop_hook_active: false });
  assert.strictEqual(out.trim(), '');
});

test('工作区有真实脏文件:输出 block JSON,reason 含 [PATROL] 与收尾指引', () => {
  const dir = makeGitRepo();
  fs.writeFileSync(path.join(dir, 'feature.js'), 'half done\n');
  const out = runStop({ cwd: dir, stop_hook_active: false });
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.decision, 'block');
  assert.ok(parsed.reason.includes('[PATROL]'));
  assert.ok(parsed.reason.includes('未提交'));
  assert.ok(parsed.reason.includes('授权'), 'reason 必须指示按授权分档处理');
});

test('只有运行时噪音脏文件(.omc/ 等):不算烂尾,放行', () => {
  const dir = makeGitRepo();
  fs.mkdirSync(path.join(dir, '.omc'));
  fs.writeFileSync(path.join(dir, '.omc', 'state.json'), '{}\n');
  const out = runStop({ cwd: dir, stop_hook_active: false });
  assert.strictEqual(out.trim(), '');
});

test('本地领先远端(unpushed):算烂尾,block 提示可推送', () => {
  const remote = makeTmpDir('co-stop-remote-');
  git(remote, ['init', '-q', '--bare', '-b', 'master']);
  const dir = makeGitRepo();
  git(dir, ['remote', 'add', 'origin', remote]);
  git(dir, ['push', '-q', '-u', 'origin', 'master']);
  fs.writeFileSync(path.join(dir, 'new.js'), 'x\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'local only']);

  const parsed = JSON.parse(runStop({ cwd: dir, stop_hook_active: false }));
  assert.strictEqual(parsed.decision, 'block');
  assert.ok(parsed.reason.includes('领先'));
});

test('坏 stdin / 非 git 目录:故障开放,放行', () => {
  assert.strictEqual(runStop('{broken json').trim(), '');
  const plain = makeTmpDir('co-stop-plain-');
  assert.strictEqual(runStop({ cwd: plain, stop_hook_active: false }).trim(), '');
});
