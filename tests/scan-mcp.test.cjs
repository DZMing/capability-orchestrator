'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readMcpServers, stripJsonLineComments } = require('../scripts/lib/scan-mcp.cjs');

const PROJECT_DIR = path.join(__dirname, 'fixtures', 'project');

function withTmpJson(content, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-mcp-'));
  const filePath = path.join(tmp, 'mcp.json');
  fs.writeFileSync(filePath, content);
  try {
    return fn(filePath);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('readMcpServers: reads mcpServers and mcp_servers keys', () => {
  assert.ok(readMcpServers(path.join(PROJECT_DIR, '.mcp.json')).some(s => s.name === 'test-server'));
  assert.deepEqual(readMcpServers('/nonexistent/.mcp.json'), []);

  withTmpJson(JSON.stringify({ mcp_servers: { 'alt-server': { description: 'alt desc' } } }), (filePath) => {
    const servers = readMcpServers(filePath);
    assert.equal(servers[0].name, 'alt-server');
    assert.equal(servers[0].desc, 'alt desc');
  });
});

test('readMcpServers: disabled filtering is strict', () => {
  withTmpJson(JSON.stringify({ mcpServers: {
    a: { disabled: true },
    b: { disabled: false },
    c: { disabled: 0 },
    d: { disabled: '' },
    e: { disabled: null },
    f: {},
  }}), (filePath) => {
    const names = readMcpServers(filePath).map(s => s.name);
    assert.ok(!names.includes('a'));
    for (const name of ['b', 'c', 'd', 'e', 'f']) assert.ok(names.includes(name), `${name} should pass`);
  });
});

test('readMcpServers: invalid or malformed server containers fault open to empty', () => {
  withTmpJson('{bad json!!!}', (filePath) => {
    const errors = [];
    assert.deepEqual(readMcpServers(filePath, errors), []);
    assert.ok(errors.length > 0);
  });
  withTmpJson('{"mcpServers": null}', (filePath) => assert.deepEqual(readMcpServers(filePath), []));
  withTmpJson('{"mcpServers": ["not", "an", "object"]}', (filePath) => assert.deepEqual(readMcpServers(filePath), []));
  withTmpJson('{"mcpServers":"not-an-object"}', (filePath) => assert.deepEqual(readMcpServers(filePath), []));
});

test('readMcpServers: strips line comments without corrupting strings', () => {
  withTmpJson('// comment\n{"mcpServers":{"srv":{}}}\n', (filePath) => {
    assert.equal(readMcpServers(filePath)[0].name, 'srv');
  });
  withTmpJson('{\n  "mcpServers": {\n    "srv": {"url": "https://x.com"} // my server\n  }\n}', (filePath) => {
    assert.equal(readMcpServers(filePath)[0].name, 'srv');
  });
  withTmpJson('{\n  "mcpServers": {\n    "srv": {"description": "see https://example.com/docs"}\n  }\n}', (filePath) => {
    assert.ok(readMcpServers(filePath)[0].desc.includes('https://example.com/docs'));
  });
  withTmpJson('{"mcpServers":{"s":{"command":"node","args":["path\\\\"]}}}\n// comment\n', (filePath) => {
    assert.equal(readMcpServers(filePath)[0].name, 's');
  });
});

test('stripJsonLineComments: preserves URLs and removes true comments', () => {
  const stripped = stripJsonLineComments('{"url":"https://example.com"} // trailing');
  assert.ok(stripped.includes('https://example.com'));
  assert.ok(!stripped.includes('trailing'));
});

test('readMcpServers: preserves advisory trust metadata without executing config', () => {
  withTmpJson(JSON.stringify({
    mcpServers: {
      local: {
        command: 'node',
        args: ['server.js'],
        description: 'local readonly docs helper',
      },
      remote: {
        url: 'https://api.example.com/mcp',
        headers: { Authorization: 'Bearer ${TOKEN}' },
        description: 'create update customer records',
      },
    },
  }), (filePath) => {
    const servers = readMcpServers(filePath, [], { host: 'codex', source: 'project', scope: 'project' });
    const local = servers.find(s => s.name === 'local');
    const remote = servers.find(s => s.name === 'remote');
    assert.equal(local.host, 'codex');
    assert.equal(local.source, 'project');
    assert.equal(local.scope, 'project');
    assert.equal(local.surfaceType, 'mcp');
    assert.equal(local.transport, 'local');
    assert.equal(local.authRequired, false);
    assert.equal(local.mayWrite, false);
    assert.equal(local.externalAccess, false);
    assert.equal(local.invocation, 'mcp__local__*');
    assert.equal(remote.transport, 'remote');
    assert.equal(remote.authRequired, true);
    assert.equal(remote.mayWrite, true);
    assert.equal(remote.externalAccess, true);
  });
});
