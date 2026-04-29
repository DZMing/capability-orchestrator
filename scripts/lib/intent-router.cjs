'use strict';

const { classifyIntent } = require('./intent-classifier.cjs');
const { evaluateSafety } = require('./safety-gate.cjs');
const { composeExecutionContract } = require('./prompt-composer.cjs');
const {
  readPreferenceProfile,
  collectPreferenceItems,
  defaultPreferenceProfilePath,
} = require('./preference-profile.cjs');
const { collectWorkContext } = require('./work-context.cjs');

const MIN_INTENT_CONFIDENCE = 0.65;

function resolveIntentRoute({ prompt = '', cwd = process.cwd(), profilePath, routeLogPath } = {}) {
  const classified = classifyIntent(prompt);
  const context = collectWorkContext({ cwd, routeLogPath });
  const profile = readPreferenceProfile(profilePath || process.env.CAPABILITY_PROFILE_PATH || defaultPreferenceProfilePath());
  const preferences = collectPreferenceItems(profile, cwd);
  const hasClassifiedIntent = classified
    && classified.intent !== 'unknown'
    && classified.confidence >= MIN_INTENT_CONFIDENCE;
  const safety = evaluateSafety({
    prompt,
    intent: hasClassifiedIntent ? classified.intent : 'risk_review',
    context,
    preferences,
  });
  if (!hasClassifiedIntent && !safety.confirmationRequired) {
    return null;
  }

  const intent = hasClassifiedIntent ? classified.intent : 'risk_review';
  const output = composeExecutionContract({
    prompt,
    intent,
    safety,
    context,
    preferences,
  });

  return {
    intent,
    confidence: hasClassifiedIntent ? classified.confidence : 0.66,
    matchedKeywords: hasClassifiedIntent ? classified.matchedKeywords : safety.reasons,
    targetType: 'intent',
    safety,
    context,
    preferences,
    output,
  };
}

module.exports = {
  resolveIntentRoute,
  MIN_INTENT_CONFIDENCE,
};
