# 万言书 交接手册 · 言书商务策数据看板数据同步

**你的角色（2026-04-13 波总确认）**：数据环节owner。每次源表有变化或栩瑄提出数据调整需求，你负责跑这个skill同步最新数据；前端页面更新由 Zylos 负责，你只需要在数据push完成后HXA call Zylos即可。

## 日常操作（3步）

### 1. 跑sync

```bash
node ~/zylos/.claude/skills/zhihu-dashboard/scripts/sync.js
```

如果你想先看数据对不对，先dry-run：

```bash
node ~/zylos/.claude/skills/zhihu-dashboard/scripts/sync.js --dry-run
```

### 2. 看数据质量报告

脚本末尾会打印：

```
=== Data Quality ===
{
  "total_projects": 219,
  "issues": [...]
}
```

issues 是非致命 warning（空值统计），看一眼对比历史数量即可。如果total_projects有**大偏差**（>30%），先别push，check源表筛选是否坏了。

### 3. 通知 Zylos

push成功后，commit hash会打印在输出里。HXA call Zylos：

```bash
cat <<EOF | node ~/zylos/.claude/skills/comm-bridge/scripts/c4-send.js "hxa-connect" "zylos"
看板数据已sync push（commit <hash>），麻烦前端联调。
EOF
```

Zylos接到会触发Vercel redeploy，zhiw.ai/zhihu-dashboard 1-2分钟后生效。

## 异常处理

| 现象 | 根因 | 处理 |
|------|------|------|
| `API error: {code: 1254003, ...}` | 字段名写错/filter字段类型不对 | 核对 references/sources.md 字段清单 |
| `permission denied` | lark-cli 未用 user 态 | 重新 `lark-cli auth --as user` |
| `nothing to commit` | 数据无变化 | 正常，打印到 stdout，不视为错误 |
| git push 被拒 | remote有更新 | `git -C ~/zylos/workspace/yanshu-dashboard/repo pull --rebase` 再跑sync |
| total数量异常 | 源表filter问题或字段重命名 | 先 `--dry-run` 排查 |

## 栩瑄加了新需求怎么办

分两种：

### 数据侧改动（你处理）
- 新增字段/新增KPI/新增过滤条件/新增聚合维度
- 改 `scripts/sync.js` → `--dry-run` 验证 → 去掉 `--dry-run` 正式跑 → HXA通知Zylos
- 如果涉及schema变更（events/*.json字段改），**先同步Zylos schema约定再改**

### 展示侧改动（Zylos处理）
- 图表隐藏/显示、面板排序、颜色、tooltip、时间筛选器
- 直接HXA转给Zylos，不用改skill

**分辨关键**：栩瑄说"要加XX字段/改XX口径" → 数据侧；"要隐藏/高亮/排序/显示为" → 展示侧。

## 待栩瑄口径（需要时主动问）

当下3个待定项，遇到再问栩瑄：

1. **客户分层** — 用于账期超期阈值分层（当前全局30天）
2. **利润率口径** — 是否继续 actual优先 fallback estimate（当前77 actual + 102 estimate + 40 null）
3. **mom_yoy同比基数** — 需要2025全年数据，现在全null

## 联调链条

```
源表（飞书多维表）
    ↓ lark-cli fetch
scripts/sync.js（本skill）
    ↓ git push
with3ai/zhihu-dashboard-data@main（GitHub仓库）
    ↓ Vercel webhook
zhiw.ai/zhihu-dashboard（线上页面）← Zylos的前端代码负责render
```

你管到git push为止，push完HXA通知Zylos。

## 联系人

| 人 | 角色 | 渠道 |
|----|------|------|
| 曹栩瑄 | 源表owner + 口径决策 | 言书商务策数据看板群 |
| 朱秀芳 | 数据看板第二用户 | 同群 |
| Zylos | 前端面板owner | HXA-Connect DM |
| 贺小波 | 总拍板 | 同群 / DM |

## SS → 万言书 首次交接要点（2026-04-13）

- skill刚封装完，最后一次sync commit = `070dd70`（backend），对应前端 Zylos commit = `9a6bd42`
- 栩瑄2026-04-13当日确认的8条规则已全部内置到 sources.md
- 数据看板URL：https://www.zhiw.ai/zhihu-dashboard
- GitHub repo：https://github.com/with3ai/zhihu-dashboard-data

有问题随时HXA call SS或发群里找栩瑄。
