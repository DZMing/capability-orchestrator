'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getCurrentPlatformAliases,
  parsePlatformList,
  extractOpenClawOs,
  extractSupportedPlatforms,
  isPlatformCompatible,
  scanCompatibleSkills,
  getOpenClawSkillDir,
  getHermesSkillDir,
} = require('../scripts/lib/scan-host-skills.cjs');

test('parsePlatformList: parses bracketed and quoted values', () => {
  assert.deepEqual(parsePlatformList('[windows, linux]'), ['windows', 'linux']);
  assert.deepEqual(parsePlatformList('["macos", "linux", "linux"]'), ['macos', 'linux']);
  assert.deepEqual(parsePlatformList(''), []);
});

test('extractSupportedPlatforms: reads Hermes platforms and OpenClaw os metadata', () => {
  const hermesSkill = '---\nname: hermes-skill\ndescription: Hermes skill\nplatforms: [macos, linux]\n---\n';
  const openClawSkill = '---\nname: oc-skill\ndescription: OpenClaw skill\nmetadata:\n  openclaw:\n    os: [windows]\n---\n';
  assert.deepEqual(extractSupportedPlatforms(hermesSkill, 'hermes'), ['macos', 'linux']);
  assert.deepEqual(extractSupportedPlatforms(openClawSkill, 'openclaw'), ['windows']);
  assert.deepEqual(extractOpenClawOs('metadata.openclaw.os: [macos, linux]'), ['macos', 'linux']);
});

test('isPlatformCompatible: filters only when metadata excludes current platform', () => {
  const aliases = getCurrentPlatformAliases();
  const current = [...aliases][0];
  assert.equal(isPlatformCompatible(`---\nplatforms: [${current}]\n---\n`, 'hermes'), true);
  assert.equal(isPlatformCompatible('---\nplatforms: [definitely-not-this-os]\n---\n', 'hermes'), false);

  const openClawWindows = '---\nmetadata:\n  openclaw:\n    os: [windows]\n---\n';
  assert.equal(isPlatformCompatible(openClawWindows, 'openclaw'), process.platform === 'win32');
});

test('scanCompatibleSkills: returns enabled host skill metadata and skips incompatible skills', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'host-skills-'));
  try {
    const keep = path.join(tmp, 'keep');
    const skip = path.join(tmp, 'skip');
    fs.mkdirSync(keep, { recursive: true });
    fs.mkdirSync(skip, { recursive: true });
    fs.writeFileSync(path.join(keep, 'SKILL.md'), '---\nname: keep\ndescription: useful host skill\n---\n');
    fs.writeFileSync(path.join(skip, 'SKILL.md'), '---\nname: skip\ndescription: no\nplatforms: [definitely-not-this-os]\n---\n');
    const skills = scanCompatibleSkills(tmp, 'hermes', [], { invocation: 'slash' });
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, 'keep');
    assert.equal(skills[0].host, 'hermes');
    assert.equal(skills[0].surfaceType, 'skill');
    assert.equal(skills[0].state, 'enabled');
    assert.equal(skills[0].invocation, 'slash');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('host skill dir helpers honor environment overrides', () => {
  const savedOpenClaw = process.env.OPENCLAW_USER_DIR;
  const savedHermes = process.env.HERMES_USER_DIR;
  process.env.OPENCLAW_USER_DIR = '/tmp/openclaw-root';
  process.env.HERMES_USER_DIR = '/tmp/hermes-root';
  try {
    assert.equal(getOpenClawSkillDir(), path.join('/tmp/openclaw-root', 'workspace', 'skills'));
    assert.equal(getHermesSkillDir(), path.join('/tmp/hermes-root', 'skills'));
  } finally {
    if (savedOpenClaw === undefined) delete process.env.OPENCLAW_USER_DIR;
    else process.env.OPENCLAW_USER_DIR = savedOpenClaw;
    if (savedHermes === undefined) delete process.env.HERMES_USER_DIR;
    else process.env.HERMES_USER_DIR = savedHermes;
  }
});
