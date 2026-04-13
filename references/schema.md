# Events Schema v0.2

**产出路径**：`~/zylos/workspace/yanshu-dashboard/repo/events/`

每个文件格式：
```json
{
  "schema_version": "0.2",
  "generated_at": "ISO8601 +08:00",
  "filter": "人类可读的过滤条件描述",
  "count": 123,
  "items": [...]
}
```

## projects.json（v0.1字段，新增turnaround_days）

每行=1个项目（knowledge事业部 2026 YTD，219条）。

```ts
{
  project_id: string,                    // 项目ID
  created_at: ISO8601,                   // 建项时间
  created_week: "W1"..."W52",
  created_week_start_date: "YYYY-MM-DD", // 周一（CST）
  created_week_end_date: "YYYY-MM-DD",   // 周日
  created_month: "YYYY-MM",
  client: string,
  platform: "knowledge",                 // 统一事业部标签
  platform_detail: "知乎" | "知乎-MCN",
  sales: string | null,                  // 销售经理1
  pm: string | null,                     // 项目经理1
  task_type: string[],                   // 由4个业务flag派生，不拆分
  tags: string[],                        // 业务板块-多选（当前多为空）
  order_amount: number,                  // 订单总金额（整数）
  collected_amount: number,              // 累计认款（副A口径，项目聚合）
  pending_amount: number,                // 待回款
  profit_rate: number | null,            // 小数 0.3=30%；actual优先 fallback estimate
  profit_rate_source: "actual" | "estimate" | null,
  profit_amount: number | null,          // 利润金额
  status: string | null,                 // 项目状态
  closed_at: "YYYY/MM/DD" | null,        // 结案日期（文本原样）
  turnaround_days: number | null,        // 结案-建项 天；未结案null；负值null
  is_overdue: boolean                    // 待回款>0 且 > overdue_threshold_days
}
```

## settlements.json（回款事件）

每行=1笔认款（知乎事业部，230条）。

```ts
{
  project_id: string,
  collected_at: ISO8601,
  collected_week: "Wn",
  collected_month: "YYYY-MM",
  collected_year: "YYYY",
  amount: number,
  platform_detail: "知乎" | "知乎-MCN" | null,
  sales: string | null  // join from project
}
```

主B回款总额 = `items.amount` 求和（latest.json 的 `business.kpi.collected_amount`）。

## commerce_dispatches.json（商务侧派单）

每行=1个商机（51条，2026知乎）。

```ts
{
  dispatch_id: string,           // 商机编号
  side: "commerce",
  dispatched_at: ISO8601,        // 提交时间
  sales: string | null,          // 商务
  pm: string | null,             // 项目经理
  client: string | null,         // 客户名称（commerce侧为link-id，常为null）
  platform: "知乎" | null,
  amount: number,                // 商机总金额
  status: "待接触"|"初步提议"|"方案报价"|"协商议价"|"赢单"|"流失"
}
```

## planning_dispatches.json（策划侧派单）

每行=1个策划下单（17条，2026全部）。

```ts
{
  dispatch_id: string,           // 商机编号（可能偶尔是自由文本如"公司介绍2026"）
  side: "planning",
  dispatched_at: ISO8601,        // 下单日期
  sales: string | null,
  pm: string | null,             // 接单策划
  client: string | null,
  platform: null,
  amount: number,                // 预算
  status: "赢单"|"输单"|"跟进中",
  priority: "S"|"A"|"B" | null   // 需求评级
}
```

## outcomes.json（赢/输单合并）

每行=1个派单的结果（68条=51商务+17策划；outcome可能为null表示进行中）。

```ts
{
  outcome_id: string,            // "ZH25xxxx:commerce" 或 "ZH26xxxx:planning"
  dispatch_id: string,           // 对应dispatches表的dispatch_id
  side: "commerce" | "planning",
  settled_at: ISO8601 | null,    // 仅won/lost有值
  outcome: "won" | "lost" | null,
  reason: string | null,         // lost场景commerce=流失原因；planning=赢单或输单理由
  sales: string | null,
  pm: string | null,
  client: string | null,
  amount: number
}
```

`outcome=null` 表示进行中（跟进中/待接触/方案报价等），`settled_at` 也为null。

## latest.json（聚合KPI，兼容层）

给前端 applyRange 做参考基线，实际前端的 computeBusiness/computePlanning/computeWeekly 从events在客户端重算（Zylos实现）。

```ts
{
  meta: { updated_at, period, filter, alert_count },
  business: {
    kpi: {
      new_projects_count, order_total_amount,
      collected_amount,                 // 主B ¥10.18M（栩瑄口径）
      collected_amount_project_based,   // 副A ¥2.74M（对照保留）
      new_clients_count,
      settled_projects_count,           // 结案非空的项目数（栩瑄2026-04-13新增）
      avg_turnaround_days               // 已结案平均扭转天数
    },
    trend_weekly: [{ week, week_start_date, week_end_date, new_projects, order_amount }],
    task_type_distribution: [{name,value}],   // 后端保留，前端隐藏
    top_sales: [{name, order_amount, project_count}],  // 销售经理1空已排除
    top_pm: [{name, order_amount, project_count}],     // 项目经理1空已排除
    profit_rate_distribution: [...],      // 仅actual
    profit_rate_distribution_combined: [{range, actual, estimate, total}],
    profit_rate_coverage: {actual, estimate, none, total},
    alerts: [{type, count}]
  },
  planning: { ... },             // v0.2后主要靠events前端算；这里 top_pm/lost_reasons 保留占位
  weekly_meeting: {
    kpi_combined: {
      business_project_count, planning_order_count, commerce_opp_count,
      collected_amount, collection_count
    },
    trend_combined: [{ week, week_start_date, week_end_date, business, planning, collection }],
    mom_yoy: [...]               // 2025数据缺，当前null
  }
}
```

## _meta.json

```ts
{
  schema_version: "0.2",
  generated_at,
  files: { <file>: <desc> },
  filter_scope,
  counts: { projects, settlements, commerce_dispatches, planning_dispatches, outcomes }
}
```

## 版本演进

- **v0.1**（废弃）：projects + settlements + dispatches（占位）+ outcomes（占位）
- **v0.2**（当前）：
  - 拆分 `dispatches.json` → `commerce_dispatches.json` + `planning_dispatches.json`（side明确）
  - `outcomes.json` 合并两侧（side字段区分），每个派单1条，outcome=won/lost/null
  - projects 加 `turnaround_days`
  - latest.json business.kpi 加 `settled_projects_count` + `avg_turnaround_days`
  - latest.json weekly_meeting.kpi_combined 加 `commerce_opp_count`

## Schema稳定性承诺

- 已有字段**不删**不改语义（只加新字段）
- 加新字段时前端可逐步启用，不会break老前端
- schema大改要升v0.3，同时同步通知Zylos
