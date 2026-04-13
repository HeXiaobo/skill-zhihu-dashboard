#!/usr/bin/env node
/**
 * 言书商务策 Dashboard 数据同步脚本
 * 源：飞书 项目结算 table (tblZ0yruevjhBIXB)
 * 输出：~/zylos/workspace/yanshu-dashboard/repo/latest.json
 * 推送：git commit + push to with3ai/zhihu-dashboard-data
 *
 * v1: business部分完整；planning字段置空(待曹栩瑄提供外部大表token)；weekly_meeting合并字段
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ========== CONFIG ==========
const CONFIG = {
  app_token: 'SI5XbhPWWaZqmSscMWmc9B7rnzb',
  table_id: 'tblZ0yruevjhBIXB',           // 项目结算
  settlement_table_id: 'tblMNgNTHaNs5bVo', // 认款单据（客户）
  platforms: ['知乎', '知乎-MCN'],  // 知乎事业部=知乎+知乎-MCN
  year: 2026,
  overdue_threshold_days: 30,  // 2026-04-13 栩瑄要求改30天；客户分层规则待补后再细化
  planning_app_token: 'CqQAbPRj3a8xdVs6sd2cZrvwneh',  // 2026知乎事业部大表
  planning_sales_opp_table: 'tblFBP8dLyaCmps0',        // 销售商机管理（dispatches + outcomes）
  planning_planning_order_table: 'tblcBYRfUPDqxnnH',   // 策划下单管理（策划侧dispatches + outcomes）
  repo_dir: path.join(process.env.HOME, 'zylos/workspace/yanshu-dashboard/repo'),
  top_n: 5,
};

// 2026全年时间戳范围 (CST, +8)
const YEAR_START = new Date('2026-01-01T00:00:00+08:00').getTime() - 1;
const YEAR_END = new Date('2027-01-01T00:00:00+08:00').getTime();

// ========== UTILS ==========
function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', ...opts });
}

function parseAmount(field) {
  if (field == null) return 0;
  if (typeof field === 'number') return field;
  if (Array.isArray(field)) field = field[0];
  if (field && typeof field === 'object') {
    // Formula/number fields: {type:2, value:[0.132]}
    if (Array.isArray(field.value)) {
      const v = field.value[0];
      if (typeof v === 'number') return v;
      if (v && typeof v === 'object') field = v;
      else field = v;
    } else {
      field = field.text ?? field.value;
    }
  }
  if (field == null) return 0;
  if (typeof field === 'number') return field;
  const n = parseFloat(String(field).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function getText(field) {
  if (!field) return '';
  if (Array.isArray(field)) return field[0]?.text ?? '';
  if (typeof field === 'object') return field.value?.[0]?.text ?? field.text ?? '';
  return String(field);
}

function getUser(field) {
  if (!field) return null;
  if (Array.isArray(field)) return field[0]?.name || null;
  if (field.value && Array.isArray(field.value)) return field.value[0]?.name || null;
  return field.name || null;
}

function getLinkText(field) {
  // link/lookup text fields: array of {text} or {type:1, value:[{text}]}
  if (!field) return '';
  if (Array.isArray(field)) return field.map(x => x.text || '').filter(Boolean).join(',');
  if (field.value && Array.isArray(field.value)) return field.value.map(x => x.text || '').filter(Boolean).join(',');
  if (field.text) return field.text;
  return '';
}

function getSelects(field) {
  if (!field) return [];
  if (Array.isArray(field)) return field.map(x => x.text || x).filter(Boolean);
  if (field.value) return field.value.map(x => x.text || x).filter(Boolean);
  return [];
}

function toIsoDate(ts) {
  if (!ts) return null;
  const d = new Date(ts + 8 * 3600000);
  return d.toISOString().slice(0, 10) + 'T00:00:00+08:00';
}

// ISO week number
function isoWeek(ts) {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `W${weekNo}`;
}

function isoMonth(ts) {
  const d = new Date(ts + 8 * 3600000); // CST
  return d.toISOString().slice(0, 7);
}

// ISO week 边界（CST），返回 {start: 'YYYY-MM-DD', end: 'YYYY-MM-DD'}
function isoWeekRange(ts) {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  // Thursday 所在 ISO 周
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  // 周一（-3 from Thursday）~ 周日（+3）
  const monday = new Date(d.getTime() - 3 * 86400000);
  const sunday = new Date(d.getTime() + 3 * 86400000);
  const fmt = dt => {
    const x = new Date(dt.getTime() + 8 * 3600000);
    return x.toISOString().slice(0, 10);
  };
  return { start: fmt(monday), end: fmt(sunday) };
}

function nowIso() {
  const d = new Date();
  const tz = d.getTimezoneOffset();
  const sign = tz <= 0 ? '+' : '-';
  const abs = Math.abs(tz);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  const local = new Date(d.getTime() - tz * 60000).toISOString().slice(0, 19);
  return `${local}${sign}${hh}:${mm}`;
}

// ========== FETCH ==========
function fetchRecords(table_id, filter, fields, app_token = CONFIG.app_token) {
  const payload = { automatic_fields: false, field_names: fields };
  if (filter) payload.filter = filter;
  const data = JSON.stringify(payload);
  const params = JSON.stringify({ page_size: 500 });
  const cmd = `lark-cli api POST "/open-apis/bitable/v1/apps/${app_token}/tables/${table_id}/records/search" --as user --data '${data.replace(/'/g, "'\\''")}' --params '${params}' --page-all 2>/dev/null`;
  const out = sh(cmd, { maxBuffer: 64 * 1024 * 1024 });
  const j = JSON.parse(out);
  if (j.code !== 0) throw new Error(`API error: ${JSON.stringify(j)}`);
  return j.data.items || [];
}

function fetchProjects() {
  // 合作平台 contains "知乎" → 匹配 "知乎" + "知乎-MCN"（事业部口径）
  return fetchRecords(CONFIG.table_id, {
    conjunction: 'and',
    conditions: [
      { field_name: '合作平台', operator: 'contains', value: ['知乎'] },
      { field_name: '建项时间', operator: 'isGreater', value: ['ExactDate', String(YEAR_START)] },
      { field_name: '建项时间', operator: 'isLess', value: ['ExactDate', String(YEAR_END)] },
    ],
  }, ['项目ID', '项目名称', '建项时间', '合作平台', '订单总金额', '销售经理1', '项目经理1',
       '累计认款金额自动计算', '客户全称', '业务板块-多选',
       '品牌业务', '效果业务', '博主业务', '素人业务',
       '利润率', '毛利率预估', '利润', '待回款金额', '项目状态', '结案日期']);
}

function fetchCommerceOpps() {
  // 销售商机管理 (tblFBP8dLyaCmps0) in 2026知乎事业部大表
  // Filter: 合作平台 contains 知乎 （含知乎-MCN） AND 提交时间∈2026
  return fetchRecords(CONFIG.planning_sales_opp_table, {
    conjunction: 'and',
    conditions: [
      { field_name: '合作平台', operator: 'contains', value: ['知乎'] },
      { field_name: '提交时间', operator: 'isGreater', value: ['ExactDate', String(YEAR_START)] },
      { field_name: '提交时间', operator: 'isLess', value: ['ExactDate', String(YEAR_END)] },
    ],
  }, ['商机编号', '商务', '客户名称', '合作平台', '跟进阶段', '商机总金额',
      '提交时间', '赢单输单时间', '流失原因（流失商机需填写）', '项目经理', '下单分配时间'],
    CONFIG.planning_app_token);
}

function fetchPlanningOrders() {
  // 策划下单管理 (tblcBYRfUPDqxnnH)；该 app 整体=2026知乎事业部，无需平台filter
  // Filter: 下单日期∈2026
  return fetchRecords(CONFIG.planning_planning_order_table, {
    conjunction: 'and',
    conditions: [
      { field_name: '下单日期', operator: 'isGreater', value: ['ExactDate', String(YEAR_START)] },
      { field_name: '下单日期', operator: 'isLess', value: ['ExactDate', String(YEAR_END)] },
    ],
  }, ['商机编号', '商务', '客户', '接单策划', '下单日期', '提交日期', '开标日期',
      '策划更新实际赢单输单', '赢单或输单理由', '预算', '需求评级'],
    CONFIG.planning_app_token);
}

function fetchSettlements() {
  return fetchRecords(CONFIG.settlement_table_id, {
    conjunction: 'and',
    conditions: [
      { field_name: '资金池回款日期', operator: 'isGreater', value: ['ExactDate', String(YEAR_START)] },
      { field_name: '资金池回款日期', operator: 'isLess', value: ['ExactDate', String(YEAR_END)] },
    ],
  }, ['项目ID', '资金池回款日期', '认款金额', '平台']);
}

// ========== EVENTS (v0.1) ==========
function buildProjectEvents(projects) {
  const now = Date.now();
  const items = projects.map(p => {
    const ts = p.fields['建项时间'];
    const closeTs = getText(p.fields['结案日期']) || null;  // text field, may be "2026/03/27"
    const task_type = [];
    [['品牌业务', '品牌'], ['效果业务', '效果'], ['博主业务', '博主'], ['素人业务', '素人']]
      .forEach(([f, k]) => { if (parseAmount(p.fields[f]) > 0) task_type.push(k); });
    const tags = getSelects(p.fields['业务板块-多选']);
    // 利润率：优先"利润率"字段（结案录入），fallback"毛利率预估"（预估）
    const profit_rate_actual_raw = p.fields['利润率'];
    const profit_rate_estim_raw = p.fields['毛利率预估'];
    let profit_rate = null;
    let profit_rate_source = null;
    if (profit_rate_actual_raw != null) {
      profit_rate = parseAmount(profit_rate_actual_raw);
      profit_rate_source = 'actual';
    } else if (profit_rate_estim_raw != null) {
      const v = parseAmount(profit_rate_estim_raw);
      if (v !== 0 || String(profit_rate_estim_raw).trim() !== '') {
        profit_rate = v;
        profit_rate_source = 'estimate';
      }
    }
    const profit_amount_raw = p.fields['利润'];
    const profit_amount = profit_amount_raw != null ? parseAmount(profit_amount_raw) : null;
    const platform_detail = getText(p.fields['合作平台']);
    const order_amount = parseAmount(p.fields['订单总金额']);
    const collected_amount = parseAmount(p.fields['累计认款金额自动计算']);
    const pending_amount = parseAmount(p.fields['待回款金额']);
    const is_overdue = pending_amount > 0 && ts && (now - ts) > CONFIG.overdue_threshold_days * 86400000;
    const weekRange = ts ? isoWeekRange(ts) : null;
    // turnaround_days: 结案日期 - 建项时间（天数）；未结案=null
    let turnaround_days = null;
    if (closeTs && ts) {
      const closeMs = Date.parse(closeTs.replace(/\//g, '-'));
      if (!isNaN(closeMs)) {
        turnaround_days = Math.round((closeMs - ts) / 86400000);
        if (turnaround_days < 0) turnaround_days = null;  // bad data
      }
    }
    return {
      project_id: getText(p.fields['项目ID']),
      created_at: toIsoDate(ts),
      created_week: ts ? isoWeek(ts) : null,
      created_week_start_date: weekRange?.start || null,
      created_week_end_date: weekRange?.end || null,
      created_month: ts ? isoMonth(ts) : null,
      client: getText(p.fields['客户全称']),
      platform: 'knowledge',  // unified for 事业部
      platform_detail,        // "知乎" or "知乎-MCN"
      sales: getText(p.fields['销售经理1']) || null,
      pm: getText(p.fields['项目经理1']) || null,
      task_type,              // derived from 4 flag fields
      tags,                   // 业务板块-多选 (mostly empty currently)
      order_amount: Math.round(order_amount),
      collected_amount: Math.round(collected_amount),
      pending_amount: Math.round(pending_amount),
      profit_rate,            // decimal, null if neither actual nor estimate available
      profit_rate_source,     // 'actual' | 'estimate' | null
      profit_amount: profit_amount != null ? Math.round(profit_amount) : null,
      status: getText(p.fields['项目状态']) || null,
      closed_at: closeTs || null,
      turnaround_days,        // 结案-建项 天数；未结案=null
      is_overdue,
    };
  });
  return {
    schema_version: '0.1',
    generated_at: nowIso(),
    filter: `合作平台∈{${CONFIG.platforms.join(',')}} & 建项时间=${CONFIG.year}`,
    count: items.length,
    items,
  };
}

function buildSettlementEvents(settlements, projectIndex) {
  // filter 知乎事业部
  const zhihu = settlements.filter(s => {
    const t = s.fields['平台']?.value?.[0]?.text || '';
    return t.includes('知乎');
  });
  const items = zhihu.map(s => {
    const ts = s.fields['资金池回款日期'];
    const pid = getText(s.fields['项目ID']);
    const proj = projectIndex[pid] || {};
    return {
      project_id: pid,
      collected_at: toIsoDate(ts),
      collected_week: ts ? isoWeek(ts) : null,
      collected_month: ts ? isoMonth(ts) : null,
      collected_year: ts ? new Date(ts + 8 * 3600000).toISOString().slice(0, 4) : null,
      amount: Math.round(parseAmount(s.fields['认款金额'])),
      platform_detail: s.fields['平台']?.value?.[0]?.text || null,
      sales: proj.sales || null,  // join from project
    };
  });
  return {
    schema_version: '0.1',
    generated_at: nowIso(),
    filter: `平台含"知乎" & 资金池回款日期=${CONFIG.year}`,
    count: items.length,
    items,
  };
}

// ========== EVENTS (v0.2 dispatches + outcomes) ==========

// commerce side: 销售商机管理 → dispatches + outcomes
function buildCommerceEvents(opps) {
  const dispatches = [];
  const outcomes = [];
  opps.forEach(o => {
    const f = o.fields;
    const dispatch_id = getText(f['商机编号']);
    if (!dispatch_id) return;
    const dispatched_at_ts = f['提交时间'];
    const settled_at_ts = f['赢单输单时间'] || null;
    const status = getText(f['跟进阶段']);  // 待接触|初步提议|方案报价|协商议价|赢单|流失
    const sales = getUser(f['商务']);
    const pm = getUser(f['项目经理']);
    const client = getLinkText(f['客户名称']) || null;
    const platform = Array.isArray(f['合作平台']) ? f['合作平台'][0] : (f['合作平台'] || null);
    const amount = Math.round(parseAmount(f['商机总金额']));
    const reason = getText(f['流失原因（流失商机需填写）']) || null;

    dispatches.push({
      dispatch_id,
      side: 'commerce',
      dispatched_at: toIsoDate(dispatched_at_ts),
      sales, pm, client, platform, amount, status,
    });

    // outcomes: 每个商机一条，outcome = won/lost/null(进行中)
    let outcome = null;
    if (status === '赢单') outcome = 'won';
    else if (status === '流失') outcome = 'lost';
    outcomes.push({
      outcome_id: `${dispatch_id}:commerce`,
      dispatch_id,
      side: 'commerce',
      settled_at: outcome ? toIsoDate(settled_at_ts) : null,
      outcome,
      reason: outcome === 'lost' ? reason : null,
      sales, pm, client, amount,
    });
  });
  return { dispatches, outcomes };
}

// planning side: 策划下单管理 → dispatches + outcomes
function buildPlanningEvents(orders) {
  const dispatches = [];
  const outcomes = [];
  orders.forEach(o => {
    const f = o.fields;
    const dispatch_id = getText(f['商机编号']);
    if (!dispatch_id) return;
    const dispatched_at_ts = f['下单日期'];
    const settled_at_ts = f['开标日期'] || null;
    const status = getText(f['策划更新实际赢单输单']);  // 赢单|输单|跟进中
    const sales = getUser(f['商务']);
    const pm = getUser(f['接单策划']);
    const client = getLinkText(f['客户']) || null;
    const amount = Math.round(parseAmount(f['预算']));
    const reason = getText(f['赢单或输单理由']) || null;
    const priority = getText(f['需求评级']) || null;  // S|A|B

    dispatches.push({
      dispatch_id,
      side: 'planning',
      dispatched_at: toIsoDate(dispatched_at_ts),
      sales, pm, client, platform: null, amount, status, priority,
    });

    let outcome = null;
    if (status === '赢单') outcome = 'won';
    else if (status === '输单') outcome = 'lost';
    outcomes.push({
      outcome_id: `${dispatch_id}:planning`,
      dispatch_id,
      side: 'planning',
      settled_at: outcome ? toIsoDate(settled_at_ts) : null,
      outcome,
      reason: outcome ? reason : null,
      sales, pm, client, amount,
    });
  });
  return { dispatches, outcomes };
}

function wrapEvents(items, filter) {
  return { schema_version: '0.2', generated_at: nowIso(), filter, count: items.length, items };
}

// ========== AGGREGATE ==========
function aggregate(projects, settlements, planningDispatches = [], commerceDispatches = []) {
  const quality = { total_projects: projects.length, issues: [] };

  // business.kpi
  // 双口径：
  //   主 B = settlements 资金池回款日期∈2026 & 平台含"知乎"（曹栩瑄标准口径）
  //   副 A = projects 累计认款金额自动计算（项目维度聚合，历史口径）
  let orderTotal = 0, collectedProjectBased = 0;
  const clients = new Set();
  projects.forEach(p => {
    orderTotal += parseAmount(p.fields['订单总金额']);
    collectedProjectBased += parseAmount(p.fields['累计认款金额自动计算']);
    const c = getText(p.fields['客户全称']);
    if (c) clients.add(c);
  });

  // 主口径B：settlements 知乎事业部
  const zhihuSettlementsForKpi = settlements.filter(s => {
    const t = s.fields['平台']?.value?.[0]?.text || '';
    return t.includes('知乎');
  });
  const collectedSettlementBased = zhihuSettlementsForKpi.reduce(
    (a, s) => a + parseAmount(s.fields['认款金额']), 0
  );

  // 项目扭转周期 + 结算项目数（栩瑄 2026-04-13 新增；结案日期为空不参与统计）
  let settledCount = 0, turnaroundSum = 0, turnaroundN = 0;
  projects.forEach(p => {
    const ts = p.fields['建项时间'];
    const closeTs = getText(p.fields['结案日期']) || null;
    if (!closeTs) return;
    settledCount++;
    if (!ts) return;
    const closeMs = Date.parse(closeTs.replace(/\//g, '-'));
    if (isNaN(closeMs)) return;
    const days = Math.round((closeMs - ts) / 86400000);
    if (days < 0) return;
    turnaroundSum += days;
    turnaroundN++;
  });
  const avg_turnaround_days = turnaroundN > 0 ? Math.round((turnaroundSum / turnaroundN) * 10) / 10 : null;

  const business_kpi = {
    new_projects_count: projects.length,
    order_total_amount: Math.round(orderTotal),
    collected_amount: Math.round(collectedSettlementBased),            // 主B（曹栩瑄口径）
    collected_amount_project_based: Math.round(collectedProjectBased), // 副A（项目累计）
    new_clients_count: clients.size,
    settled_projects_count: settledCount,          // 结案日期非空的项目数
    avg_turnaround_days,                           // 已结案项目平均扭转天数
  };

  // business.trend_weekly
  const weekMap = {};
  projects.forEach(p => {
    const ts = p.fields['建项时间'];
    if (!ts) return;
    const w = isoWeek(ts);
    if (!weekMap[w]) {
      const r = isoWeekRange(ts);
      weekMap[w] = { week: w, week_start_date: r.start, week_end_date: r.end, new_projects: 0, order_amount: 0, _ts: ts };
    }
    weekMap[w].new_projects++;
    weekMap[w].order_amount += parseAmount(p.fields['订单总金额']);
  });
  const trend_weekly = Object.values(weekMap)
    .sort((a, b) => a._ts - b._ts)
    .map(({ _ts, ...rest }) => ({ ...rest, order_amount: Math.round(rest.order_amount) }));

  // business.task_type_distribution
  // 业务板块-多选 在2026知乎数据中基本为空，改用4个flag字段(品牌/效果/博主/素人)聚合
  const taskMap = { '品牌': 0, '效果': 0, '博主': 0, '素人': 0 };
  let taskUnknown = 0;
  projects.forEach(p => {
    let matched = false;
    [['品牌业务', '品牌'], ['效果业务', '效果'], ['博主业务', '博主'], ['素人业务', '素人']].forEach(([f, k]) => {
      if (parseAmount(p.fields[f]) > 0) { taskMap[k]++; matched = true; }
    });
    // fallback: 业务板块-多选
    if (!matched) {
      const types = getSelects(p.fields['业务板块-多选']);
      if (types.length) {
        types.forEach(t => { taskMap[t] = (taskMap[t] || 0) + 1; });
      } else {
        taskUnknown++;
      }
    }
  });
  if (taskUnknown > 0) {
    taskMap['未分类'] = taskUnknown;
    quality.issues.push(`${taskUnknown} 条记录业务板块为空`);
  }
  const task_type_distribution = Object.entries(taskMap)
    .filter(([_, v]) => v > 0)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  // business.top_sales
  const salesMap = {};
  let salesMissing = 0;
  projects.forEach(p => {
    const s = getText(p.fields['销售经理1']);
    if (!s) { salesMissing++; return; }
    if (!salesMap[s]) salesMap[s] = { name: s, order_amount: 0, project_count: 0 };
    salesMap[s].order_amount += parseAmount(p.fields['订单总金额']);
    salesMap[s].project_count++;
  });
  if (salesMissing > 0) quality.issues.push(`${salesMissing} 条记录销售经理1为空`);
  const top_sales = Object.values(salesMap)
    .map(s => ({ ...s, order_amount: Math.round(s.order_amount) }))
    .sort((a, b) => b.order_amount - a.order_amount)
    .slice(0, CONFIG.top_n);

  // business.top_pm — 项目经理1 排行榜（栩瑄 2026-04-13 要求新增）
  const pmMap = {};
  let pmMissing = 0;
  projects.forEach(p => {
    const m = getText(p.fields['项目经理1']);
    if (!m) { pmMissing++; return; }
    if (!pmMap[m]) pmMap[m] = { name: m, order_amount: 0, project_count: 0 };
    pmMap[m].order_amount += parseAmount(p.fields['订单总金额']);
    pmMap[m].project_count++;
  });
  if (pmMissing > 0) quality.issues.push(`${pmMissing} 条记录项目经理1为空`);
  const top_pm = Object.values(pmMap)
    .map(m => ({ ...m, order_amount: Math.round(m.order_amount) }))
    .sort((a, b) => b.order_amount - a.order_amount)
    .slice(0, CONFIG.top_n);

  // business.profit_rate_distribution — "利润率" 字段的分布（actual only，结项触发录入）
  // 另提供 profit_rate_distribution_combined，把 fallback 到"毛利率预估"的合并进来（区分source）
  const bucketsActual = { '<20%': 0, '20-40%': 0, '40-60%': 0, '>60%': 0 };
  const bucketsEstim  = { '<20%': 0, '20-40%': 0, '40-60%': 0, '>60%': 0 };
  const bucketOf = (pct) => pct < 20 ? '<20%' : pct < 40 ? '20-40%' : pct < 60 ? '40-60%' : '>60%';
  let profitMissingActual = 0, profitMissingAny = 0;
  projects.forEach(p => {
    const hasActual = p.fields['利润率'] != null;
    const estimRaw  = p.fields['毛利率预估'];
    const hasEstim  = estimRaw != null && String(estimRaw).trim() !== '';
    if (!hasActual) profitMissingActual++;
    if (!hasActual && !hasEstim) { profitMissingAny++; return; }
    if (hasActual) {
      const pct = parseAmount(p.fields['利润率']) * 100;
      bucketsActual[bucketOf(pct)]++;
    } else {
      const pct = parseAmount(estimRaw) * 100;
      bucketsEstim[bucketOf(pct)]++;
    }
  });
  if (profitMissingActual > 0) quality.issues.push(`${profitMissingActual} 条记录利润率(actual)为空；其中${profitMissingActual - profitMissingAny}条有毛利率预估可fallback`);
  const profit_rate_distribution = Object.entries(bucketsActual)
    .map(([range, count]) => ({ range, count }));
  const profit_rate_distribution_combined = Object.entries(bucketsActual)
    .map(([range, _]) => ({
      range,
      actual: bucketsActual[range],
      estimate: bucketsEstim[range],
      total: bucketsActual[range] + bucketsEstim[range],
    }));
  const profit_rate_coverage = {
    actual: projects.length - profitMissingActual,
    estimate: profitMissingActual - profitMissingAny,
    none: profitMissingAny,
    total: projects.length,
  };

  // business.alerts — 低利润率告警仍基于actual（防止预估噪声触发告警）
  const lowProfit = bucketsActual['<20%'];
  const now = Date.now();
  let overdue = 0;
  projects.forEach(p => {
    const pending = parseAmount(p.fields['待回款金额']);
    const ts = p.fields['建项时间'];
    if (pending > 0 && ts && (now - ts) > CONFIG.overdue_threshold_days * 86400000) {
      overdue++;
    }
  });
  const alerts = [
    { type: '利润率<20%', count: lowProfit },
    { type: `账期超期(>${CONFIG.overdue_threshold_days}天)`, count: overdue },
  ];

  // weekly_meeting: 回款 by week (from settlements, 知乎事业部=知乎+知乎-MCN)
  const zhihuSettlements = settlements.filter(s => {
    const t = s.fields['平台']?.value?.[0]?.text || '';
    return t.includes('知乎');
  });
  const collectionWeekMap = {};
  zhihuSettlements.forEach(s => {
    const ts = s.fields['资金池回款日期'];
    if (!ts) return;
    const w = isoWeek(ts);
    if (!collectionWeekMap[w]) collectionWeekMap[w] = { amount: 0, count: 0, _ts: ts };
    collectionWeekMap[w].amount += parseAmount(s.fields['认款金额']);
    collectionWeekMap[w].count++;
  });
  const collectionTotal = zhihuSettlements.reduce((a, s) => a + parseAmount(s.fields['认款金额']), 0);

  // planning 侧周聚合（下单日期）
  const planningWeekMap = {};
  planningDispatches.forEach(d => {
    if (!d.dispatched_at) return;
    const ts = Date.parse(d.dispatched_at);
    if (isNaN(ts)) return;
    const w = isoWeek(ts);
    planningWeekMap[w] = (planningWeekMap[w] || 0) + 1;
  });

  const trend_combined = trend_weekly.map(t => ({
    week: t.week,
    week_start_date: t.week_start_date,
    week_end_date: t.week_end_date,
    business: t.new_projects,
    planning: planningWeekMap[t.week] || 0,
    collection: Math.round(collectionWeekMap[t.week]?.amount || 0),
  }));

  return {
    meta: {
      updated_at: nowIso(),
      period: `${CONFIG.year} YTD`,
      filter: `合作平台∈{${CONFIG.platforms.join(',')}} & 建项时间=${CONFIG.year}`,
      alert_count: alerts.reduce((a, b) => a + b.count, 0),
    },
    business: {
      kpi: business_kpi,
      trend_weekly,
      task_type_distribution,
      top_sales,
      top_pm,
      profit_rate_distribution,
      profit_rate_distribution_combined,
      profit_rate_coverage,
      alerts,
    },
    planning: {
      kpi: {
        dispatched_count: null,
        won_count: null,
        lost_count: null,
        win_rate: null,
      },
      trend_monthly: [],
      top_pm: [],
      lost_reasons: [],
      _note: 'planning数据待曹栩瑄提供2026事业部大表app_token后补',
    },
    weekly_meeting: {
      kpi_combined: {
        business_project_count: projects.length,
        planning_order_count: planningDispatches.length,
        commerce_opp_count: commerceDispatches.length,
        collected_amount: Math.round(collectionTotal),
        collection_count: zhihuSettlements.length,
      },
      trend_combined,
      mom_yoy: [
        { metric: '回款', current: Math.round(collectionTotal), mom_pct: null, yoy_pct: null },
        { metric: '建项', current: projects.length, mom_pct: null, yoy_pct: null },
      ],
    },
    _quality: quality,
  };
}

// ========== MAIN ==========
function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const noPush = args.includes('--no-push');

  console.log('[1/6] Fetching 项目结算 records...');
  const projects = fetchProjects();
  console.log(`     → ${projects.length} records`);

  console.log('[2/6] Fetching 认款单据 records...');
  const settlements = fetchSettlements();
  console.log(`     → ${settlements.length} records`);

  console.log('[3/6] Fetching 销售商机 (commerce) records...');
  let commerceOpps = [];
  try {
    commerceOpps = fetchCommerceOpps();
    console.log(`     → ${commerceOpps.length} records`);
  } catch (e) {
    console.log(`     → SKIP (${e.message.slice(0, 120)})`);
  }

  console.log('[4/6] Fetching 策划下单 (planning) records...');
  let planningOrders = [];
  try {
    planningOrders = fetchPlanningOrders();
    console.log(`     → ${planningOrders.length} records`);
  } catch (e) {
    console.log(`     → SKIP (${e.message.slice(0, 120)})`);
  }

  console.log('[5/6] Aggregating...');
  const commerce = buildCommerceEvents(commerceOpps);
  const planning = buildPlanningEvents(planningOrders);
  const result = aggregate(projects, settlements, planning.dispatches, commerce.dispatches);
  const quality = result._quality;
  delete result._quality;

  if (dryRun) {
    console.log(JSON.stringify(result, null, 2));
    console.log('\n=== Data Quality ===');
    console.log(JSON.stringify(quality, null, 2));
    return;
  }

  // Write latest.json (backward compat)
  const outPath = path.join(CONFIG.repo_dir, 'latest.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
  console.log(`     → written to ${outPath}`);

  // Write events/ (v0.1 projects+settlements, v0.2 dispatches+outcomes)
  const eventsDir = path.join(CONFIG.repo_dir, 'events');
  if (!fs.existsSync(eventsDir)) fs.mkdirSync(eventsDir, { recursive: true });
  const projectEvents = buildProjectEvents(projects);
  const projectIndex = {};
  projectEvents.items.forEach(p => { projectIndex[p.project_id] = p; });
  const settlementEvents = buildSettlementEvents(settlements, projectIndex);

  // v0.2: commerce + planning dispatches split; outcomes merged (side-tagged)
  const commerceDispatchesFile = wrapEvents(commerce.dispatches,
    `销售商机:合作平台contains"知乎" & 提交时间=${CONFIG.year}`);
  const planningDispatchesFile = wrapEvents(planning.dispatches,
    `策划下单:下单日期=${CONFIG.year}（2026知乎事业部大表，整app=知乎）`);
  const outcomesFile = wrapEvents([...commerce.outcomes, ...planning.outcomes],
    `commerce(赢单输单时间) + planning(开标日期) ∈ ${CONFIG.year}`);

  fs.writeFileSync(path.join(eventsDir, 'projects.json'), JSON.stringify(projectEvents, null, 2) + '\n');
  fs.writeFileSync(path.join(eventsDir, 'settlements.json'), JSON.stringify(settlementEvents, null, 2) + '\n');
  fs.writeFileSync(path.join(eventsDir, 'commerce_dispatches.json'), JSON.stringify(commerceDispatchesFile, null, 2) + '\n');
  fs.writeFileSync(path.join(eventsDir, 'planning_dispatches.json'), JSON.stringify(planningDispatchesFile, null, 2) + '\n');
  fs.writeFileSync(path.join(eventsDir, 'outcomes.json'), JSON.stringify(outcomesFile, null, 2) + '\n');
  // Remove deprecated v0.1 placeholder dispatches.json if present
  const legacyDispatches = path.join(eventsDir, 'dispatches.json');
  if (fs.existsSync(legacyDispatches)) fs.unlinkSync(legacyDispatches);
  const meta = {
    schema_version: '0.2',
    generated_at: nowIso(),
    files: {
      'latest.json': '兼容层：YTD聚合KPI',
      'events/projects.json': '项目事实表（每行1项目，含turnaround_days）',
      'events/settlements.json': '回款事实表（每行1笔认款）',
      'events/commerce_dispatches.json': '商务侧派单（销售商机管理 tblFBP8dLyaCmps0）',
      'events/planning_dispatches.json': '策划侧派单（策划下单管理 tblcBYRfUPDqxnnH）',
      'events/outcomes.json': '赢/输单合并（side=commerce|planning；outcome=won|lost|null进行中）',
    },
    filter_scope: `合作平台∈{${CONFIG.platforms.join(',')}} & 建项时间=${CONFIG.year}`,
    counts: {
      projects: projectEvents.count,
      settlements: settlementEvents.count,
      commerce_dispatches: commerceDispatchesFile.count,
      planning_dispatches: planningDispatchesFile.count,
      outcomes: outcomesFile.count,
    },
  };
  fs.writeFileSync(path.join(eventsDir, '_meta.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(`     → events/ written (projects=${projectEvents.count}, settlements=${settlementEvents.count}, commerce=${commerceDispatchesFile.count}, planning=${planningDispatchesFile.count}, outcomes=${outcomesFile.count})`);

  if (noPush) {
    console.log('[6/6] Skipped git push (--no-push)');
    return { result, quality };
  }

  console.log('[6/6] Git push...');
  try {
    sh(`git -C "${CONFIG.repo_dir}" add latest.json events/`);
    const msg = `sync: ${result.meta.updated_at} — ${projects.length} projects, ¥${result.business.kpi.order_total_amount}`;
    sh(`git -C "${CONFIG.repo_dir}" commit -m "${msg}"`);
    sh(`git -C "${CONFIG.repo_dir}" push origin main`);
    console.log('     → pushed');
  } catch (e) {
    const msg = String(e.stdout || e.stderr || e.message);
    if (msg.includes('nothing to commit')) {
      console.log('     → no changes');
    } else {
      throw e;
    }
  }

  console.log('\n=== Data Quality ===');
  console.log(JSON.stringify(quality, null, 2));
  return { result, quality };
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error('FATAL:', e.message);
    process.exit(1);
  }
}

module.exports = { main, aggregate };
