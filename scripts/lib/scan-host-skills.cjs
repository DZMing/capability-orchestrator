'use strict';

const os = require('os');
const path = require('path');
const {
  getDescription,
  getName,
  extractFrontmatter,
  isSymlink,
  tryReadDir,
  tryReadHead,
  withCapabilityMeta,
} = require('./scan-text.cjs');

function getCurrentPlatformAliases() {
  if (process.platform === 'darwin') return new Set(['macos', 'darwin']);
  if (process.platform === 'win32') return new Set(['windows', 'win32']);
  return new Set(['linux']);
}

function parsePlatformList(rawValue) {
  if (!rawValue) return [];
  const value = String(rawValue).trim();
  if (!value) return [];
  const normalized = value
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, '').toLowerCase())
    .filter(Boolean);
  return [...new Set(normalized)];
}

function extractOpenClawOs(content) {
  if (!content) return [];
  const direct = content.match(/^metadata\.openclaw\.os:\s*(.+)$/m);
  if (direct) return parsePlatformList(direct[1]);

  const lines = content.split(/\r?\n/);
  let inMetadata = false;
  let metadataIndent = -1;
  let inOpenClaw = false;
  let openClawIndent = -1;

  for (const line of lines) {
    const indent = (line.match(/^\s*/) || [''])[0].length;
    const trimmed = line.trim();

    if (!trimmed) continue;

    if (/^metadata:\s*$/.test(trimmed)) {
      inMetadata = true;
      metadataIndent = indent;
      inOpenClaw = false;
      continue;
    }

    if (inMetadata && indent <= metadataIndent) {
      inMetadata = false;
      inOpenClaw = false;
    }

    if (!inMetadata) continue;

    if (/^openclaw:\s*$/.test(trimmed)) {
      inOpenClaw = true;
      openClawIndent = indent;
      continue;
    }

    if (inOpenClaw && indent <= openClawIndent) {
      inOpenClaw = false;
    }

    if (inOpenClaw) {
      const osMatch = trimmed.match(/^os:\s*(.+)$/);
      if (osMatch) return parsePlatformList(osMatch[1]);
    }
  }

  return [];
}

function extractSupportedPlatforms(content, source) {
  const fm = extractFrontmatter(content);
  if (source === 'hermes') return parsePlatformList(fm.platforms);
  if (source === 'openclaw') return extractOpenClawOs(content);
  return [];
}

function isPlatformCompatible(content, source) {
  const declared = extractSupportedPlatforms(content, source);
  if (declared.length === 0) return true;
  const aliases = getCurrentPlatformAliases();
  return declared.some((item) => aliases.has(item));
}

function scanCompatibleSkills(dir, source, errors, meta = {}) {
  const results = [];
  for (const dirent of tryReadDir(dir, true, errors)) {
    if (dirent.name.startsWith('.') || !dirent.isDirectory()) continue;
    const fullPath = path.join(dir, dirent.name);
    if (isSymlink(fullPath)) continue;
    const content = tryReadHead(path.join(fullPath, 'SKILL.md'), errors);
    if (content === null) continue;
    if (!isPlatformCompatible(content, source)) continue;
    const name = getName(content, dirent.name);
    const desc = getDescription(content);
    const filePath = path.join(fullPath, 'SKILL.md');
    results.push(withCapabilityMeta(
      { name, desc, filePath },
      { host: source, surfaceType: 'skill', state: 'enabled', source, ...meta }
    ));
  }
  return results;
}

function getOpenClawSkillDir() {
  const root = process.env.OPENCLAW_USER_DIR || path.join(os.homedir(), '.openclaw');
  return path.join(root, 'workspace', 'skills');
}

function getHermesSkillDir() {
  const root = process.env.HERMES_USER_DIR || path.join(os.homedir(), '.hermes');
  return path.join(root, 'skills');
}

module.exports = {
  getCurrentPlatformAliases,
  parsePlatformList,
  extractOpenClawOs,
  extractSupportedPlatforms,
  isPlatformCompatible,
  scanCompatibleSkills,
  getOpenClawSkillDir,
  getHermesSkillDir,
};
