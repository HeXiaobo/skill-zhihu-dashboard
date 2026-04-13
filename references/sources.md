# 源表与筛选口径

**更新日期**：2026-04-13（Sync #52 栩瑄确认后口径）

## 源表映射

| # | 表名 | app_token | table_id | 用途 |
|---|------|-----------|----------|------|
| 1 | 项目结算 | `SI5XbhPWWaZqmSscMWmc9B7rnzb` | `tblZ0yruevjhBIXB` | business.kpi/趋势/top_sales/top_pm/alerts/turnaround/settled，events/projects.json |
| 2 | 认款单据（客户） | `SI5XbhPWWaZqmSscMWmc9B7rnzb` | `tblMNgNTHaNs5bVo` | 回款主B口径，events/settlements.json |
| 3 | 销售商机管理 | `CqQAbPRj3a8xdVs6sd2cZrvwneh` | `tblFBP8dLyaCmps0` | commerce_dispatches + outcomes(side=commerce) |
| 4 | 策划下单管理 | `CqQAbPRj3a8xdVs6sd2cZrvwneh` | `tblcBYRfUPDqxnnH` | planning_dispatches + outcomes(side=planning) |

前2张 app_token `SI5X...` = 言书商务策数据看板主app（栩瑄owner）。
后2张 app_token `CqQA...` = 2026知乎事业部大表（栩瑄owner）。访问方式 `lark-cli --as user`（不用协作者权限，走用户态token）。

## 筛选口径

### 1. 项目结算（tblZ0yruevjhBIXB）
- `合作平台 contains "知乎"` → 命中"知乎" + "知乎-MCN"（事业部口径）
- `建项时间 ∈ [2026-01-01, 2027-01-01)` CST

### 2. 认款单据（tblMNgNTHaNs5bVo）
- `资金池回款日期 ∈ [2026-01-01, 2027-01-01)` CST
- 抓取后代码内过滤 `平台 contains "知乎"`（events/settlements.json + business.kpi.collected_amount）
- **主B口径**（栩瑄标准）= 这个过滤后的 认款金额 总和；**副A口径**（历史）= 从项目结算聚合"累计认款金额自动计算"，仅作对照保留

### 3. 销售商机（tblFBP8dLyaCmps0）
- `合作平台 contains "知乎"`
- `提交时间 ∈ 2026`（dispatched_at）
- `赢单输单时间` 用作 settled_at（当 跟进阶段∈{赢单,流失}）

### 4. 策划下单（tblcBYRfUPDqxnnH）
- `下单日期 ∈ 2026`（dispatched_at）
- 整app=2026知乎事业部，**无需平台filter**
- `开标日期` 用作 settled_at（当 策划更新实际赢单输单∈{赢单,输单}）

## 关键字段取法

### 项目结算（每行一项目）
项目ID / 项目名称 / 建项时间 / 合作平台 / 订单总金额 / 销售经理1 / 项目经理1 / 累计认款金额自动计算 / 客户全称 / 业务板块-多选 / 品牌业务/效果业务/博主业务/素人业务 / 利润率 / 毛利率预估 / 利润 / 待回款金额 / 项目状态 / 结案日期

- `task_type`：由4个"xx业务"字段金额>0派生（**不拆分**，单项目可多类）
- `利润率`：**actual优先**（结案录入）→ fallback `毛利率预估`（预估）→ null；每条带 `profit_rate_source = 'actual'|'estimate'|null`
- `turnaround_days` = 结案日期 - 建项时间（天）；未结案=null；负值=null（脏数据）
- `is_overdue` = 待回款金额 > 0 AND 建项后 > `CONFIG.overdue_threshold_days`（默认30天）

### 认款单据
项目ID / 资金池回款日期 / 认款金额 / 平台

### 销售商机
商机编号 / 商务 / 客户名称 / 合作平台 / 跟进阶段 / 商机总金额 / 提交时间 / 赢单输单时间 / 流失原因（流失商机需填写） / 项目经理 / 下单分配时间

跟进阶段 opts：`待接触|初步提议|方案报价|协商议价|赢单|流失`
- outcome：`赢单→won`；`流失→lost`；else `null`（进行中）

### 策划下单
商机编号 / 商务 / 客户 / 接单策划 / 下单日期 / 提交日期 / 开标日期 / 策划更新实际赢单输单 / 赢单或输单理由 / 预算 / 需求评级(S|A|B)

策划更新实际赢单输单 opts：`赢单|输单|跟进中`
- outcome：`赢单→won`；`输单→lost`；else `null`

## 栩瑄确认的特殊规则（2026-04-13）

1. **知乎口径 = 知乎 + 知乎-MCN**（用 contains "知乎" 覆盖两者）
2. **回款金额主口径 = B**（认款单据，非项目结算聚合）
3. **销售经理1为空 不进 top_sales**
4. **项目经理1为空 不进 top_pm**
5. **任务类型不拆分**（博主,素人 多选保留原状）
6. **任务类型分布图前端隐藏**（后端数据保留备后续）
7. **扭转周期 结案日期为空不统计**
8. **结算项目数 结案日期为空不统计**

## 待栩瑄口径（开发时先留空或用默认）

- 客户分层（分层后应用到账期超期阈值）
- 利润率口径优先级（是否切换为 actual only，放弃 estimate fallback）
- mom_yoy需2025历史数据（当前 null）

## 预期产量（截至 2026-04-13）

```
项目结算: 219项目 / ¥12.93M 订单
认款单据(知乎): 230笔 / ¥10.18M 回款（主B）
销售商机(2026知乎): 51商机 / won22 lost1 null28
策划下单(2026): 17订单 / won12 lost0 null5
```

如数量严重不符（>30%偏差），先 `--dry-run` check，怀疑筛选逻辑坏了。
