// 学生端宿主 · 本地确定性演示数据
//
// 重要：这里不是 AI 解析结果。仓库当前的 M2 阶段只冻结了文本接口契约，
// 真实解析服务尚未接入。本模块提供确定性样例，仅用于验证宿主的渲染链路。
//
// 分层约定（对齐 schemas/v1/action-graph.schema.json）：
//   protocol —— 严格符合 action-graph/v1 的协议对象，不含任何展示字段
//               （该 schema 声明了 unevaluatedProperties: false，多一个字段即不合规），
//               可直接用于渲染以外的协议用途。
//   nodesView / edgesView —— 视图模型，在 protocol 之上补充中文摘要与原文证据供页面渲染。
// 页面只读 nodesView / edgesView，不把视图字段当作协议字段使用。

var SCHEMA_VERSION = 'action-graph/v1';

var SAMPLE_NOTICE =
  '关于本周五晚自习安排调整的通知：住宿生请于 20:00 前返回宿舍并完成签到；' +
  '走读生须在 17:30 前提交离校登记，并于次日 08:00 前返校。原定 19:00 的集合时间调整为 20:00。';

// 严格协议对象：结构与 examples/action-graphs/branch-and-revision.json 一致。
var PROTOCOL_GRAPH = {
  schema_version: SCHEMA_VERSION,
  graph_id: 'g-demo-1',
  nodes: [
    {
      node_id: 'n1',
      node_type: 'decision',
      condition_ids: ['cond1'],
      population_groups: ['住宿生', '走读生'],
    },
    { node_id: 'n2', node_type: 'action', action_id: 'a-dorm', population_groups: ['住宿生'] },
    { node_id: 'n3', node_type: 'action', action_id: 'a-day', population_groups: ['走读生'] },
    { node_id: 'n4', node_type: 'notice_revision', notice_revision_id: 'rev-1' },
  ],
  edges: [
    {
      edge_id: 'e1',
      from_node_id: 'n1',
      to_node_id: 'n2',
      edge_type: 'branches_to',
      condition_id: 'cond1',
    },
    {
      edge_id: 'e2',
      from_node_id: 'n1',
      to_node_id: 'n3',
      edge_type: 'branches_to',
      condition_id: 'cond1',
    },
    { edge_id: 'e3', from_node_id: 'n4', to_node_id: 'n2', edge_type: 'postpones' },
  ],
};

// 视图层补充：中文摘要 + 原文证据（原文证据是项目设计原则之一）。
var NODE_VIEW = {
  n1: {
    summary: '条件判定：按住宿状态分流。',
    evidence: '住宿生请于 20:00 前返回宿舍…；走读生须在 17:30 前提交离校登记',
  },
  n2: {
    summary: '住宿生：20:00 前返回宿舍并完成签到。',
    evidence: '住宿生请于 20:00 前返回宿舍并完成签到',
  },
  n3: {
    summary: '走读生：17:30 前提交离校登记，次日 08:00 前返校。',
    evidence: '走读生须在 17:30 前提交离校登记，并于次日 08:00 前返校',
  },
  n4: {
    summary: '通知修订：集合时间由 19:00 调整为 20:00。',
    evidence: '原定 19:00 的集合时间调整为 20:00',
  },
};

var EDGE_LABEL = {
  branches_to: '条件分流',
  postpones: '推迟',
  requires: '前置依赖',
  blocks: '阻塞',
  informs: '告知',
  alternative_to: '备选',
  revokes: '撤销',
  replaces: '替换',
};

function buildNodeView(node) {
  var meta = NODE_VIEW[node.node_id] || {};
  return {
    node_id: node.node_id,
    node_type: node.node_type,
    summary: meta.summary || '',
    evidence: meta.evidence || '',
    groups: (node.population_groups || []).join(' / '),
    conditions: (node.condition_ids || []).join(' / '),
  };
}

function buildEdgeView(edge) {
  return {
    edge_id: edge.edge_id,
    from_node_id: edge.from_node_id,
    to_node_id: edge.to_node_id,
    edge_type: edge.edge_type,
    edge_label: EDGE_LABEL[edge.edge_type] || edge.edge_type,
    condition_id: edge.condition_id || '',
  };
}

/** 生成演示用行动图（确定性，不含随机性）。 */
function buildDemoGraph() {
  var nodes = PROTOCOL_GRAPH.nodes.map(buildNodeView);
  var edges = PROTOCOL_GRAPH.edges.map(buildEdgeView);
  return {
    protocol: PROTOCOL_GRAPH,
    schema_version: PROTOCOL_GRAPH.schema_version,
    graph_id: PROTOCOL_GRAPH.graph_id,
    nodes: PROTOCOL_GRAPH.nodes,
    edges: PROTOCOL_GRAPH.edges,
    nodesView: nodes,
    edgesView: edges,
    node_count: nodes.length,
    edge_count: edges.length,
  };
}

module.exports = {
  SCHEMA_VERSION: SCHEMA_VERSION,
  SAMPLE_NOTICE: SAMPLE_NOTICE,
  buildDemoGraph: buildDemoGraph,
};
