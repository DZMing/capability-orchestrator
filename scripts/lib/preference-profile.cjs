'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MIN_CONFIDENCE = 0.6;

function defaultPreferenceProfilePath() {
  return path.join(os.homedir(), '.config', 'capability-orchestrator', 'preferences.json');
}

function redactSecretLike(value) {
  return String(value || '')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[REDACTED]')
    .replace(/\b(api[_-]?key|token|password|secret)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/\bAuthorization\s*:\s*Bearer\s+([^\s]+)/gi, 'Authorization: Bearer [REDACTED]');
}

function sanitizePreferenceItem(item, source) {
  if (!item || typeof item !== 'object') return null;
  if (item.enabled === false) return null;
  const confidence = Number(item.confidence == null ? 1 : item.confidence);
  if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) return null;
  const text = redactSecretLike(item.text || '').trim();
  if (!text) return null;
  return {
    id: String(item.id || `${source}-${text.slice(0, 24)}`),
    text,
    confidence,
    source: String(item.source || source),
  };
}

function readPreferenceProfile(profilePath = defaultPreferenceProfilePath()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || parsed.enabled === false) {
      return { version: 1, enabled: false, global: [], projects: {} };
    }
    return {
      version: parsed.version || 1,
      enabled: true,
      global: Array.isArray(parsed.global) ? parsed.global : [],
      projects: parsed.projects && typeof parsed.projects === 'object' ? parsed.projects : {},
    };
  } catch {
    return { version: 1, enabled: false, global: [], projects: {} };
  }
}

function collectPreferenceItems(profile, projectDir) {
  if (!profile || profile.enabled === false) return [];
  const projectItems = profile.projects && projectDir && Array.isArray(profile.projects[projectDir])
    ? profile.projects[projectDir]
    : [];
  return [
    ...projectItems.map((item) => sanitizePreferenceItem(item, 'project')).filter(Boolean),
    ...(profile.global || []).map((item) => sanitizePreferenceItem(item, 'global')).filter(Boolean),
  ];
}

module.exports = {
  defaultPreferenceProfilePath,
  readPreferenceProfile,
  collectPreferenceItems,
  redactSecretLike,
  MIN_CONFIDENCE,
};
