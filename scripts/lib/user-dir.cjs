'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function statDir(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function statFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function resolveUserDirWithSource() {
  if (process.env.CAPABILITY_USER_DIR) {
    return { dir: process.env.CAPABILITY_USER_DIR, source: 'CAPABILITY_USER_DIR' };
  }

  const { detectPlatform, getPlatformPaths } = require('./platform.cjs');
  const platform = detectPlatform();
  const p = getPlatformPaths(platform);
  if (p.userDirEnv && process.env[p.userDirEnv]) {
    return { dir: process.env[p.userDirEnv], source: p.userDirEnv };
  }
  const linuxHome = path.join(os.homedir(), p.configDir);
  if (!process.env.WSL_DISTRO_NAME) {
    return { dir: linuxHome, source: 'HOME_DEFAULT' };
  }

  const linuxPathExists = p.configFile
    ? statDir(linuxHome) || statFile(path.join(linuxHome, p.configFile))
    : statDir(linuxHome);
  if (linuxPathExists) {
    return { dir: linuxHome, source: 'WSL_LINUX_HOME' };
  }

  try {
    const winRaw = execSync('cmd.exe /C "echo %USERPROFILE%" 2>/dev/null', { timeout: 2000 })
      .toString().trim().replace(/\r/g, '');
    const winProfile = execSync(`wslpath "${winRaw}"`, { timeout: 2000 })
      .toString().trim();
    const winDir = path.join(winProfile, p.configDir);
    const winPathExists = p.configFile
      ? statDir(winDir) || statFile(path.join(winDir, p.configFile))
      : statDir(winDir);
    if (!winPathExists) throw new Error('missing host path');
    return { dir: winDir, source: 'WSL_WINDOWS_USERPROFILE' };
  } catch {
    return { dir: linuxHome, source: 'WSL_LINUX_HOME_FALLBACK' };
  }
}

function resolveUserDir() {
  return resolveUserDirWithSource().dir;
}

module.exports = {
  resolveUserDir,
  resolveUserDirWithSource,
};
