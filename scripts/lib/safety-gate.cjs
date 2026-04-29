'use strict';

const RISK_PATTERNS = [
  { label: 'destructive local action', pattern: /(rm\s+-rf|delete|删除|清空|wipe|drop\s+table|reset\s+--hard)/i },
  { label: 'git history or remote action', pattern: /(force-?push|push|推送|merge|rebase|reset\s+--hard|tag)/i },
  { label: 'public/external action', pattern: /(publish|发布|release|deploy|部署|上线|public|external)/i },
  { label: 'production-impacting action', pattern: /(production|prod|生产|线上)/i },
  { label: 'credential-gated action', pattern: /(secret|token|credential|api[_-]?key|密码|凭证|密钥)/i },
  { label: 'paid action', pattern: /(pay|paid|billing|charge|付款|付费|扣款)/i },
  { label: 'real product or UX decision', pattern: /(pricing|价格|定价|brand|品牌|ux|产品决策|商业决策)/i },
];

function evaluateSafety({ prompt = '', intent = 'unknown', context = {}, preferences = [] } = {}) {
  const text = String(prompt || '');
  const reasons = [];

  for (const risk of RISK_PATTERNS) {
    if (risk.pattern.test(text)) reasons.push(risk.label);
  }

  if (context && context.requiresConfirmation) reasons.push('context requires confirmation');

  const confirmationRequired = reasons.length > 0;
  return {
    decision: confirmationRequired ? 'confirmation_required' : 'safe_auto',
    riskLevel: confirmationRequired ? 'high' : 'low',
    confirmationRequired,
    reasons,
    intent,
    // Preferences are accepted as advisory data only. They never downgrade risk.
    preferenceCount: Array.isArray(preferences) ? preferences.length : 0,
  };
}

module.exports = {
  evaluateSafety,
  RISK_PATTERNS,
};
