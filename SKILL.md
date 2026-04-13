---
name: zhihu-dashboard
description: 言书商务策数据看板的数据同步工具。抓取知乎事业部2026 YTD 4张飞书多维表格（项目结算/认款单据/销售商机/策划下单），输出events schema v0.2到 workspace/yanshu-dashboard/repo，push到with3ai/zhihu-dashboard-data，驱动 zhiw.ai/zhihu-dashboard 面板。Use when user asks 更新看板 / 刷数据 / sync dashboard / 数据同步 / 回款口径核对 / 触发Vercel重建.
---

# 言书商务策数据看板 · 数据同步 Skill

## 何时触发

- 用户说"更新看板"/"刷数据"/"同步看板"/"sync dashboard"
- 任何源表字段/筛选/口径变动后需要重跑
- 栩瑄群里flag数据异常后对齐口径
- 栩瑄/秀芳/波总要求面板更新

## 一键同步（最常用）

```bash
node ~/zylos/.claude/skills/zhihu-dashboard/scripts/sync.js
```

自动完成：抓取 → 聚合 → 写盘 → git commit + push → 打印数据质量报告。

Push成功后需**通知Zylos**（HXA call）触发前端Vercel redeploy：

```bash
cat <<EOF | node ~/zylos/.claude/skills/comm-bridge/scripts/c4-send.js "hxa-connect" "zylos"
看板数据已sync push（commit <hash>），麻烦前端联调 / 触发redeploy。
EOF
```

## Dry-run（不写盘 不推送）

先验数据对不对再push：

```bash
node ~/zylos/.claude/skills/zhihu-dashboard/scripts/sync.js --dry-run
# 或 --no-push 写盘但不git push
```

## 输出物

- `~/zylos/workspace/yanshu-dashboard/repo/latest.json` — 聚合KPI（兼容层）
- `~/zylos/workspace/yanshu-dashboard/repo/events/` — events schema v0.2
  - `projects.json` / `settlements.json`
  - `commerce_dispatches.json` / `planning_dispatches.json` / `outcomes.json`
  - `_meta.json`
- Git push to `with3ai/zhihu-dashboard-data@main`

## 高内聚低耦合拆解（6环节）

1. **抓取** `fetchProjects/fetchSettlements/fetchCommerceOpps/fetchPlanningOrders`
2. **转换** `buildProjectEvents/buildSettlementEvents/buildCommerceEvents/buildPlanningEvents`
3. **聚合** `aggregate(projects, settlements, planning, commerce)` → latest.json
4. **产出** main() 写 latest.json + events/*.json + _meta.json
5. **同步** git add/commit/push
6. **通知** 人工 HXA call Zylos

任一环节可独立替换而不影响其他（e.g. 换源表只改fetch；换schema只改build；换输出只改main末尾）。

## 参考文档

- `references/sources.md` — 源表 app_token / table_id / filter口径（含栩瑄双口径B主A副/知乎+MCN/结案日期null处理）
- `references/schema.md` — events v0.2 字段契约
- `references/handoff-yanshu.md` — 万言书交接手册（日常操作/异常处理/通知Zylos）

## 先决条件

- `lark-cli` 已装 + 用户态登录（`lark-cli auth --as user` 通过）
- `git` 已配置with3ai/zhihu-dashboard-data push权限（`~/zylos/workspace/yanshu-dashboard/repo` 即repo本地clone）
- Node.js ≥ 18

## 数据质量 warn（非致命）

sync结束打印如下样式，无需人工干预：

```
{
  "total_projects": 219,
  "issues": [
    "52 条记录业务板块为空",
    "50 条记录销售经理1为空",
    "142 条记录利润率(actual)为空；其中102条有毛利率预估可fallback"
  ]
}
```

## 待栩瑄口径（遇到再处理）

- 客户分层（用于账期超期阈值分层）
- 利润率口径（当前fallback：actual优先 → 毛利率预估 → null）

对应CONFIG：`CONFIG.overdue_threshold_days = 30`；`CONFIG.platforms = ['知乎','知乎-MCN']`。

## 常见问题

- **push失败** 一般是本地repo未pull或权限；`git -C ~/zylos/workspace/yanshu-dashboard/repo pull --rebase && 重跑sync.js`
- **API error code !== 0** 多半filter字段名/类型错；检查 references/sources.md字段清单
- **Vercel未刷新** 通常git push完成后1-2分钟内自动触发；超过5分钟让Zylos手动trigger
