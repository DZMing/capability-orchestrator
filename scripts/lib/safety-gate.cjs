'use strict';

const { RESET_HARD_RE, DROP_RE } = require('./danger-rules.cjs');

const READINESS_ASSESSMENT =
  /(ready|readiness|prepared|preflight|audit|check|assess|evaluate|review|评估|检查|验收|准备度|可用性|是否可以|够不够|能不能|可不可以|商用)/i;

// 远程 git 动作收窄：必须是 git push / push 到具体目标，"推送通知"这类产品功能词不算
const REMOTE_GIT_ACTION =
  /(force-?push|git\s+push|\bpush\s+(?:to|it|--|origin|upstream|tags?\b|the\s+(?:branch|tag|release))|推送到|推送(?:代码|分支|标签|版本|仓库))/i;

const EXPLICIT_EXECUTION =
  /(直接做|立即|马上|now|do it|execute|run|perform|force-?push|git\s+push|推送到|rm\s+-rf|drop\s+table|rotate|轮换|use\s+(?:the\s+)?(?:secret|token|credential|api[_-]?key)|使用.*(?:凭证|密钥|密码)|deploy\s+(?:to|prod|production)|部署(?:到|生产|线上)|publish\s+(?:this|it|now|release)|发布(?:并|到|这个|它|版本)|上线(?:生产|线上|吧|这个|它)|create\s+(?:a\s+)?(?:release\s+)?tag|release\s+tag|git\s+tag|打标签|charge|付款|付费|扣款)/i;

// 疑问句/讨论句：问"怎么做"不等于"现在做"，放行（真祈使词可推翻）。
// 只认疑问词，不认裸问号——"push prod?" 是请求许可，仍需确认闸门
const QUESTION_FORM =
  /(怎么|怎样|如何|为什么|为啥|是什么|什么是|是不是|有没有|要不要|算不算|^(?:how|what|why|when|which|where|who|does|do|is|are|can|could|should|would)\b)/i;

// 祈使标记：表达"现在就做"的词。与 EXPLICIT_EXECUTION（含话题词）分开，
// 只有这些词才能把疑问句重新升级为执行请求
const IMPERATIVE_OVERRIDE =
  /(直接|立即|马上|赶紧|快点|\bnow\b|do\s+it|just\s+(?:do|run|push|deploy|delete)|执行吧|去吧)/i;

function isReadinessAssessmentOnly(text) {
  return READINESS_ASSESSMENT.test(text) && !EXPLICIT_EXECUTION.test(text);
}

function isQuestionOnly(text) {
  return QUESTION_FORM.test(text) && !IMPERATIVE_OVERRIDE.test(text);
}

// 删除/清空类动作只有指向真实资源（目录/文件/数据/分支等）才算破坏性；
// 删注释、删 console.log、删无用 import 属于普通代码编辑
const DESTRUCTIVE_SCOPE =
  /(?:delete|remove|删除|清空|清除)[^。.!?\n]{0,16}(?:目录|文件夹|文件|数据库|数据|库|表|分支|仓库|历史|全部|所有|database|directory|folder|files?\b|repo\b|branch|history|everything)/i;

const RISK_PATTERNS = [
  {
    label: 'destructive local action',
    matches: (text) => /(rm\s+-rf|drop\s+table|truncate\s+table|reset\s+--hard|\bwipe\b|删库)/i.test(text)
      || DROP_RE.test(text) || RESET_HARD_RE.test(text)
      || DESTRUCTIVE_SCOPE.test(text),
  },
  {
    label: 'git history or remote action',
    matches: (text) => REMOTE_GIT_ACTION.test(text)
      || /(\brebase\b|reset\s+--hard|git\s+tag|create\s+(?:a\s+)?(?:release\s+)?tag|release\s+tag|打标签)/i.test(text),
  },
  {
    label: 'public/external action',
    matches: (text) => !isReadinessAssessmentOnly(text)
      && /(publish|发布|\brelease\b|deploy|部署|上线|public|external)/i.test(text),
  },
  {
    label: 'production-impacting action',
    matches: (text) => !isReadinessAssessmentOnly(text)
      && /(production|\bprod\b|生产|线上)/i.test(text),
  },
  {
    // 凭证类收窄：裸 "token" 不算（LLM token 用量是日常话题），必须是凭证语境
    label: 'credential-gated action',
    matches: (text) => /(\bsecrets?\b|\bcredentials?\b|api[_-]?keys?|(?:access|auth|api|bearer|oauth|refresh)[ _-]?tokens?|token\s+rotation|密钥|凭证|password|密码)/i.test(text),
  },
  {
    label: 'paid action',
    matches: (text) => /(\bpay\b|\bpaid\b|billing|charge|付款|付费|扣款)/i.test(text),
  },
  {
    // 产品决策收窄：改价格页布局是普通前端活，只有显式"决策/决定定价方向"才算
    label: 'real product or UX decision',
    matches: (text) => /(产品决策|商业决策|定价决策|品牌决策|ux\s*决策|(?:pricing|product|brand)\s+decision)/i.test(text)
      || /(?:decide|决定|决策)[^。.!?\n]{0,16}(?:定价|价格|pricing|产品方向|品牌方向)/i.test(text),
  },
];

function evaluateSafety({ prompt = '', intent = 'unknown', context = {}, preferences = [] } = {}) {
  const text = String(prompt || '');
  const reasons = [];

  // 疑问句只在讨论风险话题，不在执行风险动作 → 不触发模式匹配
  if (!isQuestionOnly(text)) {
    for (const risk of RISK_PATTERNS) {
      if (risk.matches(text)) reasons.push(risk.label);
    }
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
  isReadinessAssessmentOnly,
  isQuestionOnly,
};
