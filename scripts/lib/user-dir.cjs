'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function resolveUserDirWithSource() {
  if (process.env.CAPABILITY_USER_DIR) {
    return { dir: process.env.CAPABILITY_USER_DIR, source: 'CAPABILITY_USER_DIR' };
  }
  if (process.env.CLAUDE_USER_DIR) {
    return { dir: process.env.CLAUDE_USER_DIR, source: 'CLAUDE_USER_DIR' };
  }

  const linuxHome = path.join(os.homedir(), '.claude');
  if (!process.env.WSL_DISTRO_NAME) {
    return { dir: linuxHome, source: 'HOME_DEFAULT' };
  }

  try {
    if (fs.statSync(linuxHome).isDirectory()) {
      return { dir: linuxHome, source: 'WSL_LINUX_HOME' };
    }
  } catch { /**/ }

  try {
    const { execSync } = require('child_process');
    const winRaw = execSync('cmd.exe /C "echo %USERPROFILE%" 2>/dev/null', { timeout: 2000 })
      .toString().trim().replace(/\r/g, '');
    const winProfile = execSync(`wslpath "${winRaw}"`, { timeout: 2000 })
      .toString().trim();
    const winClaude = path.join(winProfile, '.claude');
    fs.statSync(winClaude);
    return { dir: winClaude, source: 'WSL_WINDOWS_USERPROFILE' };
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
