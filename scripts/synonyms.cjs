'use strict';
// 同义词/翻译映射表 — 双向展开模式（追加同义词，不替换原词）
// 覆盖：中英互通 + 常见技术近义词
// 维护：新增 skill 时按需添加对应映射

const SYNONYM_MAP = new Map([
  // ── 认证 / 授权 ──────────────────────────────────────────────────────────
  ['认证', ['auth', 'authentication', 'login']],
  ['auth', ['认证', 'authentication', 'login']],
  ['authentication', ['auth', '认证']],
  ['授权', ['authorization', 'permission']],
  ['authorization', ['授权', 'permission']],
  ['登录', ['login', 'signin', 'auth']],
  ['login', ['登录', 'signin', 'auth', '认证']],
  ['oauth', ['认证', 'auth']],

  // ── Git 提交 ─────────────────────────────────────────────────────────────
  ['提交', ['commit', 'push']],
  ['commit', ['提交', 'push']],
  ['推送', ['push', 'commit']],
  ['push', ['推送', 'commit', '提交']],

  // ── 部署 / 发布 ──────────────────────────────────────────────────────────
  ['部署', ['deploy', 'release', 'ship']],
  ['deploy', ['部署', 'release', 'ship']],
  ['发布', ['deploy', 'release', 'ship']],
  ['release', ['发布', 'deploy', 'ship']],
  ['ship', ['deploy', '发布', '部署']],
  ['上线', ['deploy', 'release']],

  // ── 调试 / 错误 ──────────────────────────────────────────────────────────
  ['调试', ['debug', 'fix', 'troubleshoot']],
  ['debug', ['调试', 'fix', 'troubleshoot']],
  ['修复', ['fix', 'debug', 'repair', 'patch']],
  ['fix', ['修复', 'debug', 'repair']],
  ['错误', ['error', 'bug', 'issue']],
  ['error', ['错误', 'bug', 'issue']],
  ['bug', ['错误', 'error', 'issue']],
  ['issue', ['bug', 'error', '问题']],
  ['问题', ['issue', 'bug', 'error', 'problem']],
  ['problem', ['问题', 'issue', 'bug']],

  // ── 审查 / 审计 ──────────────────────────────────────────────────────────
  ['审查', ['review', 'audit', 'check']],
  ['review', ['审查', 'audit', 'check']],
  ['代码审查', ['code-review', 'review']],
  ['audit', ['审查', 'audit']],

  // ── 测试 ─────────────────────────────────────────────────────────────────
  ['测试', ['test', 'testing', 'qa', 'spec']],
  ['test', ['测试', 'qa']],
  ['testing', ['测试', 'qa']],
  ['qa', ['测试', 'test']],

  // ── 数据 / 分析 ──────────────────────────────────────────────────────────
  ['数据分析', ['analytics', 'analysis', 'data']],
  ['analytics', ['数据分析', 'analysis']],
  ['analysis', ['分析', 'analytics']],
  ['分析', ['analysis', 'analytics']],

  // ── 设计 / UI ────────────────────────────────────────────────────────────
  ['设计', ['design', 'ui', 'ux']],
  ['design', ['设计', 'ui']],
  ['界面', ['ui', 'interface', 'design']],
  ['ui', ['界面', 'design', '设计']],

  // ── 配置 / 环境 ──────────────────────────────────────────────────────────
  ['配置', ['config', 'configuration', 'setup']],
  ['config', ['配置', 'configuration', 'setup']],
  ['configuration', ['配置', 'config', 'setup']],
  ['setup', ['配置', 'config', 'init']],
  ['初始化', ['init', 'setup', 'scaffold']],
  ['init', ['初始化', 'setup']],

  // ── 性能 / 优化 ──────────────────────────────────────────────────────────
  ['优化', ['optimize', 'performance', 'improve']],
  ['optimize', ['优化', 'improve']],
  ['performance', ['性能', 'perf', 'optimize']],
  ['性能', ['performance', 'perf', 'optimize']],

  // ── 搜索 ─────────────────────────────────────────────────────────────────
  ['搜索', ['search', 'find', 'query']],
  ['search', ['搜索', 'find', 'query']],

  // ── 文档 ─────────────────────────────────────────────────────────────────
  ['文档', ['docs', 'documentation']],
  ['docs', ['文档', 'documentation']],
  ['documentation', ['文档', 'docs']],

  // ── 数据库 ───────────────────────────────────────────────────────────────
  ['数据库', ['database', 'db', 'storage']],
  ['database', ['数据库', 'db']],
  ['db', ['数据库', 'database']],

  // ── 运维 / 数据 / 监控 ───────────────────────────────────────────────────
  ['备份', ['backup', 'dump']],
  ['backup', ['备份', 'dump']],
  ['恢复', ['restore', 'recovery', 'rollback']],
  ['restore', ['恢复', 'recovery']],
  ['迁移', ['migrate', 'migration']],
  ['migrate', ['迁移', 'migration']],
  ['migration', ['迁移', 'migrate']],
  ['回滚', ['rollback', 'revert', 'restore']],
  ['rollback', ['回滚', 'revert']],
  ['监控', ['monitor', 'monitoring', 'observe']],
  ['monitor', ['监控', 'monitoring']],
  ['monitoring', ['监控', 'monitor']],
  ['告警', ['alert', 'alarm', 'notification']],
  ['alert', ['告警', 'alarm']],
  ['基准', ['benchmark', 'baseline']],
  ['benchmark', ['基准', 'baseline']],
  ['预置', ['provision', 'setup', 'init']],
  ['provision', ['预置', 'setup']],
  ['表结构', ['schema', 'ddl']],
  ['schema', ['表结构', 'ddl', 'database']],

  // ── 容器 / 编排 ──────────────────────────────────────────────────────────
  ['docker', ['容器', 'container']],
  ['容器', ['docker', 'container']],
  ['container', ['docker', '容器']],
  ['k8s', ['kubernetes', '编排']],
  ['kubernetes', ['k8s', '编排']],
  ['编排', ['orchestration', 'k8s', 'kubernetes']],
  ['helm', ['chart', 'kubernetes']],

  // ── 性能 / 可观测 ────────────────────────────────────────────────────────
  ['apm', ['性能监控', 'observability', '可观测']],
  ['observability', ['可观测', 'apm']],
  ['可观测', ['observability', 'apm']],
  ['tracing', ['链路追踪', 'trace']],
  ['trace', ['链路追踪', 'tracing']],
  ['链路追踪', ['tracing', 'trace']],
  ['profiling', ['性能剖析', 'profile']],
  ['profile', ['profiling', '性能剖析']],
  ['性能剖析', ['profiling', 'profile']],
  ['metrics', ['指标', 'monitor']],
  ['指标', ['metrics']],

  // ── 安全 ─────────────────────────────────────────────────────────────────
  ['漏洞', ['vuln', 'vulnerability', 'cve']],
  ['vuln', ['漏洞', 'vulnerability']],
  ['vulnerability', ['漏洞', 'vuln']],
  ['扫描', ['scan', 'scanning']],
  ['scan', ['扫描', 'scanning']],
  ['scanning', ['扫描', 'scan']],
  ['渗透测试', ['pentest', 'penetration']],
  ['pentest', ['渗透测试', 'penetration']],
  ['penetration', ['渗透测试', 'pentest']],

  // ── 数据 / 仓库 / 管道 ───────────────────────────────────────────────────
  ['etl', ['数据管道', 'pipeline']],
  ['pipeline', ['数据管道', 'etl']],
  ['数据管道', ['etl', 'pipeline']],
  ['warehouse', ['数据仓库', 'dwh']],
  ['数据仓库', ['warehouse', 'dwh']],
  ['dwh', ['warehouse', '数据仓库']],
  ['lake', ['数据湖']],
  ['数据湖', ['lake', 'datalake']],
  ['同步', ['sync', 'replication']],
  ['sync', ['同步', 'replication']],
  ['replication', ['同步', 'sync']],

  // ── 前端 ─────────────────────────────────────────────────────────────────
  ['component', ['组件']],
  ['组件', ['component']],
  ['state', ['状态管理', 'store']],
  ['状态管理', ['state', 'store']],
  ['store', ['state', '状态管理']],
  ['router', ['路由']],
  ['路由', ['router', 'routing']],
  ['ssr', ['服务端渲染']],
  ['服务端渲染', ['ssr', 'server-side-rendering']],

  // ── AI / ML ──────────────────────────────────────────────────────────────
  ['embedding', ['向量', '嵌入', 'vector']],
  ['向量', ['embedding', '嵌入', 'vector']],
  ['嵌入', ['embedding', '向量']],
  ['vector', ['向量', 'embedding']],
  ['llm', ['大模型', 'ai', '语言模型']],
  ['大模型', ['llm', 'ai', '语言模型']],
  ['语言模型', ['llm', '大模型']],
  ['rag', ['检索增强', '向量检索', '知识库']],
  ['检索增强', ['rag', '向量检索']],
  ['微调', ['fine-tune', 'finetune', 'training']],
  ['fine-tune', ['微调', 'finetune']],
  ['finetune', ['微调', 'fine-tune']],
  ['推理', ['inference', 'infer']],
  ['inference', ['推理', 'infer']],
  ['prompt', ['提示词', 'prompting']],
  ['提示词', ['prompt', 'prompting']],

  // ── 移动端 ────────────────────────────────────────────────────────────────
  ['ios', ['苹果', 'iphone', 'swift', 'apple']],
  ['苹果', ['ios', 'apple', 'iphone']],
  ['android', ['安卓', 'kotlin']],
  ['安卓', ['android', 'kotlin']],
  ['flutter', ['跨端', 'dart']],
  ['跨端', ['flutter', 'react-native', 'rn']],
  ['react-native', ['rn', 'mobile', '移动端']],
  ['rn', ['react-native', 'mobile', '移动端']],
  ['移动端', ['ios', 'android', 'flutter', 'mobile']],
  ['mobile', ['移动端', '移动']],

  // ── CI / CD ───────────────────────────────────────────────────────────────
  ['流水线', ['pipeline', 'ci', 'cicd']],
  ['ci', ['cicd', 'pipeline', '持续集成', '流水线']],
  ['cicd', ['ci', '持续集成', '持续交付', 'pipeline']],
  ['持续集成', ['ci', 'cicd']],
  ['持续交付', ['cd', 'cicd']],
  ['workflow', ['工作流', 'action', 'runner']],
  ['工作流', ['workflow', 'action']],
  ['action', ['workflow', 'runner', '自动化']],

  // ── API 风格 ──────────────────────────────────────────────────────────────
  ['graphql', ['gql', 'graph']],
  ['gql', ['graphql', 'graph']],
  ['grpc', ['rpc', 'protobuf']],
  ['rpc', ['grpc', 'protobuf']],
  ['restful', ['rest', 'api', 'http']],
  ['接口', ['api', 'interface', 'endpoint']],
  ['api', ['接口', 'endpoint']],
]);

function expandSynonyms(tokens) {
  const result = new Set(tokens);
  for (const t of tokens) {
    const syns = SYNONYM_MAP.get(t);
    if (syns) {
      for (const s of syns) result.add(s);
    }
  }
  return [...result];
}

module.exports = { expandSynonyms, SYNONYM_MAP };
