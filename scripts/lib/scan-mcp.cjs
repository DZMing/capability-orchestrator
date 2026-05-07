'use strict';

const path = require('path');
const {
  sanitize,
  tryRead,
} = require('./scan-text.cjs');

function safeToolName(name) {
  const cleaned = sanitize(name || '');
  return /^[a-zA-Z0-9_-]+$/.test(cleaned) ? cleaned : cleaned.replace(/[^a-zA-Z0-9_-]/g, '');
}

function hasSecretLike(value) {
  return /(token|secret|api[_-]?key|authorization|bearer|password|credential|密码|凭证|密钥)/i.test(String(value || ''));
}

function inferMcpMetadata(name, server = {}, meta = {}) {
  const desc = String(server.description || server.desc || '');
  const hasRemoteEndpoint = !!(server.url || server.endpoint || server.httpUrl || server.sseUrl)
    || /^(http|sse|websocket|ws)$/i.test(String(server.transport || ''));
  const transport = hasRemoteEndpoint ? 'remote' : 'local';
  const authSource = JSON.stringify({
    env: server.env || {},
    headers: server.headers || {},
    auth: server.auth || server.authorization || '',
  });
  const mayWrite = /(write|create|update|delete|mutate|upload|send|post|修改|删除|写入|创建|上传|发送)/i.test(`${name} ${desc}`);
  const safeName = safeToolName(name);
  return {
    host: meta.host || 'unknown',
    source: meta.source || 'unknown',
    scope: meta.scope || 'unknown',
    surfaceType: 'mcp',
    invocation: `mcp__${safeName}__*`,
    transport,
    authRequired: hasSecretLike(authSource),
    mayWrite,
    externalAccess: transport === 'remote',
  };
}

function extractServers(json, meta = {}) {
  const servers = json.mcpServers || json.mcp_servers || {};
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return [];
  return Object.entries(servers)
    .filter(([, v]) => v && v.disabled !== true)
    .map(([name, v]) => ({
      name: sanitize(name),
      desc: (v && v.description) || '',
      ...inferMcpMetadata(name, v, meta),
    }));
}

function stripJsonLineComments(content) {
  return content.split('\n').map(line => {
    let inStr = false;
    for (let i = 0; i < line.length - 1; i++) {
      if (line[i] === '"') {
        let bs = 0;
        for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) bs++;
        if (bs % 2 === 0) inStr = !inStr;
      }
      if (!inStr && line[i] === '/' && line[i + 1] === '/') return line.slice(0, i).trimEnd();
    }
    return line;
  }).join('\n');
}

function readMcpServers(mcpFile, errors, meta = {}) {
  const content = tryRead(mcpFile, errors);
  if (!content) return [];

  try {
    return extractServers(JSON.parse(content), meta);
  } catch {
    try {
      return extractServers(JSON.parse(stripJsonLineComments(content)), meta);
    } catch {
      if (errors) errors.push(`${path.basename(mcpFile)} 解析失败（非标准 JSON？）`);
      return [];
    }
  }
}

module.exports = {
  readMcpServers,
  stripJsonLineComments,
  inferMcpMetadata,
  safeToolName,
};
