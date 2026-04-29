'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  readPreferenceProfile,
  collectPreferenceItems,
  redactSecretLike,
} = require('../scripts/lib/preference-profile.cjs');

test('readPreferenceProfile: corrupt profile is ignored safely', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-profile-'));
  const profilePath = path.join(tmp, 'preferences.json');
  fs.writeFileSync(profilePath, '{not-json');
  try {
    const profile = readPreferenceProfile(profilePath);
    assert.equal(profile.enabled, false);
    assert.deepEqual(collectPreferenceItems(profile, tmp), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('collectPreferenceItems: project preferences precede global preferences and ignore weak/disabled items', () => {
  const projectDir = '/repo/project';
  const profile = {
    version: 1,
    enabled: true,
    global: [
      { id: 'global-auto', text: 'Proceed on reversible technical work.', confidence: 0.9, enabled: true },
      { id: 'global-disabled', text: 'Ignore tests.', confidence: 1, enabled: false },
      { id: 'global-weak', text: 'Maybe skip docs.', confidence: 0.4, enabled: true },
    ],
    projects: {
      [projectDir]: [
        { id: 'project-pr', text: 'Use codex branches and Chinese PR descriptions.', confidence: 1, enabled: true },
      ],
    },
  };

  const items = collectPreferenceItems(profile, projectDir);
  assert.deepEqual(items.map(item => item.id), ['project-pr', 'global-auto']);
});

test('redactSecretLike: removes secret-shaped values', () => {
  const text = 'token=sk-abc123456789 password=hunter2 Authorization: Bearer secretvalue';
  const redacted = redactSecretLike(text);
  assert.ok(!redacted.includes('sk-abc123456789'));
  assert.ok(!redacted.includes('hunter2'));
  assert.ok(!redacted.includes('secretvalue'));
  assert.ok(redacted.includes('[REDACTED]'));
});
