'use strict';
// scan-cache.cjs — 路由扫描结果缓存
//
// 失效策略：聚合扫描目录的 mtimeMs 作为指纹；目录结构变化（新增/删除文件）即失效。
// 故障开放：读/写/解析任何异常 → 静默降级全扫。
// 逃生口：CO_DISABLE_CACHE=1 跳过所有缓存逻辑。

const fs = require('fs');
const path = require('path');
const { debugError } = require('./debug-log.cjs');

function getCachePath() {
  const pluginData = process.env.CLAUDE_PLUGIN_DATA || process.env.CODEX_PLUGIN_DATA;
  if (pluginData) return path.join(pluginData, 'scan-cache.json');
  try {
    const { resolveUserDir } = require('./user-dir.cjs');
    return path.join(
      resolveUserDir(),
      'plugins', 'cache', 'capability-orchestrator', 'data', 'scan-cache.json'
    );
  } catch {
    return path.join(require('os').tmpdir(), 'co-scan-cache.json');
  }
}

function dirMtime(p) {
  try { return fs.statSync(p).mtimeMs; } catch { return 0; }
}

// 确定性指纹：每个目录路径 + 其 mtime，用 '|' 分隔
function computeFingerprint(dirs) {
  return dirs.map(d => `${d}:${dirMtime(d)}`).join('|');
}

// 计算 route-matcher 扫描路径集合（用于指纹）
function buildFingerprintDirs(projectDir, userDir) {
  try {
    const {
      detectPlatform,
      getPlatformPaths,
      getUserSkillsPaths,
      getUserCommandsPaths,
      getUserAgentsPaths,
    } = require('./platform.cjs');
    const { resolveUserDir } = require('./user-dir.cjs');
    const activeUserDir = userDir || resolveUserDir();
    const platform = detectPlatform();
    const pp = getPlatformPaths(platform);
    const base = projectDir || process.cwd();

    const dirs = [
      path.join(base, pp.projectSkillsDir),
      ...getUserSkillsPaths(activeUserDir, platform),
      path.join(activeUserDir, 'plugins', 'cache'),
    ];
    if (pp.projectCommandsDir) dirs.push(path.join(base, pp.projectCommandsDir));
    if (pp.projectAgentsDir) dirs.push(path.join(base, pp.projectAgentsDir));
    dirs.push(...getUserCommandsPaths(activeUserDir, platform));
    dirs.push(...getUserAgentsPaths(activeUserDir, platform));
    return dirs;
  } catch {
    return [];
  }
}

// 从缓存获取 skills 列表，未命中则调用 collectFn 全扫后回写缓存
function getCachedSkills(fingerprintDirs, collectFn) {
  if (process.env.CO_DISABLE_CACHE === '1') return collectFn();

  const cachePath = getCachePath();
  const fingerprint = computeFingerprint(fingerprintDirs);

  // 尝试读取缓存
  let cached = null;
  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    cached = JSON.parse(raw);
  } catch { /* cache miss or corrupt → will rescan */ }

  if (cached && cached.fingerprint === fingerprint && Array.isArray(cached.skills)) {
    return cached.skills;
  }

  // 缓存未命中：全扫
  const skills = collectFn();

  // 异步回写，不阻塞路由响应
  setImmediate(() => {
    try {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(
        cachePath,
        JSON.stringify({ fingerprint, skills, ts: new Date().toISOString() })
      );
    } catch (e) {
      debugError('scan-cache write', e);
    }
  });

  return skills;
}

module.exports = { getCachePath, computeFingerprint, getCachedSkills, buildFingerprintDirs };
