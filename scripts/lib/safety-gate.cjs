'use strict';

const RISK_PATTERNS = [
  {
    label: 'destructive local action',
    matches: (text) => /(rm\s+-rf|drop\s+table|reset\s+--hard|wipe|delete|删除|清空)/i.test(text),
  },
  {
    label: 'git history or remote action',
    matches: (text) => /(force-?push|git\s+push|\bpush\b|推送|rebase|reset\s+--hard|git\s+tag|create\s+(?:a\s+)?(?:release\s+)?tag|release\s+tag|打标签)/i.test(text),
  },
  {
    label: 'public/external action',
    matches: (text) => /(publish|发布|\brelease\b|deploy|部署|上线|public|external)/i.test(text),
  },
  {
    label: 'production-impacting action',
    matches: (text) => /(production|\bprod\b|生产|线上)/i.test(text),
  },
  {
    label: 'credential-gated action',
    matches: (text) => /(secret|token|credential|api[_-]?key|password|密码|凭证|密钥)/i.test(text),
  },
  {
    label: 'paid action',
    matches: (text) => /(pay|paid|billing|charge|付款|付费|扣款)/i.test(text),
  },
  {
    label: 'real product or UX decision',
    matches: (text) => {
      const decision = /(decision|decide|choose|set|change|launch|决策|决定|选择|上线|定价)/i;
      const productSurface = /(real\s+product|真实产品|product|pricing|brand|ux|用户体验|产品|定价|价格|品牌)/i;
      return /(产品决策|商业决策|ux\s*决策|真实产品)/i.test(text)
        || (decision.test(text) && productSurface.test(text));
    },
  },
];

function evaluateSafety({ prompt = '', intent = 'unknown', context = {}, preferences = [] } = {}) {
  const text = String(prompt || '');
  const reasons = [];

  for (const risk of RISK_PATTERNS) {
    if (risk.matches(text)) reasons.push(risk.label);
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
