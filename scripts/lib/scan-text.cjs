'use strict';

const fs = require('fs');
const path = require('path');

const MAX_DESC = 100;
const HEAD_BYTES = 2048;
const UNSAFE_UNICODE = /[\u200B\u200C\u200D\uFEFF\u00AD\u2060\u180E\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C\u2061-\u2064\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFF9-\uFFFB]/g;

function withCapabilityMeta(entity, meta = {}) {
  return { ...entity, ...meta };
}

function tryRead(filePath, errors) {
  try { return fs.readFileSync(filePath, 'utf8'); }
  catch (e) {
    if (e.code !== 'ENOENT' && errors) errors.push(`读取 ${path.basename(filePath)}: ${e.code}`);
    return null;
  }
}

function tryReadHead(filePath, errors) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    let str = buf.toString('utf8', 0, bytesRead);
    str = str.replace(/\uFFFD+$/, '');
    return str;
  } catch (e) {
    if (e.code !== 'ENOENT' && errors) errors.push(`读取 ${path.basename(filePath)}: ${e.code}`);
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function tryReadDir(dirPath, withTypes, errors) {
  try {
    return withTypes
      ? fs.readdirSync(dirPath, { withFileTypes: true })
      : fs.readdirSync(dirPath);
  } catch (e) {
    if (e.code !== 'ENOENT' && errors) errors.push(`列目录 ${path.basename(dirPath)}: ${e.code}`);
    return [];
  }
}

function truncate(str, max) {
  if (!str) return '';
  str = String(str).replace(/\r?\n/g, ' ').trim();
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function compareSemver(a, b) {
  const pa = a.replace(/^v/i, '').split('.').map(v => Number(v) || 0);
  const pb = b.replace(/^v/i, '').split('.').map(v => Number(v) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function sanitize(str) {
  if (!str) return '';
  return String(str)
    .replace(/\r?\n|\r/g, ' ')
    .replace(UNSAFE_UNICODE, '')
    .replace(/`/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/<[^>]*>?/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(^| )#{1,6} /g, '$1')
    .trim();
}

function extractFrontmatter(content) {
  if (!content) return {};
  content = content.replace(/^\uFEFF/, '');
  const result = {};
  const blockRe = /(?:^|\n)---[ \t]*\r?\n([\s\S]*?)\r?\n---/g;
  let blockMatch;
  while ((blockMatch = blockRe.exec(content)) !== null) {
    const lines = blockMatch[1].split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\w[\w-]*):\s*(.*?)\s*$/);
      if (!m) continue;
      const key = m[1];
      const rawVal = m[2];
      if (/^[>|][-+]?$/.test(rawVal)) {
        const blockLines = [];
        while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
          blockLines.push(lines[++i].trimStart());
        }
        result[key] = rawVal.startsWith('>')
          ? blockLines.join(' ').trim()
          : blockLines.join('\n').trim();
      } else {
        result[key] = rawVal.replace(/^["']|["']$/g, '').trim();
      }
    }
  }
  return result;
}

function getDescription(content) {
  const fm = extractFrontmatter(content);
  if (fm.description) return sanitize(truncate(fm.description, MAX_DESC));
  if (!content) return '';
  const afterFm = content.replace(/(?:^|\n)---[ \t]*\r?\n[\s\S]*?\r?\n---/g, '');
  const firstPara = afterFm
    .split('\n')
    .find(l => l.trim() && !l.startsWith('#') && !/^---\s*$/.test(l));
  return sanitize(truncate(firstPara || '', MAX_DESC));
}

function getName(content, fallback) {
  const fm = extractFrontmatter(content);
  return sanitize((fm.name || fallback || '').trim());
}

function isSymlink(filePath, errors) {
  try { return fs.lstatSync(filePath).isSymbolicLink(); }
  catch (e) {
    if (errors && e.code !== 'ENOENT') errors.push(`lstat ${path.basename(filePath)}: ${e.code}`);
    return true;
  }
}

module.exports = {
  MAX_DESC,
  HEAD_BYTES,
  tryRead,
  tryReadHead,
  tryReadDir,
  truncate,
  compareSemver,
  sanitize,
  extractFrontmatter,
  getDescription,
  getName,
  isSymlink,
  withCapabilityMeta,
};
