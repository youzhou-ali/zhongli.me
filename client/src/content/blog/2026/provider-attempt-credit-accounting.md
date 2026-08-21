---
title: 从 Token 统计到预付费 Credits：Cube 的最终计量与账务方案
slug: provider-attempt-credit-accounting
date: 2026.08.21
category: 构建
summary: Cube 只对最终成功 Model Call 的有效 Usage 收取 Credits，并以独立账务实体实现准入、扣费、充值、余额和 Statement。
---

> 本文是 [Cube Issue #18](https://github.com/mindshake-ai/cube/issues/18) 的最终技术方案，不代表功能已经全部上线。
>
> v1 使用默认关闭的 Mock Credits 购买；真实支付渠道后续由 [Issue #22](https://github.com/mindshake-ai/cube/issues/22) 接入。
>
> 三张架构图的 [Draw.io 源文件](/assets/cube-credits/cube-credits.drawio) 可以直接下载和继续编辑。

## 1. 摘要

Cube 在保持现有 Token 统计链路的基础上，为 Playground 登录 Account 增加预付费 Credits。最终方案只对成功 Model Call 的最终有效 Usage 收费，并继续复用现有 `PreModelCall`、`PostModelCall` 与 `LLMMetricRecorderHook`：

- `CreditAdmissionHook` 监听 `PreModelCall`，在模型请求发出前检查付款归属、候选模型收费配置和余额，并保存本次调用的内存费率快照。
- `CreditChargeHook` 监听 `PostModelCall`，使用与 Token 统计相同的最终 `Usage`、`msg_id` 和模型归因，独立提交收费事实。
- 只有 `stop`、`length`、`toolUse` 三种正常终态可收费；错误、取消、超时、失败 retry/fallback 和部分流均不收费。
- 缺少有效 Usage、四项 Usage 全零、缺少 `msg_id` 或无法确认最终实际 LLM Configuration 时均 fail-open，不收费；Provider `model_id` 只是可空诊断快照，不是收费前提。
- 模型成功后发生结算故障或进程崩溃，不影响模型结果，不后台补扣。
- 调用前不冻结 Credits。余额大于零即可开始新的付费调用，单次高额调用或多个并发调用允许在结算后形成负余额。
- 默认 `credit_billing_enabled=false`，兼容升级前免费行为。
- v1 不接入真实支付，只提供部署级、默认关闭的 Mock 购买。

最终只新增六个持久化实体：

```text
Runtime Database
├── WorkloadBillingAssignment
├── ModelCallCharge
├── CreditTransaction
└── CreditBalance

Playground Account Database
├── CreditPurchaseOrder
└── CreditPayment
```

不增加 Billing Subject 表、套餐表、费率版本表、准入失败表、逐次供应商请求表、额度冻结表或事后补扣状态机。

## 2. 决策优先级与冲突收口

本文以 ADR-0051 及其后的逐项确认为最终基线。早期 ADR 或 Issue 评论中与本文冲突的设计不再作为实现依据。

错误传播已经统一为一条现有链路：

- `CreditAdmissionHook` 使用现有 `PreModelCallOutput.blocking_error`。
- Runtime 把错误字符串写入现有 `AgentRunState.error`。
- Playground 从现有 Run `reason/error` 投影识别稳定值 `insufficient_credits`，并按 viewer 生成不同展示。
- 不增加 Core `error_code` 字段或 Credits 专用异常模型。

## 3. 现状

### 3.1 当前 Token 统计

Core 在模型调用结束时产生 `ModelCallEndEvent`。该事件是 Run 总 Token 的唯一累加入口，`AgentRunState` 保存四项累计 Token。

`LLMMetricRecorderHook` 监听现有 `PostModelCall`，把每次可归因的调用写入 `LLMCallMetric`，字段包括：

- `msg_id`
- `session_id`
- `run_id`
- `turn_id`
- `member_code`
- `llm_router_code`
- 最终 `llm_code`
- `model_id`
- 四项 Token
- `created_at`

Playground 当前 Run Token 与模型明细主要由 `AgentRunState` 和 `LLMCallMetric` 投影。Full compaction 已经产生 `ModelCallEndEvent`、累加 Run Token 并触发 `PostModelCall`，所以它此前已经进入 Token 统计；缺口只是调用模型前没有经过 `PreModelCall`。

### 3.2 为什么不直接使用 LLMCallMetric 收费

`LLMCallMetric` 可以覆盖当前 Token 展示，但不适合作为不可变账务事实：

- 没有 `workload_id`，无法稳定取得付款人。
- 没有调用开始时采用的费率快照。
- 没有 Customer Charge。
- 没有余额流水的稳定来源关系。
- 它是运营统计投影，可随统计需求清理、重建或调整。
- Metric 写入成功与 Credits 结算成功是两个独立结果。
- 删除或重建统计不能改变已经成立的账务。

因此 Token 统计和收费共享同一个 `PostModelCall` 观察边界及输入，但 `CreditChargeHook` 不读取、等待或依赖 `LLMCallMetric` 数据行。

## 4. 目标与非目标

### 4.1 目标

- 登录 Account 可以查看、购买和消费 Credits。
- Credits 用尽后不能开始新的付费 Model Call。
- 每笔消费可解释到 Workload、Model Call、最终实际模型、四项 Token 和调用开始时费率。
- Router、Tool、SubAgent、Workflow、Task、后台执行和 compaction 保持统一付款归属。
- local 与 cluster 使用同一 Platform accounting 语义。
- 账务写入幂等，余额更新原子。
- 默认免费，旧配置、旧 Metric 和旧调用行为保持兼容。
- 尽量复用现有 Hook、LLM Configuration、Account 和权限入口。

### 4.2 非目标

v1 不实现：

- Agency、Channel、Session、Agent 或模型级独立消费额度。
- 调用前金额估算、积分冻结或严格防透支。
- 对失败调用收费。
- 对缺失 Usage 的估算、外部查询或未来补扣。
- 供应商货币账单、汇率、成本或毛利分析。
- 独立模型定价后台、费率版本表或发布流程。
- 真实支付渠道。
- 退款、部分退款、拒付或 Credits reversal。
- 注册赠送积分、积分批次、积分有效期或消费顺序。
- 低余额阈值、持续 Banner、Toast 或持久通知。
- System Billing Subject 或未认证 Playground 根操作。
- 将历史 `LLMCallMetric` 迁移为账务事实或追溯扣费。
- 新的 Session 控制权限或付款人转移能力。

## 5. 架构上下文与组件放置

### 5.1 cube.core

Core 只表达平台无关的执行事实：

- Workload 身份的运行时传播。
- Agent Run、Model Call、标准化 Usage。
- `PreModelCall`、`PostModelCall`。
- Router 最终模型归因。
- compaction 调用边界。

Core 不包含 Account、付款人资料、余额、费率读取、购买订单、Statement 或 Playground 展示策略。

### 5.2 cube.platform

Platform 拥有 Credits accounting：

- 当前 LLM Configuration 的收费开关与四项费率。
- Workload 付款归属。
- 调用前准入服务。
- runtime-local accounting runtime；其中包含费率快照 coordinator，并由同一个 `PlatformRuntime` 实例持有。
- Model Call 结算服务。
- Model Call 收费事实。
- Credits 流水与余额投影。
- Statement 所需查询服务。

四张 Runtime 物理表由一个 Platform-owned `TableSpec(name="cube.platform.credit_accounting", models=(...四张表...))` 组装，并由宿主通过 `tables.toml` 选择。Platform 保持 local-first，不引入 Redis、lease 或 cluster 分支。

### 5.3 cube.plugins

具体 Hook 实现遵循现有插件边界，放在 `cube.plugins.hooks`，并使用独立的官方 `PluginSpec(name="cube.plugins.credit_billing")` 注册 `credit_billing` hook group；不能合并进通用 `cube.hooks`：

- `CreditAdmissionHook` 调用 Platform admission service。
- `CreditChargeHook` 调用 Platform settlement service。
- `RuntimeCapabilityMaterializer` 增加最小的 accounting runtime 绑定能力；两个 Hook 通过 runtime materialization 获得同一个 Platform accounting runtime，而不是各自构造 coordinator 或使用 process-global singleton。
- `PluginSpec.requires_tables=("cube.platform.credit_accounting",)` 声明一个逻辑 TableSpec 依赖；该 TableSpec 内含四张物理表。漏装时在 runtime 组装阶段直接失败。

Playground 默认 manifest 必须同时：

```text
plugins.toml: enabled += "cube.plugins.credit_billing"
plugins.toml: default_hooks += "credit_billing"
tables.toml:  enabled += credit accounting TableSpec module
```

`PluginSpec.requires_tables` 在插件被解析时无条件校验，不会根据 hook group 是否挂载而延迟。因此官方 CLI 默认 `plugins.toml` 需要从 `entry_points="all"` 改成 `entry_points="selected"`，保留现有 `enabled` 列表及其依赖闭包，但不解析 billing plugin。已有宿主若继续使用 `all`，必须显式加载 accounting TableSpec；推荐改成 `selected` 并只启用实际需要的插件。`cube.platform` 本身不在 import 时隐式安装具体 Hook。

### 5.4 cube.cluster

Cluster 不拥有新账务规则，只负责组合：

- backend 与 workers 共享 Runtime Database。
- worker 侧 `PlatformRuntime` 执行两个 accounting hooks。
- local SQLite 和 cluster MySQL 使用同一 Platform accounting service 合同。

### 5.5 Playground backend

Playground 拥有：

- Account、认证与 viewer 身份。
- 根 Workload 的付款人选择。
- Credit Purchase Order 与 Credit Payment。
- Mock 购买配置和 pending fulfillment scanner。
- Account Credits、Statement、Payment History API。
- viewer-aware Run 错误投影。

Playground 直接使用不可修改的 `PlaygroundAccount.user_code` 作为 Platform 的不透明 `billing_subject_ref`。不增加 Billing Subject 表，也不在 Account 增加 `billing_subject_id`。

### 5.6 Playground frontend

Frontend 负责：

- 在现有 LLM Configuration 页面编辑收费状态与费率。
- 在现有个人设置中增加 Credits 区域。
- 展示余额、Statement、Payment History 与可选 Mock 购买入口。
- 在实际调用失败处展示 `insufficient_credits`。
- 只向 Workload Payer 展示购买动作。

## 6. 图形资产

本文只保留三张能直接解释领域模型和两条核心资金流程的 Draw.io 图。正文使用兼容性更好的 PNG；同目录保留 SVG 与多页 `.drawio` 源文件：

| 图 | 正文图片 |
|---|---|
| 六实体 ERD | `/assets/cube-credits/erd.png` |
| 扣费详细流程 | `/assets/cube-credits/model-call-sequence.png` |
| Mock 充值与 Credits 发放 | `/assets/cube-credits/mock-fulfillment.png` |

正文使用同源 PNG，避免不同部署环境对 SVG 的安全过滤差异；同目录同时保留 SVG 和三页 Draw.io 源文件。

## 7. 收费配置与精度

### 7.1 配置位置

不新增独立“模型定价”后台。收费字段放在现有 Agency LLM Configuration 中，并复用当前保存权限。

建议由 `cube.platform.agency.LLMConfigEntry` 增加 Platform-owned 字段；Platform 构造 Core `LLMConfig` 时只提取模型客户端需要的字段，避免 Credits 语义进入 Core。

持久化字段：

```text
credit_billing_enabled: bool = false

input_rate_microcredits_per_million: int64 | null
cache_read_rate_microcredits_per_million: int64 | null
cache_write_rate_microcredits_per_million: int64 | null
output_rate_microcredits_per_million: int64 | null
```

规则：

- `credit_billing_enabled=false`：配置免费，四项 Rate 可以为空。
- `credit_billing_enabled=true`：四项 Rate 必须全部存在、均大于或等于零，且不能全部为零。
- 单个 Token 分区可以为零费率。
- 管理员保存后，配置立即影响随后开始的调用。
- 已通过准入的调用使用内存快照，不受调用期间配置修改影响。
- v1 不建立定价 revision 或 current pointer。
- 删除 LLM Configuration 后不保留独立费率；使用同一个 `llm_code` 重建时按新配置默认免费。
- 修改 provider/model、Base URL 或 credential 不自动清除当前收费字段，由管理员负责确认其适用性。

现有 LLM Configuration API 可以使用面向表单的十进制字符串 DTO，例如：

```json
{
  "credit_billing_enabled": true,
  "credit_rates_per_million": {
    "input": "1",
    "cache_read": "0.1",
    "cache_write": "1.25",
    "output": "5"
  }
}
```

后端校验后转换为整数 Microcredits 保存。前端输入框只用上述示例作为 placeholder，不自动填入或保存默认值。

### 7.2 记账精度

```text
1 Credit = 1,000,000 Microcredits
```

Token、Rate、Customer Charge、Transaction delta、Balance、购买 Credits 与货币最小单位均使用有符号 SQL `BIGINT`。业务校验再限制哪些字段必须非负。

Rate 的表单值最多允许六位 Credits 小数；更细精度直接拒绝，不能静默舍入。

收费公式：

```text
numerator =
    input_tokens       × input_rate_microcredits_per_million
  + cache_read_tokens  × cache_read_rate_microcredits_per_million
  + cache_write_tokens × cache_write_rate_microcredits_per_million
  + output_tokens      × output_rate_microcredits_per_million

customer_charge_microcredits =
  round_half_up(numerator / 1,000,000)
```

只在整个 Model Call 总额上舍入一次，不逐分区舍入，也不设置最低消费。

### 7.3 Canonical Usage

收费沿用 Core 四个互斥分区：

- `input_tokens`：不包含 cache read/write 的普通输入。
- `cache_read_tokens`。
- `cache_write_tokens`。
- `output_tokens`：已经包含 reasoning Token。

工具定义和工具结果属于输入，tool call 参数属于输出，不增加独立收费桶。Provider adapter 必须按对应供应商合同把原始 Usage 映射成四个非负、互斥字段。

流式响应只结算一份最终归一化 Usage：累计快照取最后一份有效值，不能把多个累计 chunks 相加。四项全零统一视为没有可结算 Usage，不创建 Charge；明确全零与完全缺失只通过结构化日志区分。

## 8. 最小持久化模型

![Cube Credits ERD](/assets/cube-credits/erd.png)

以下长度是 v1 的物理 schema 约束。所有 ID 由服务端生成；时间统一使用 UTC。

核心关系基数：

- 一个 WorkloadBillingAssignment 对应 `0..N` 个 ModelCallCharge，使用同库 FK。
- 一个 PlaygroundAccount 对应 `0..N` 个 CreditPurchaseOrder，使用 Account DB FK。
- 一个 CreditPurchaseOrder 对应 `0..1` 个 CreditPayment，使用唯一 FK；Mock 流程会在同一事务中同时创建二者，但 schema 不把“尚未确认付款的订单”建模为不可能。
- 一个 ModelCallCharge 对应 `0..1` 个消费 CreditTransaction；零收费 Charge 对应零条，使用多态 `source_ref`，不建 FK。
- 一个 CreditPayment 对应 `0..1` 个购买 CreditTransaction；`pending` 时可能为零，发放后为一条，跨库不建 FK。

### 8.1 WorkloadBillingAssignment

建议表名：`cube_workload_billing_assignment`

| 字段 | SQL 类型 | Null | 约束/索引 |
|---|---|---:|---|
| `workload_id` | `VARCHAR(64)` | 否 | PK |
| `billing_subject_ref` | `VARCHAR(255)` | 否 | index component |
| `created_at` | `VARCHAR(64)` | 否 | UTC ISO-8601, index component |

索引：

```text
PK(workload_id)
INDEX(billing_subject_ref, created_at)
```

规则：

- 一个 Workload 只能有一个付款人。
- 同一个 `workload_id` 重试且 `billing_subject_ref` 一致时幂等成功。
- 同一个 `workload_id` 携带不同付款人时拒绝，绝不覆盖。
- 不建立 Account 外键。

### 8.2 ModelCallCharge

建议表名：`cube_model_call_charge`

| 字段 | SQL 类型 | Null | 约束/索引 |
|---|---|---:|---|
| `model_call_charge_id` | `VARCHAR(64)` | 否 | PK |
| `source_msg_id` | `VARCHAR(64)` | 否 | UNIQUE |
| `workload_id` | `VARCHAR(64)` | 否 | FK, index |
| `session_id` | `VARCHAR(64)` | 是 | index |
| `run_id` | `VARCHAR(64)` | 是 | index |
| `agency_code` | `VARCHAR(64)` | 否 | composite index |
| `actual_llm_code` | `VARCHAR(64)` | 否 | composite index |
| `model_id` | `VARCHAR(255)` | 是 | 实际 Provider model 诊断快照 |
| `input_tokens` | `BIGINT` | 否 | CHECK `>= 0` |
| `cache_read_tokens` | `BIGINT` | 否 | CHECK `>= 0` |
| `cache_write_tokens` | `BIGINT` | 否 | CHECK `>= 0` |
| `output_tokens` | `BIGINT` | 否 | CHECK `>= 0` |
| `input_rate_microcredits_per_million` | `BIGINT` | 否 | CHECK `>= 0` |
| `cache_read_rate_microcredits_per_million` | `BIGINT` | 否 | CHECK `>= 0` |
| `cache_write_rate_microcredits_per_million` | `BIGINT` | 否 | CHECK `>= 0` |
| `output_rate_microcredits_per_million` | `BIGINT` | 否 | CHECK `>= 0` |
| `customer_charge_microcredits` | `BIGINT` | 否 | CHECK `>= 0` |

约束与索引：

```text
PK(model_call_charge_id)
UNIQUE(source_msg_id)
FK(workload_id)
  -> cube_workload_billing_assignment(workload_id)
  ON DELETE RESTRICT

CHECK(
  input_tokens > 0 OR
  cache_read_tokens > 0 OR
  cache_write_tokens > 0 OR
  output_tokens > 0
)

CHECK(
  input_rate_microcredits_per_million > 0 OR
  cache_read_rate_microcredits_per_million > 0 OR
  cache_write_rate_microcredits_per_million > 0 OR
  output_rate_microcredits_per_million > 0
)

INDEX(workload_id)
INDEX(session_id)
INDEX(run_id)
INDEX(agency_code, actual_llm_code)
```

不保存 `billing_subject_ref`、`stop_reason`、独立结算时间、Router code、完整消息内容或内部失败调用记录。

#### model_id 语义

收费必须先可信确认 `actual_llm_code`，不能根据 Provider model 字符串反推 LLM Configuration。`model_id` 只保存成功 response/chunk 实际返回的 Provider model，用于诊断和展示；响应没有提供时保持 `NULL`，不阻止结算，因为费率身份已经由 `actual_llm_code` 与调用前快照确定。

#### 零收费 Charge 的时间语义

Usage 非零，但只命中零费率分区或总额舍入为零时，仍创建 `customer_charge_microcredits=0` 的 ModelCallCharge，以证明该 `source_msg_id` 已完成结算；不创建 CreditTransaction。

ModelCallCharge 不增加独立时间字段，因此零收费 Charge：

- 不进入 Statement。
- 不参与任何按入账时间的消费统计。
- 只能按 `source_msg_id`、`workload_id`、`session_id`、`run_id` 或模型维度查询。
- 时间维度继续由 `LLMCallMetric.created_at` 提供。

如果未来确实需要零收费事实的独立时间分析，应单独增加经确认的时间字段，而不是在 v1 暗中推导。

#### Charge 幂等比较

遇到相同 `source_msg_id` 时，读取既有记录并逐项比较以下不可变字段：

```text
workload_id
session_id
run_id
agency_code
actual_llm_code
model_id
四项 token
四项 rate
customer_charge_microcredits
```

全部一致才视为幂等成功。新请求临时生成的 `model_call_charge_id` 不参与比较；任一事实不同都拒绝，不能 update、merge 或覆盖既有 Charge。

校验式插入无论是首次创建还是命中幂等记录，都必须返回数据库中首次持久化的 canonical `model_call_charge_id`。后续负 CreditTransaction 的 `source_ref` 只能使用这个 canonical ID，不能使用本次重试临时生成的候选 ID；这是防止重复 Post 绕过 `UNIQUE(kind, source_ref)` 并再次扣款的事务不变量。

### 8.3 CreditTransaction

建议表名：`cube_credit_transaction`

| 字段 | SQL 类型 | Null | 约束/索引 |
|---|---|---:|---|
| `credit_transaction_id` | `VARCHAR(64)` | 否 | PK |
| `billing_subject_ref` | `VARCHAR(255)` | 否 | statement index |
| `kind` | `VARCHAR(32)` | 否 | CHECK enum, UNIQUE component |
| `source_ref` | `VARCHAR(64)` | 否 | UNIQUE component |
| `delta_microcredits` | `BIGINT` | 否 | signed, CHECK |
| `posted_at` | `VARCHAR(64)` | 否 | UTC ISO-8601, statement index |

`kind`：

```text
model_call_charge
credit_purchase
```

约束与索引：

```text
PK(credit_transaction_id)
UNIQUE(kind, source_ref)
INDEX(billing_subject_ref, posted_at)

CHECK(delta_microcredits <> 0)
CHECK(
  (kind = 'model_call_charge' AND delta_microcredits < 0) OR
  (kind = 'credit_purchase' AND delta_microcredits > 0)
)
```

来源：

```text
model_call_charge -> source_ref = model_call_charge_id
credit_purchase   -> source_ref = credit_payment_id
```

`source_ref` 是按 `kind` 解释的多态引用，不建立数据库外键。Transaction 不保存 `balance_after` 或重复的 `workload_id`。

#### Transaction 幂等比较

相同 `(kind, source_ref)` 时比较：

```text
billing_subject_ref
kind
source_ref
delta_microcredits
```

全部一致才幂等成功。重试时新生成的 Transaction ID 和新的候选 `posted_at` 不参与比较；始终保留首次成功提交的 `credit_transaction_id` 与 `posted_at`。

### 8.4 CreditBalance

建议表名：`cube_credit_balance`

| 字段 | SQL 类型 | Null | 约束 |
|---|---|---:|---|
| `billing_subject_ref` | `VARCHAR(255)` | 否 | PK |
| `balance_microcredits` | `BIGINT` | 否 | 允许负值 |

规则：

- 缺少 Balance 行等价于零。
- 不在 Account 注册时跨数据库创建空 Balance。
- CreditTransaction 是余额变化的唯一事实源，Balance 是可重建热点投影。
- 只有成功插入新的非零 Transaction 时，才在同一数据库事务中原子增量 Balance。
- 如果 Transaction 已经存在且幂等匹配，不能再次增量。
- 禁止 ORM“读取 -> Python 计算 -> 保存”；必须使用 SQL 原子增量、行锁或版本 CAS。

### 8.5 CreditPurchaseOrder

建议表名：`playground_credit_purchase_order`

| 字段 | SQL 类型 | Null | 约束/索引 |
|---|---|---:|---|
| `credit_purchase_order_id` | `VARCHAR(64)` | 否 | PK |
| `account_user_code` | `VARCHAR(255)` | 否 | FK, history index |
| `idempotency_key` | `VARCHAR(128)` | 否 | UNIQUE component |
| `option_code` | `VARCHAR(64)` | 否 | snapshot |
| `payment_amount_minor_units` | `BIGINT` | 否 | CHECK `> 0` |
| `currency` | `CHAR(3)` | 否 | CHECK uppercase ISO-style code |
| `credit_amount_microcredits` | `BIGINT` | 否 | CHECK `> 0` |
| `created_at` | SQLAlchemy datetime | 否 | MySQL dialect `DATETIME(fsp=6)` / SQLite `DATETIME`, 应用层统一 UTC, history index |

约束与索引：

```text
PK(credit_purchase_order_id)
UNIQUE(account_user_code, idempotency_key)
INDEX(account_user_code, created_at)

FK(account_user_code)
  -> playground_account(user_code)
  ON DELETE RESTRICT
```

`account_user_code` 的物理类型必须与 `PlaygroundAccount.user_code` 完全一致；v1 应把 Account user code 数据库合同收口为 `VARCHAR(255)`。

Order 是不可变购买快照，不保存状态、`updated_at` 或套餐实体引用。

处理相同 `(account_user_code, idempotency_key)` 时必须先查询既有 Order：

- 已存在：只比较客户端实际提交的 `option_code`，一致则直接返回既有 Order/Payment 及其原始购买快照；不能用当前 purchase option 配置重新计算金额、币种或 Credits 后再比较。
- 不存在：再解析当前服务端 purchase option，并创建新的不可变快照。

因此后台修改 purchase option 只影响新订单，不会让一次响应丢失后的合法重试变成 `409 Conflict`。新生成的 Order ID 和时间不参与幂等比较。

### 8.6 CreditPayment

建议表名：`playground_credit_payment`

| 字段 | SQL 类型 | Null | 约束/索引 |
|---|---|---:|---|
| `credit_payment_id` | `VARCHAR(64)` | 否 | PK |
| `credit_purchase_order_id` | `VARCHAR(64)` | 否 | UNIQUE, FK |
| `credit_fulfillment_status` | `VARCHAR(32)` | 否 | CHECK enum, scanner index |
| `created_at` | SQLAlchemy datetime | 否 | MySQL dialect `DATETIME(fsp=6)` / SQLite `DATETIME`, 应用层统一 UTC, scanner index |
| `credited_at` | SQLAlchemy datetime | 是 | MySQL dialect `DATETIME(fsp=6)` / SQLite `DATETIME`, 应用层统一 UTC, state CHECK |

约束与索引：

```text
PK(credit_payment_id)
UNIQUE(credit_purchase_order_id)
INDEX(credit_fulfillment_status, created_at)

FK(credit_purchase_order_id)
  -> playground_credit_purchase_order(credit_purchase_order_id)
  ON DELETE RESTRICT

CHECK(credit_fulfillment_status IN ('pending', 'credited'))
CHECK(
  (credit_fulfillment_status = 'pending' AND credited_at IS NULL) OR
  (credit_fulfillment_status = 'credited' AND credited_at IS NOT NULL)
)
```

Payment 只表示已经确认的付款，不保存失败或处理中状态，也不重复保存金额、币种和 Credits。

同一 Order 已有 Payment 时返回既有记录。Payment 唯一允许的状态变化是 `pending -> credited`；不能回退、替换关联 Order 或重写创建时间。

### 8.7 Account Database SQLite 外键

Playground Account Database 使用 SQLite 时，必须对每一个连接启用：

```sql
PRAGMA foreign_keys = ON;
```

实现应通过 SQLAlchemy connection event 或 provider 初始化统一设置，不能只在迁移脚本中执行一次。测试必须证明：

- 不存在的 Account 不能创建 Order。
- 不存在的 Order 不能创建 Payment。
- 有 Order/Payment 的 Account 或 Order 不能被误删。

Mock 下单必须在同一个 Account Database 事务中原子创建 Order 和 `pending` Payment；不能先提交 Order 再单独创建 Payment。

## 9. Workload 创建与传播

### 9.1 可信创建入口

`workload_id` 由 Platform `AccountingService` 生成，浏览器、Agent、Tool 和 Plugin 均不能指定。

Playground 根操作流程：

```text
已认证 Account
→ Playground 从服务端认证态取得 user_code
→ Platform AccountingService 生成 workload_id
→ 创建 WorkloadBillingAssignment(workload_id, user_code)
→ Playground backend 把 workload_id 写入受信任的 DeliverMessage.workload_id
→ 提交根操作
```

`DeliverMessage.workload_id` 是 server/cluster 内部命令字段，不是 `UserMessage.metadata`。最小可落地接口为：

```text
ChatSessionService.send(..., workload_id=...)
→ DeliverMessage.workload_id
→ local/cluster command codec
→ RuntimeSessionCommandExecutor
→ BaseSession.receive(message, delivery_context=SessionDeliveryContext(workload_id))
→ _prepare_receive / concrete session batch builder
→ 本次 receive 创建的全部 AgentRunRequest.workload_id
```

`SessionDeliveryContext` 是 Platform 内部、不可序列化到 transcript 的受信任调用上下文。`DeliverMessage.workload_id` 仅允许 `mode=RECEIVE`；`STEER` 和 `FOLLOW_UP` 若携带该字段必须由命令模型拒绝，它们从目标 Run 继承既有 Workload。字段本身为可选，保证新 worker 可以解码旧 backend 发出的 command；但 Playground 新根操作必须先创建 Assignment 后再提供非空值。

浏览器请求体、query、WebSocket payload 中不得接受 `workload_id` 或 `billing_subject_ref`。如果协议需要回显 Workload，只能回显服务端已经创建的 ID，不能把回显值当成下一次根操作的可信输入。若 Assignment 已创建但 command 最终未被接受，允许留下没有 Charge 的 Assignment；v1 不为这种无害孤儿记录增加清理状态机。

一次根操作可能同时创建多个目标 Runs；这些 Runs 必须共享同一个 `workload_id`，不能为每个 Run 重新生成。即使当前所有模型免费，也先创建 Assignment，以保证后续路由或后代执行切换到付费模型时仍有稳定付款人。

### 9.2 传播路径

Core/Platform 需要把可选的 `workload_id: str | None = None` 显式贯穿，以兼容 CLI、未启用 Billing 的宿主和旧持久化 JSON：

```text
DeliverMessage.workload_id
→ AgentRunRequest
→ AgentRunState JSON payload
→ AgentRunContext
→ ToolRunContext
→ ToolCallContext
→ Tool invocation
→ SubAgent invocation
→ child AgentRunRequest
→ Workflow invocation
→ background task durable payload
→ background continuation
```

`AgentRunStateDO` 不增加物理列，继续在现有 `payload` JSON 保存该字段。

Task 可以跨人工介入和进程重启，因此 `TaskRuntimeState` JSON 也必须保存 `workload_id`：

```text
task_start 固定 workload_id
→ phase run
→ intervention
→ resume
→ review/rework run
```

恢复、回答人工问题和后续 Review Run 只能继承，不得按当前操作者重新选择付款人。

### 9.3 Session 控制权限

Credits 不改变现有 Session 权限。例如 A 发起 Workload，B 是同一 Session 的合法成员：

- B 的 follow-up/steer 若仍属于该活动 Workload，继续扣 A 的 Credits。
- B 可以按原权限 cancel，cancel 只停止执行，不转移付款人、不产生额外费用。
- 前一 Workload 结束后，B 新发起根 Run 时创建新的 Workload，由 B 付费。
- `task_create` 只创建 pending Task；实际 `task_start` 才由启动者创建 Workload。

## 10. Hook 输入与 runtime-local coordinator

### 10.1 Core Hook 输入最小扩展

`PreModelCallInput` 增加：

```text
workload_id: str | None
turn_id: str | None
source: assistant_reply | compaction | tool_llm | other
labels: dict[str, str]
client_kind: direct | router
```

原有 `model` 字段继续承载 client code：direct 时为 `llm_code`，router 时为 `llm_router_code`。

`PostModelCallInput` 增加：

```text
workload_id: str | None
```

它已经拥有 `run_id`、`turn_id`、`source`、`msg_id`、`call_info`、`usage`、`stop_reason` 等结束事实。

### 10.2 coordinator 生命周期

`CreditAdmissionHook` 与 `CreditChargeHook` 必须共享同一个 runtime-local coordinator 实例。它由一个 `PlatformRuntime` 实例拥有并注入两个 Hook，不能使用 process-global singleton，也不能每个 Hook 各建一份缓存。

缓存键：

```text
(run_id, turn_id, source)
```

v1 不增加 TTL、容量上限或复杂淘汰策略。`CreditAdmissionHook` 在官方 `PreModelCall` 链中使用靠后的 priority，并且只在此前 Pre handlers 已通过后写入快照，尽量让它成为 Provider 前最后一道 gate。正常清理点只有：

- 对应 `PostModelCall` 一开始原子 `pop`。
- PlatformRuntime shutdown 时整体释放。

Settlement 失败后不把快照放回 coordinator，因此该次调用永久 write-off，不会被未来事件重复结算。若出现极端路径导致 Pre 成功后既没有 Provider 终态也没有 Post，残留只存活到当前 PlatformRuntime 进程结束；其数量与“已经通过 Pre、但从未收到 Post”的调用数成正比，在长生命周期进程内理论上可以无界增长。v1 接受这个风险，不为它增加 TTL、后台清理器或新的 Run 生命周期 Hook。

`PostModelCall` 开始时先原子 `pop`。如果没有取到 snapshot：

1. 没有 `source_msg_id` 时直接 fail-open。
2. 有 `source_msg_id` 时先查询既有 ModelCallCharge。
3. 已存在 Charge：比较本次 Post 可观察到的 `workload_id`、`session_id`、`run_id`、`actual_llm_code`、`model_id` 与四项 Token；全部一致则视为重复 Post 的幂等成功，不再写 Transaction 或 Balance；冲突则记录一致性错误。
4. 不存在 Charge：本次 write-off，不重新读取当前 LLM Configuration 或费率补费。

既有 Charge 中的费率与 Customer Charge 已由首次成功 Settlement 确立，重复 Post 不重新计算它们。

同一个键已经存在时，新 Admission 不得覆盖旧快照；应返回内部准入错误并阻止新的 provider dispatch，同时记录冲突日志。这可以暴露错误的并发/turn 身份，而不是让后一个调用使用前一个调用的费率。

### 10.3 快照内容

直连和 Router 都保存候选 marker。所有候选，包括免费候选，都必须进入快照：

```text
workload_id
agency_code
client_kind
client_code
resolved_initial_llm_code

candidates:
  actual_llm_code:
    billing_marker: free | paid
    configured_model_id  # 仅用于候选配置诊断，不冒充实际 response model
    四项 rate（paid 时必有）
```

保存免费 marker 很重要：最终 Router 命中免费候选时，`CreditChargeHook` 可以明确判断“调用前已确认免费”，而不是把“找不到费率”误当免费。

快照不持久化、不冻结 Credits、不进入 Core。进程崩溃时快照丢失，该次调用不收费。

## 11. Admission

### 11.1 CreditAdmissionHook

`CreditAdmissionHook` 监听现有 `PreModelCall`，职责：

1. 从 Platform runtime/session 可信上下文取得 `agency_code`。
2. 根据 `client_kind`、client code 和 labels 解析本次直连配置或 Router 初始配置。
3. 计算本次初始配置及 fallback 链中的可达候选。
4. 读取所有候选当前收费状态，并构造完整 snapshot markers。
5. 如果存在付费候选，读取 Workload Assignment 与 Credit Balance。
6. 校验所有付费候选四项 Rate 完整且非全零。
7. 把快照写入共享 coordinator。
8. 不满足条件时返回稳定 `blocking_error`，不发出模型请求。

现有 dispatcher 会吞掉多数普通异常，但会重新抛出 `ValueError`。因此 `CreditAdmissionHook` 必须在自身内部捕获 repository、数据库、配置解析、校验和一致性等 operational 异常（明确包括 `ValueError`），并显式转换为 blocking output；不能依赖抛异常实现 fail-closed，也不能捕获取消或其他 `BaseException`。

### 11.2 直连规则

- 免费配置：保存 free marker，不检查余额。
- 付费配置：
  - `workload_id` 必须存在。
  - Assignment 必须存在。
  - Balance 必须大于零；缺行按零处理。
  - 四项 Rate 必须完整、非负且非全零。

### 11.3 Router 规则

1. 使用本次业务 labels 解析初始 `llm_code`。
2. 只检查初始配置与其 fallback 链，不检查不会命中的其他 rules 分支。
3. 所有可达候选免费时，不检查余额，但仍保存全部 free markers。
4. 任一候选付费时：
   - 必须存在 Assignment。
   - Balance 必须大于零。
   - 所有付费候选均必须有完整 Rate。
5. 最终实际命中免费候选时不收费。
6. 最终实际命中付费候选时使用调用前快照费率。

因此，免费 primary 只要存在付费 fallback，余额为零时仍拒绝调用；这是为了避免内部 fallback 绕过付费准入。

### 11.4 准入错误

对产品稳定暴露：

```text
insufficient_credits
```

付款归属缺失、费率配置错误、账务数据库不可用和 snapshot key 冲突可以先使用稳定但通用的内部 `blocking_error` 字符串，并在 Playground 向普通用户投影为运行失败。准入失败不创建独立表记录，只进入 Run 结果和结构化日志。

## 12. 普通 Model Call 时序与收费

![Model Call Sequence](/assets/cube-credits/model-call-sequence.png)

### 12.1 顺序

```text
PreModelCall
→ CreditAdmissionHook
→ provider dispatch
→ ModelCallEndEvent
→ PostModelCall
   → CreditChargeHook       # priority < 1000，例如 900
   → LLMMetricRecorderHook  # 现有 priority = 1000
→ MessageEndEvent
→ Transcript 持久化
```

现有 dispatcher 按 priority 升序串行执行 Hook。`CreditChargeHook` 与 `LLMMetricRecorderHook` 使用相同 `PostModelCallInput`，执行顺序是先 Charge、后 Metric，但使用独立事务，互不读取对方数据。

为保证这种独立性在现有 dispatcher 语义下真实成立：

- `CreditChargeHook` 的 priority 放在 `LLMMetricRecorderHook` 之前，避免 Metric 先发生 `ValueError` 时阻止结算。
- 两个持久化 Hook 都要在自身内部捕获数据库、校验和 repository 异常，包括 `ValueError`；Hook 合同类型错误仍由 dispatcher 负责。
- Charge 是否成立不能读取 Metric 行，Metric 是否成立也不能读取 Charge 行。

| Metric | Charge | 结果 |
|---|---|---|
| 成功 | 成功 | 正常统计并收费 |
| 成功 | 失败 | 保留 Token 统计，本次不收费 |
| 失败 | 成功 | Charge 自带完整 Usage 与费率，账务成立 |
| 失败 | 失败 | Run 总 Token 仍按 Core 事件累加，本次不收费 |

### 12.2 Chargeable Model Call

`CreditChargeHook` 只有在以下条件全部满足时才创建 ModelCallCharge：

- `stop_reason` 是 `stop`、`length` 或 `toolUse`。
- 快照中最终 `actual_llm_code` 标记为 paid。
- 四项 Usage 至少一项大于零。
- 存在 `source_msg_id`。
- 存在 `workload_id` 和对应 Assignment。
- 能可信确认 `actual_llm_code`。
- 快照中存在对应 paid marker 与完整四项 Rate。

以下均不收费：

- `error`、`aborted`、timeout。
- 部分流后失败。
- retry/fallback 中未成为最终成功结果的请求。
- Usage 缺失或全零。
- 缺少 `msg_id`。
- 最终模型归因不可信。
- 快照丢失、冲突或无法匹配最终配置。

### 12.3 Settlement 事务

非零收费在一个 Runtime Database 事务中完成：

```text
校验式插入或读取 ModelCallCharge，返回 canonical model_call_charge_id
+ 以 canonical ID 作为 source_ref 校验式插入负 CreditTransaction
+ 仅首次插入新 Transaction 时原子增量 CreditBalance
```

零收费只插入 ModelCallCharge，不插入 Transaction、不更新 Balance。

事务幂等键分两层：

```text
ModelCallCharge: UNIQUE(source_msg_id)
CreditTransaction: UNIQUE(kind, source_ref)
```

重复 `source_msg_id` 必须先取得首次持久化的 canonical Charge ID；不得把重试临时生成的 ID 传给 Transaction 层。

免费候选不创建 ModelCallCharge、Transaction 或 Statement 条目，只保留现有 Token 统计。

### 12.4 成功后的故障

模型已经成功返回后采用 fail-open：

- `CreditChargeHook` 必须内部捕获包括一致性冲突在内的结算异常并记录日志。
- 结算异常不得改写 provider 成功结果。
- 不触发新的 retry/fallback。
- 不撤回已经流式输出的内容。
- 不使用 detached task 或后台补扣。

现有 `PostModelCall` 早于 `MessageEndEvent`，因此产品接受极端窗口：

```text
Charge 已提交
→ 后续 Transcript 持久化失败
```

该 Charge 保留。相反，如果进程在成功响应后、Settlement 提交前崩溃，本次不收费。

## 13. Router 最终模型归因

Router 调用开始时：

```text
call_info.llm_code = None
```

不得使用 primary/default 预填最终配置。实际归因规则：

- 从成功 response 或 chunks 的 deployment identity 回填 `actual_llm_code`。
- 不能只检查第一个 chunk；第一个 chunk 缺失时继续检查后续 chunks，直到确认或调用结束。
- Provider `model_id` 不能反推 `llm_code`，因为多个配置可以使用同一模型但费率不同。
- 最终 `actual_llm_code` 不在调用前快照候选中时 fail-open。
- 无法确认最终 `actual_llm_code` 时，Run 仍累加总 Token，但不创建 Charge，也不伪造按配置的 Metric 归因。
- `model_id` 有响应值就保存，没有则保持空；它不参与费率选择。

Router 内部 retry/fallback 不改变收费边界：只对最终成功 Model Call 的一份最终 Usage 结算一次。

## 14. Full compaction

### 14.1 现状与改动

Full compaction 当前已经：

- 调用模型。
- 创建独立 `msg_id`。
- 产生 `ModelCallEndEvent(source="compaction")`。
- 累加 Run Token。
- 触发 `PostModelCall` 和现有 Metric。

Issue #18 只在真实模型调用前补齐现有 `PreModelCall`：

```text
PreLLMCompact
→ complete_for_compact
→ PreModelCall(
     source="compaction",
     workload_id,
     turn_id,
     client_kind,
     labels=runtime.llm_labels + request.labels
   )
→ CreditAdmissionHook
→ provider
→ PostModelCall
```

Micro compaction 不调用模型，因此不触发 Credits Admission 或 Charge。

### 14.2 CompactModelCallState 回传 admission error

`PreLLMCompact` handler 通过 `complete_for_compact` callback 调用模型。现有 hook dispatcher 会吞掉普通 handler 异常；如果 compaction callback 直接抛出 `insufficient_credits`，外层可能只看到 compact hook 失败，真正准入原因会丢失。

因此 `CompactModelCallState` 增加显式字段，例如：

```text
admission_error: str | None
```

处理顺序：

1. `complete_for_compact` 调用 `_apply_pre_model_call_hook`。
2. 捕获其 blocking error 时，先写入 `call_state.admission_error`，再终止 callback。
3. 即使 `dispatch_hooks(PreLLMCompact)` 吞掉 callback 异常，状态仍保留。
4. `_apply_pre_llm_compact_hooks` 在 task 完成和 event queue drain 后检查 `call_state.admission_error`。
5. 如果 `CompactionStartEvent` 已经发出，先恰好发出一次 `CompactionEndEvent(success=False, error=admission_error)`，保证 Start/End 成对。
6. 再显式把该错误交回主 Agent loop，使整个 Run 进入对应 error 终态。

不新增 Credits 专用 Core 异常类型。状态只承载不透明错误字符串。

Full compaction 因余额、Assignment、费率或 accounting 可用性未通过准入时，整个 Run 结束；不得静默跳过压缩后继续主 assistant 调用。

## 15. Balance 与并发透支

Balance 大于零只是新的付费 Model Call 的准入门槛，不保证余额覆盖最终费用。

```text
调用前 1.00 Credits
收费   0.40 Credits
调用后 0.60 Credits
```

负余额只会在实际费用超过调用前余额或多个已准入调用并发结算时出现：

```text
调用前 0.10 Credits
收费   0.50 Credits
调用后 -0.40 Credits
```

```text
余额 0.30 Credits
A、B 均在余额为正时通过准入
A 收费 0.25
B 收费 0.25
最终余额 -0.20 Credits
```

负余额不回滚成功调用。余额小于或等于零后拒绝新的付费调用；全部可达候选免费时仍允许调用。v1 不增加 billing-specific 并发限制、排队、TTL 或消费上限。

## 16. Mock Credits 购买与发放

![Mock Fulfillment](/assets/cube-credits/mock-fulfillment.png)

### 16.1 部署配置

```text
mock_payment_enabled: bool = false

credit_purchase_options:
  - option_code
  - payment_amount_minor_units
  - currency
  - credit_amount_microcredits
```

启动校验：

- `option_code` 唯一。
- 金额和 Credits 都大于零。
- currency 是三位大写代码。
- 开启 Mock 时至少有一个 option。

Options 不建表、不提供套餐后台、不热更新；配置修改后重启生效。客户端只提交 `option_code`，不能提交金额或 Credits。

### 16.2 下单

```json
{
  "option_code": "credits_100",
  "idempotency_key": "client-generated-stable-key"
}
```

后端流程：

1. 从认证态取得 `account_user_code`。
2. 先按 `(account_user_code, idempotency_key)` 查询既有 Order。
3. 若已存在：`option_code` 相同则复用既有 Order/Payment 和原始快照，不重新解析当前 option；不同则返回 `409 Conflict`。
4. 若不存在：从服务端配置解析当前 option，并在同一个 Account Database 事务中创建不可变 Order 和 `pending` Payment。
5. 对新建或既有 `pending` Payment，提交后尝试 Runtime Credits 发放。
6. 成功则把 Payment 更新为 `credited`；失败则保留 `pending`，购买 API 返回 `202 Accepted`。

### 16.3 Runtime 发放

```text
kind       = credit_purchase
source_ref = credit_payment_id
delta      = +credit_amount_microcredits
```

在一个 Runtime Database 事务中：

```text
插入正 CreditTransaction
+ 原子增加 CreditBalance
```

如果 Runtime 已经入账，但 Account Database 回写 `credited` 前崩溃，scanner 再次投递相同 `credit_payment_id`；Runtime 校验既有 Transaction 后幂等成功，scanner 再标记 Payment。不会重复发放。

后台扫描 `(credit_fulfillment_status='pending', created_at)`。关闭 `mock_payment_enabled` 只阻止新购买，不停止历史 pending 发放。Purchased Credits v1 永不过期。

## 17. Statement 与 Payment History

### 17.1 Statement

Statement 是预付费 Credits 明细，不是后付费 Invoice。唯一 Credits 事实源是 CreditTransaction：

- 正数：购买入账。
- 负数：Model Call 消费。

Statement 使用 `posted_at` 决定周期。月底开始、次月结算的调用进入次月。

默认展示：

```text
购买 Credits
Workload Charge
Workload Charge
...
```

当前周期内同一 Workload 的负 Transactions 默认聚合为 Workload Charge，可以展开到 ModelCallCharge，展示最终模型、四项 Token、四项 Rate 与 Customer Charge。

不进入 Statement：

- 免费调用。
- 零收费 Charge。
- 无有效 Usage 的调用。
- 失败、取消、超时调用。
- 没有成功提交的结算。

CreditTransaction 不保存 `balance_after`。周期 opening/closing balance 由 Transactions 与当前 Balance 投影计算。

### 17.2 Payment History

Payment History 由 CreditPayment 与 CreditPurchaseOrder 派生，用于展示 option、金额、币种、Credits、创建时间和 `pending|credited`。

Payment 本身不能直接改变 Credits 余额。Billing 页面可以通过 `credit_payment_id` 为购买 Transaction 补充金额与币种，但余额仍只由正 CreditTransaction 变化。

## 18. API 与数字序列化

路径按现有 Playground 风格落地，以下为建议资源形态：

```text
GET  /api/account/credits
GET  /api/account/credits/statement
GET  /api/account/credits/payments
GET  /api/account/credits/purchase-options
POST /api/account/credits/purchases
```

LLM 收费字段继续复用：

```text
GET /api/agencies/{agency_code}/llm-configs/{llm_code}
PUT /api/agencies/{agency_code}/llm-configs/{llm_code}
```

Billing API 的 Microcredits 与货币最小单位统一返回十进制字符串；Token 继续返回 JSON number：

```json
{
  "balance_microcredits": "1250000",
  "delta_microcredits": "-400000",
  "payment_amount_minor_units": "1000",
  "input_tokens": 100
}
```

前端显示：

```text
1.25 积分
-0.40 积分
¥10.00
```

不向用户暴露 Microcredits 原始单位。

购买 API：

- 首次创建并已发放：`201 Created`。
- 相同幂等请求且既有 Payment 已 `credited`：`200 OK` 返回既有资源和原始快照。
- 新建或重复请求对应的 Payment 仍为 `pending`：`202 Accepted`。
- 相同幂等键携带不同 `option_code`：`409 Conflict`。

## 19. 错误与 viewer-aware 投影

### 19.1 错误链

```text
CreditAdmissionHook
→ PreModelCallOutput.blocking_error = "insufficient_credits"
→ AgentRunState.error
→ Playground run reason projection
```

不增加 Core `error_code` 字段或 Credits 专用异常模型。

同步、能够等待准入结果的入口可以返回 HTTP `402`。异步 Chat 的 `202` 或 WebSocket ACK 只表示命令和 Run 已被接受；后续准入失败时，Run 进入现有 error 终态。

### 19.2 共享 Session

如果 A 是 Workload Payer，B 是同一 Session 的合法成员：

- A 看到“积分不足”和一次性“购买积分”按钮。
- 按钮打开个人设置 Credits 区域。
- B 只看到通用“本次运行未能继续”。
- B 看不到 A 的余额、购买入口或具体财务原因。

相同过滤必须用于实时事件、重连恢复和历史 Run 查询。浏览器不得收到 `billing_subject_ref`。

现有 Playground 投影需要做三处明确改动：

- `session_history_response`、Run detail 和 activity snapshot 接收当前 `viewer_user_code`，批量按 Runs 的 `workload_id` 查询 Assignment 后再投影；响应不返回 `workload_id`。
- live broadcast 不能继续为整个 Session 生成一份 frame 后原样 fanout。Run lifecycle frame 必须按 `connection.user_code` 分别生成，付款人和非付款人得到不同 `reason/action`。
- WebSocket `watch_session`、重连恢复和 HTTP 历史必须复用同一个 viewer-aware projector，避免只修实时事件后从历史接口泄露财务原因。

产品不显示持续 Banner、低余额 Toast 或持久通知；余额在个人设置中按需查看，只有实际发起失败时展示错误。

## 20. 权限与隐私

v1 不新增角色或双重权限逻辑：

- 谁当前有权保存 LLM Configuration，谁继续通过相同入口保存 Credits 字段。
- 普通 Account 只能查看自己的 Balance、Statement 和 Payment History。
- Agency owner/admin 可按既有授权查看 Agency 聚合 Usage/Credits，但不能查看其他 Account 的个人余额和支付记录。
- Platform Admin 可查看全局无内容诊断。

所有 accounting API 不返回 prompt、response、message 内容、tool payload、API Key、credential 或无权限的内部诊断。

Playground 根操作必须来自已认证 Account。CLI 和未启用 Billing 的其他宿主不继承 Playground 登录规则；但任何准备访问付费配置且缺少 Assignment 的 Workload 必须在 provider dispatch 前被拒绝。

## 21. 失败矩阵

| 场景 | 发出模型请求 | Charge | Balance | 用户结果 |
|---|---:|---:|---:|---|
| 所有可达候选免费 | 是 | 否 | 不变 | 正常 |
| 付费候选、余额大于零 | 是 | 成功后按条件 | 按非零费用 | 正常 |
| 余额缺行、为零或负数 | 否 | 否 | 不变 | `insufficient_credits` |
| 付费候选缺少 Assignment | 否 | 否 | 不变 | 通用运行失败 |
| 付费候选 Rate 不完整/全零 | 否 | 否 | 不变 | 配置错误 |
| Admission 时 Runtime DB 不可用 | 否 | 否 | 不变 | 通用运行失败 |
| snapshot key 冲突 | 否 | 否 | 不变 | 通用运行失败，记录日志 |
| `stop` + 有效非零 Usage | 是 | 是 | 按结果 | 正常 |
| `length` + 有效非零 Usage | 是 | 是 | 按结果 | 正常 |
| `toolUse` + 有效非零 Usage | 是 | 是 | 按结果 | 正常并继续工具流程 |
| `error` | 是 | 否 | 不变 | 模型错误 |
| `aborted` | 是 | 否 | 不变 | 已取消 |
| timeout | 是 | 否 | 不变 | 超时 |
| 部分流后失败 | 是 | 否 | 不变 | 失败，已输出内容不收费 |
| Usage 缺失或全零 | 是 | 否 | 不变 | 成功结果照常交付 |
| 缺少 `msg_id` | 是 | 否 | 不变 | 成功结果照常交付 |
| `actual_llm_code` 不可信 | 是 | 否 | 不变 | 成功结果照常交付 |
| response 无 `model_id` | 是 | 按其他条件结算 | 按费用 | Charge 的 `model_id=NULL` |
| Usage 非零但费用为零 | 是 | 零收费 Charge | 不变 | 正常；不进 Statement |
| retry/fallback 前序失败、最终成功 | 是 | 只记录最终成功 | 按最终 Usage | 正常 |
| Metric 成功、Settlement 失败 | 是 | 否 | 不变 | 正常 |
| Metric 失败、Settlement 成功 | 是 | 是 | 改变 | 正常 |
| Charge 后 Message 持久化失败 | 是 | 保留 | 保留扣款 | Run 后续失败 |
| 成功响应后、Settlement 前崩溃 | 是 | 否 | 不变 | 不补扣 |
| 重复相同 Post | 已完成 | 幂等 | 不重复 | 不变 |
| 重复来源但事实冲突 | 已完成 | 不覆盖 | 不重复 | 记录一致性错误 |
| Full compaction 积分不足 | 否 | 否 | 不变 | 整个 Run 结束 |
| Micro compaction | 否 | 否 | 不变 | 正常 |
| Mock Payment 发放暂时失败 | 不适用 | 不适用 | 暂不增加 | `202 pending` |
| Runtime 已入账、Payment 回写失败 | 不适用 | 不适用 | 已增加一次 | scanner 幂等完成 |

## 22. 数据生命周期

- WorkloadBillingAssignment、ModelCallCharge 和 CreditTransaction v1 无限期保留。
- 删除 Message、Session、Run、Channel、Agency、Agent 或 LLM Configuration 不得级联删除账务事实。
- `source_msg_id`、`session_id` 和 `run_id` 是可能失效的来源快照，不建立运行时对象外键。
- Runtime accounting 只建立 Charge 到 Assignment 的内部 FK。
- Account 删除受购买历史 `RESTRICT` 约束。
- Account 注销后的匿名化和法务保留规则后续单独设计。

## 23. 迁移与实施清单

### 23.1 Runtime Database

- 新增四张 Platform SQLModel tables。
- 建立一个逻辑名为 `cube.platform.credit_accounting` 的独立 TableSpec，包含四张物理表，并由宿主通过 `tables.toml` 选择。
- SQLite 和 MySQL 都实现相同 CHECK、UNIQUE、FK 与索引。
- Repository 实现校验式幂等和 Balance 原子增量。
- 扩展 Platform `AccountingService`：
  - 服务端生成 `workload_id` 并创建 Assignment。
  - Admission 查询。
  - Settlement。
  - Balance、Statement 和 Charge 查询。

### 23.2 Core runtime

- `AgentRunRequest`、`AgentRunState`、`AgentRunContext` 增加/传播 `workload_id`。
- `DeliverMessage` 增加可选的受信任 `workload_id`，并限制只有 `mode=RECEIVE` 可携带。
- Platform 新增不可写入 transcript 的 `SessionDeliveryContext`；`RuntimeSessionCommandExecutor` 把命令字段交给 `BaseSession.receive`，Chat/Task 根 receive 在创建一个或多个初始 Runs 时复用它。
- `ToolRunContext`、`ToolCallContext` 传播 `workload_id`。
- SubAgent、Workflow 和 background durable payload 传播 `workload_id`。
- 扩展 `PreModelCallInput` 与 `PostModelCallInput`。
- 普通 assistant 路径把 `turn_id/source/labels/client_kind` 传给 Pre Hook。
- Full compaction 补齐 Pre Hook。
- `CompactModelCallState` 显式回传 admission error。
- Router 初始化 `llm_code=None`，持续检查响应/chunks 的最终 deployment identity。

### 23.3 Platform runtime/hooks

- 新增同实例 coordinator。
- 新增 `CreditAdmissionHook` 与 `CreditChargeHook`。
- 使用独立 `cube.plugins.credit_billing` PluginSpec 注册 `credit_billing` hook group，不修改通用 `cube.hooks` 的表依赖。
- 扩展 `RuntimeCapabilityMaterializer`，向两个 Hook 绑定同一个 Platform accounting runtime；禁止各自无参构造 coordinator 或使用全局 singleton。
- billing `PluginSpec.requires_tables` 只声明逻辑 TableSpec `cube.platform.credit_accounting`；该 spec 内含四张表。
- 所有候选保存 free/paid marker。
- key 冲突 fail-closed 且不覆盖。
- Admission 使用靠后 priority；Post 开始时原子 pop 快照，Settlement 失败不恢复。
- snapshot 缺失时按 `source_msg_id` 查询既有 Charge，匹配则视为重复 Post，未命中则 write-off。
- Settlement 异常全部在 Charge Hook 内吸收并记录。
- Charge 在 Metric 之前执行；两个持久化 Hook 都吸收自身 repository/validation 异常。

### 23.4 LLM Configuration

- `LLMConfigEntry` 增加收费字段，默认免费。
- Core `LLMConfig` 不增加 Credits 字段。
- 现有配置 GET/PUT 增加 DTO 校验和整数转换。
- 前端加入一个收费状态开关和四项 Rate 输入。
- 只显示 placeholder，不自动填入推荐值。
- 移除或隐藏会被误认为用户 Credits 定价的 LiteLLM 美元价格展示。

### 23.5 Playground Account Database

- 新增 Order 和 Payment 两张 application-owned tables。
- SQLite 每连接启用 `foreign_keys`。
- Order + pending Payment 同事务创建。
- 增加 pending scanner。
- 不把应用表加入 Cube TableSpec。

### 23.6 Runtime manifests

- Playground `plugins.toml` 显式启用 `cube.plugins.credit_billing`，并把 `credit_billing` 加入 `default_hooks`。
- Playground `tables.toml` 显式加载 `cube.platform.credit_accounting` 对应模块。
- CLI 默认 `plugins.toml` 从 `entry_points="all"` 改成 `entry_points="selected"`，保留当前 enabled 插件及依赖闭包，不挂载 billing hook group，也不加载 accounting TableSpec。
- 升级检查扫描已有 runtime root：仍使用 `entry_points="all"` 的宿主要么改成 `selected`，要么同时加载 accounting TableSpec；在完成前保持模型免费。

### 23.7 现有 LLMCallMetric 注释修正

`cube/platform/database/table/_llm_call_metric.py` 当前源码注释仍把 Metric 描述为“账单事实”，并描述了随消息硬删除的旧关系。实现 Issue #18 时应只修正这些注释，使其明确表达：

- `LLMCallMetric` 是 Token、模型和时间统计投影。
- 它不是 Customer Charge、Credit Balance 或 Statement 的事实源。
- Metric 的删除、重建或生命周期不能影响 ModelCallCharge 与 CreditTransaction。

本方案阶段只把该项列入实施清单，不修改现有业务代码。

### 23.8 Cutover 与滚动发布

- 旧 `LLMCallMetric` 不回填、不迁移、不追溯扣费。
- 旧 `llm.json` 缺少收费字段时默认免费，无需数据 backfill。
- 先部署数据库 schema，再部署 Core/Platform、全部 workers、Playground backend 和 frontend。
- 混合版本期间保持所有模型免费。
- 确认全部 workers 支持 workload 与 hooks 后，再逐个 LLM Configuration 显式开启收费。

## 24. 测试矩阵

### 24.1 Credits 数学与字段边界

- 四分区精确求和。
- round-half-up。
- 单项零费率。
- 总费用舍入为零。
- Rate 超过六位小数拒绝。
- 负 Token/Rate/购买金额拒绝。
- signed BIGINT 最大边界和乘法中间值不溢出。
- Billing API 在 JavaScript 安全整数之外仍使用十进制字符串。

### 24.2 Admission

- 免费直连保存 free marker。
- 付费直连。
- 缺少 workload/Assignment。
- Balance 缺行、零、负值、正值。
- Rate 缺项、负值、全零、合法单项零。
- Runtime DB、repository、配置校验异常（包括 `ValueError`）转 blocking output，而不是被 dispatcher 吞掉或向外泄漏。
- coordinator key 冲突不覆盖。
- Router 全免费。
- 免费 primary + 付费 fallback。
- labels 命中不同 initial config。
- 无关 rule 分支不参与准入。
- 所有候选 marker 均进入 snapshot。

### 24.3 Settlement

- `stop`、`length`、`toolUse`。
- `error`、`aborted`、timeout、部分流失败。
- 有效 Usage、缺失 Usage、全零 Usage。
- 缺少 `msg_id`。
- response 有 model_id 时保存实际值。
- response 缺 model_id 时保存 NULL，仍按可信 actual_llm_code 结算。
- 最终 config 不在 snapshot 时 fail-open。
- 零收费 Charge 且无 Transaction。
- 非零 Charge + Transaction + Balance 同事务。
- 余额变负。
- 重复相同结算。
- snapshot 已 pop 后收到重复 Post，按既有 Charge 幂等成功。
- 重复 Post 使用首次持久化的 canonical `model_call_charge_id`，不重复创建 Transaction 或增量 Balance。
- 相同来源但事实冲突。
- Transaction 已存在时不重复增量 Balance。
- 数据库提交失败不影响成功结果。
- Metric/Charge 四种独立成功失败组合。
- Charge 成功后 Message 持久化失败时 Charge 保留。

### 24.4 Router

- 调用开始 `llm_code=None`。
- 非流式 response 回填。
- 第一 chunk 无 identity、后续 chunk 回填。
- fallback 最终模型。
- 相同 model_id 对应不同 LLM Configuration。
- 不能从 model_id 猜 llm_code。
- retry/fallback 失败不收费。

### 24.5 Compaction

- Full compaction 触发 Pre/Post。
- Full compaction 原有 Token 与 Metric 不变。
- effective labels 正确合并。
- admission error 写入 CompactModelCallState。
- dispatcher 吞 handler 异常后，外层仍能恢复并结束 Run。
- admission 失败时 `CompactionStartEvent` 与唯一一条失败 `CompactionEndEvent` 成对。
- Full compaction 收费。
- Micro compaction 不触发 Credits hooks。

### 24.6 Workload 传播

- Chat 根 Run。
- 一次根操作创建多个目标 Runs，共享一个 workload。
- ToolRunContext 与 ToolCallContext。
- foreground/background tool。
- background durable payload 和恢复。
- SubAgent。
- Workflow。
- Task start、intervention、resume、review/rework。
- follow-up/steer 不换付款人。
- cancel 不产生费用或转移付款人。
- 新根 Run 创建新 Workload。
- `DeliverMessage.workload_id` 只允许 RECEIVE；steer/follow-up 携带时命令校验失败。
- local/cluster codec 与 `RuntimeSessionCommandExecutor → SessionDeliveryContext → AgentRunRequest` 链路一致。
- 浏览器伪造 workload/billing subject 被忽略或拒绝。

### 24.7 数据库约束与并发

- Assignment 相同 payer 幂等，不同 payer 冲突。
- Charge 全字段幂等比较。
- Transaction 幂等不比较候选时间。
- MySQL/SQLite CHECK 与 FK。
- Account SQLite `PRAGMA foreign_keys=ON`。
- Order+Payment 原子事务回滚。
- 解析 `cube.plugins.credit_billing` 但漏装逻辑 TableSpec `cube.platform.credit_accounting` 时启动失败。
- 一个 accounting TableSpec 的 registry 中恰好包含四张预期物理表。
- 两个 billing Hook materialize 后绑定同一个 accounting runtime/coordinator。
- 并发 Settlement 不重复扣款。
- 单个和并发结算形成负余额。
- 从 Transactions 重建 Balance 与投影一致。

### 24.8 Mock 购买

- Mock 关闭。
- 合法/非法 option。
- 客户端伪造金额无效。
- 相同幂等键相同参数。
- 相同键不同参数冲突。
- 首单响应丢失后修改 purchase option，再用原 idempotency key + 原 option_code 重试时返回原始快照而非冲突。
- 立即发放成功。
- 发放失败返回 pending。
- scanner 重试。
- Runtime 已入账、Account DB 未回写。
- 关闭 Mock 后历史 pending 继续处理。

### 24.9 Statement、UI 与隐私

- 按 `posted_at` 归期。
- 按 Workload 聚合并展开 Charges。
- 零收费 Charge 不进 Statement/时间消费统计。
- 购买入账与 Payment History 分离。
- opening/closing balance。
- 大整数格式化为普通积分和货币。
- 付款人与其他 Session viewer 得到不同错误投影。
- 同一共享 Session 的两个 WebSocket 同时收到同一 Run 终态时，payer 与非 payer 的 reason/action 不同。
- realtime、watch/reconnect activity snapshot 和 HTTP 历史查询过滤一致。
- 任一浏览器 payload 都不含 `workload_id` 或 `billing_subject_ref`。
- 无持续 Banner。
- 个人设置 Credits 区域。
- Rate placeholder 不自动保存。
- Playground manifest 同时选择 billing PluginSpec、hook group 与 accounting TableSpec。
- CLI selected manifest 保留现有默认能力，但不解析或挂载 billing plugin。
- 旧 runtime root 使用 `entry_points="all"` 且未加载 accounting TableSpec 时，升级预检给出明确迁移错误。

### 24.10 回归命令

```bash
uv run --all-extras pytest tests -q
uv run --package cube-playground-backend pytest apps/playground/backend/tests -q
npm --prefix apps/playground/frontend run typecheck
npm --prefix apps/playground/frontend run build
NEXT_OUTPUT_EXPORT=1 npm --prefix apps/playground/frontend run build
uv run --all-extras python -m compileall cube tests
```

普通测试不得调用真实 LLM 或真实支付渠道。

## 25. 分阶段实施

### 阶段 1：Accounting schema 与数学

实现六实体中的四个 Runtime 表、Credits 计算、repositories、幂等事务与 Balance 原子增量。

成功标准：数学、CHECK/UNIQUE/FK、并发和余额重建测试通过。

### 阶段 2：Workload 边界

实现 Platform 生成 workload、Assignment、受信任命令元数据，以及 Run/Tool/SubAgent/Workflow/Task/background 传播。

成功标准：所有后代执行保持同一个付款人，浏览器不能注入身份。

### 阶段 3：Admission、Settlement 与 Router

实现两个 Hook、共享 coordinator、Pre/Post 输入、Router 可信归因和 Full compaction 错误回传。

成功标准：只对成功 Model Call 收费，失败路径不收费，现有 Metric 保持兼容。

### 阶段 4：Mock 购买

实现两张 Account 表、SQLite FK、启动配置、购买 API、Runtime 发放和 pending scanner。

成功标准：跨数据库故障和重复请求下 Credits 恰好入账一次。

### 阶段 5：Playground API/UI

实现余额、Statement、Payment History、LLM 收费配置、调用处错误与 viewer-aware 投影。

成功标准：权限、隐私、字符串序列化、frontend typecheck/build 通过。

### 阶段 6：Cluster 与发布

完成 MySQL 验证、worker 组装、滚动发布检查和 structured logs，最后逐模型开启收费。

成功标准：local/distributed 行为一致，未升级 worker 不会在收费开启后承接 Run。

## 26. 最终验收标准

- 默认升级后继续免费。
- 只有成功 Model Call 的有效非零 Usage 能形成 Charge。
- `toolUse` 中间调用独立收费。
- retry/fallback 失败不收费。
- Token 统计和收费观察同一 `PostModelCall`；Charge 按 priority 先执行，Metric 后执行，但事务与事实源独立。
- 无法可靠结算时不收费、不补扣、不影响成功结果。
- Credits 用尽后新的付费调用在 provider dispatch 前被拒绝。
- 单次与并发 Settlement 可以形成负余额。
- Router 只按最终可信实际配置收费。
- `model_id` 仅保存实际响应值并允许为空，不参与收费身份判断。
- Full compaction 原有 Token 统计不变，并获得 Pre Admission。
- CompactModelCallState 不会丢失被 dispatcher 吞掉的 admission error。
- Full compaction 准入失败时 Start/End 事件仍严格成对。
- 一个根 Workload 的多目标 Runs 与全部后代执行共享付款人。
- coordinator 冲突不覆盖，不增加 TTL 或容量限制。
- 重复 Post 复用 canonical Charge ID，Transaction 与 Balance 不会重复写入。
- Statement 只由 CreditTransaction 派生，零收费 Charge 不参与时间统计。
- Payment History 只由 Order/Payment 派生。
- Mock 购买在重试和跨数据库故障下恰好发放一次。
- Account SQLite 外键实际启用。
- 单个 `cube.platform.credit_accounting` TableSpec 包含四张 Runtime accounting 表；独立 billing PluginSpec 只由 Playground 显式挂载。
- CLI selected manifest 保持现有默认能力且不解析 billing plugin；旧 `all` runtime root 在开启收费前完成迁移。
- Billing API 大整数不经过 JavaScript `Number`。
- 其他 Session 成员看不到付款人的财务错误。
- 旧 `LLMCallMetric` 不迁移、不追溯收费，其源码注释得到纠正。
- 账务事实独立于 Message、Session 和运行时对象生命周期。
