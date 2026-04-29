'use strict';

const INTENTS = [
  {
    intent: 'continue_work',
    keywords: ['继续', '接着', '下一步', '往下做', 'keep going', 'continue'],
    confidence: 0.92,
    description: 'Continue the current safe technical work from live context.',
  },
  {
    intent: 'execute_plan',
    keywords: ['执行吧', '执行', '开始做', '照计划做', '按计划', '发布', '推送', '部署', 'do it', 'go ahead'],
    confidence: 0.9,
    description: 'Execute an already-discussed plan with verification.',
  },
  {
    intent: 'work_status',
    keywords: ['还有什么没做完', '没做完', '当前还有什么', '工作到哪里', '剩下什么', 'status', 'unfinished'],
    confidence: 0.86,
    description: 'Summarize remaining work and pick the next feasible task.',
  },
  {
    intent: 'commercial_readiness',
    keywords: ['商用', '商业化', '可以卖', '上线赚钱', 'commercial', 'production ready', 'ship ready'],
    confidence: 0.86,
    description: 'Turn the project into a commercially usable, release-gated product.',
  },
  {
    intent: 'prompt_composition',
    keywords: ['写提示词', '做提示词', '补全提示词', 'prompt', 'harness prompt'],
    confidence: 0.94,
    description: 'Write an executable Harness Prompt for another agent.',
  },
  {
    intent: 'capability_lookup',
    keywords: ['用哪个', '什么指令', '哪个skill', '哪个插件', '哪个mcp', 'which skill', 'which plugin', 'which tool', 'which command', 'what command'],
    confidence: 0.94,
    description: 'Choose the right skill, plugin, MCP tool, command, or agent surface.',
  },
];

function normalize(text) {
  return String(text || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function classifyIntent(prompt) {
  const normalized = normalize(prompt);
  if (!normalized) {
    return { intent: 'unknown', confidence: 0, matchedKeywords: [], description: '' };
  }

  let best = null;
  for (const candidate of INTENTS) {
    const matchedKeywords = candidate.keywords.filter((keyword) => normalized.includes(normalize(keyword)));
    if (matchedKeywords.length === 0) continue;
    const score = Math.min(candidate.confidence + ((matchedKeywords.length - 1) * 0.03), 0.98);
    if (!best || score > best.confidence) {
      best = {
        intent: candidate.intent,
        confidence: score,
        matchedKeywords,
        description: candidate.description,
      };
    }
  }

  return best || { intent: 'unknown', confidence: 0, matchedKeywords: [], description: '' };
}

module.exports = {
  classifyIntent,
  INTENTS,
};
