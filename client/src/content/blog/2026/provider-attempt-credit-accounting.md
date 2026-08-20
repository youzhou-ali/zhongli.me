---
title: 从 Token 指标到可审计 Credits：Cube 的 Provider Attempt 计量与预付费 Wallet 设计
slug: provider-attempt-credit-accounting
date: 2026.08.19
category: 构建
summary: 一套面向 Agent Runtime 的 Credits 计量与预付费账务设计：以每次真实 Provider Attempt 为最小事实粒度，在 retry、Streaming、并发与崩溃场景下仍保持可解释、幂等和可审计。
---

> 本文是 [Cube Issue #18](https://github.com/mindshake-ai/cube/issues/18) 的设计方案，不是当前已经完整上线的行为。
>
> 截至本文撰写时，Cube 已有 Run 级 Token 汇总和 `LLMCallMetric`，但 Provider Attempt Ledger、Credit Pricing、Wallet、充值与 Statement 尚待分阶段实现。真实支付渠道另由 [Issue #22](https://github.com/mindshake-ai/cube/issues/22) 交付。
>
> 本文全部架构图的 [Draw.io 源文件](/diagrams/provider-attempt-credit-accounting/cube-credit-billing-architecture.drawio) 可直接下载和继续编辑。

Cube 已经能够调用不同 LLM Provider、执行 router fallback、保存 Run 级 Token 汇总，并通过 `PostModelCall` Hook 记录部分调用指标。但“能统计 Token”与“可以安全地向用户扣 Credits”之间，仍然隔着一整套账务边界。

引入 retry、fallback、Streaming、取消、多人共享 Session、并发请求和进程崩溃后，按最终消息或逻辑 Model Call 记一条 metric，无法可靠回答这些问题：

- 一次逻辑调用实际向 Provider 发出了几次请求？
- 第一次请求失败但已经返回 Usage，是否收费？
- Streaming 返回多份累计 Usage，应该累加还是只取最终值？
- Provider 没返回 Usage，与明确返回合法的零 Usage 是否相同？
- Provider 请求已经发出，但进程在扣款前崩溃，应该重放、补扣还是放弃？
- 两个并发请求都在余额为正时通过，结算后出现负余额是否允许？
- 共享 Session 的其他成员是否可以看到付款人的“积分不足”？
- 支付已经成功，但 Credits 尚未进入 Runtime Wallet，怎样避免丢失或重复到账？

这套方案把问题收敛为两件事：

1. 以每次真实 Provider Attempt 为最小计量和收费粒度，保存可信的 Canonical Usage；
2. 使用预付费 Credits 控制新的付费调用，并通过不可变 Wallet Entries 形成可审计 Statement。

Cube 不在这套模型中核算 Provider 货币成本，也不实现 Budget、Reservation 或事后 Reconciliation。

## 一、先划清范围

### 设计目标

Issue #18 计划提供：

- 每次真实 Provider 请求的稳定身份和持久化生命周期；
- retry、fallback、失败、取消和部分 Streaming 的 attempt 级 Usage；
- `valid`、`missing`、`invalid` 三种 Usage 状态；
- 版本化 Credit Pricing；
- 预付费 Credit Wallet、调用准入和原子 Settlement；
- Workload 到 Billing Subject 的不可变归属；
- Account 余额、Statement 和 Payment History；
- 渠道无关、可重试且幂等的充值交付契约；
- local runtime 与 cluster worker 使用同一套 Platform accounting 语义。

### 明确不做

以下内容不属于 #18：

- Budget Policy、Period Counter、soft budget 或 hard budget；
- Reservation、最大费用预估、余额冻结与释放；
- 严格保证 Wallet 永不为负；
- Provider Price、Provider Cost、USD 成本、汇率或毛利；
- Missing/Invalid Usage 的估算、查询 Provider 补齐或未来补扣；
- Stripe、支付宝、微信等真实支付渠道；
- Refund、Chargeback、部分退款和 Credit reversal；
- 低余额阈值、持续 Banner 或主动余额通知；
- 把 Playground Account/Auth 语义放进 `cube.core`；
- 将历史 `LLMCallMetric` 迁移成收费 Ledger，或追溯扣除历史 Credits。

支付交易未来仍会记录用户实际支付的金额和币种，但那是充值支付事实，不是模型供应商成本。

## 二、为什么现有 `LLMCallMetric` 不能直接收费

当前主要路径大致是：

```text
Provider response
  → extract_usage()
  → Model Call 终态
  → PostModelCall Hook
  → LLMMetricRecorderHook
  → cube_llm_call_metric
```

这条路径适合产品指标，但不够支撑账务。

第一，`LLMCallMetric` 以 `msg_id` 唯一，表达的是最终产生持久化模型产物的调用指标。一个逻辑 Model Call 如果在 Router 内部发生多次 retry 或 fallback，最终消息仍然只有一条，metric 无法表达每次真实 Provider dispatch。

第二，当前 `extract_usage()` 面向兼容性：缺失字段、非法类型和负数最终可能被归零，缓存分区超过 `prompt_tokens` 时也会用 `max(..., 0)` 得到非缓存 input。对展示型指标而言，这种宽容有价值；对扣费而言，它会混淆两个完全不同的事实：

```text
Provider 明确报告 0 Token
```

和：

```text
Provider 没报告、报告损坏，或 adapter 无法可靠解释
```

第三，LiteLLM Router 可以在内部处理 retry、fallback 和 deployment 选择。只要真实网络请求被隐藏在 Router 内，Cube 就无法保证“一次外部请求恰好对应一个可持久化 Attempt”。

因此，新账务 Ledger 不能建立在 `msg_id`、最终消息或 `PostModelCall` Hook 上。旧 `LLMCallMetric` 继续服务于 legacy Token 查询，新 Ledger 从明确 cutover 时间开始独立写入；两者不迁移、不回填、不追溯收费。

## 三、领域模型：不要把不同层次叫成一次“调用”

### Workload

Workload 是宿主实际启动的一次根执行，以及由它因果触发的全部后代执行。

一个 Playground Account 启动一次 Chat Run，会形成一个 Workload。随后产生的 Tool、SubAgent、Workflow、compaction、后台延续、Model Call、retry 和 fallback 都继承同一个 `workload_id`。

Workload 不是 Session。另一个 Account 即使在同一个共享 Session 中发起新执行，也会创建新的 Workload，并成为该 Workload 的付款主体。

### Model Call

Model Call 是 Cube 为一个逻辑目的发起的 LLM 调用，例如生成 assistant reply、生成 compaction summary，或让某个 SubAgent 继续推理。

一个 Model Call 可以包含一个或多个 Provider Attempts。Model Call 本身不作为最小账务事实建表，而是通过 `call_id` 聚合 Attempts。

### Provider Attempt

Provider Attempt 是一次准备发送给具体 Provider deployment 的请求单元，也是最小计量和收费粒度。

例如一个 Model Call 的执行过程是：

```text
Attempt 1：主模型 timeout，但已经返回有效 Usage
Attempt 2：重试主模型，429，没有 Usage
Attempt 3：fallback 模型成功
```

账务上必须保存三个 Attempts：

- Attempt 1 有有效 Usage，应收费；
- Attempt 2 没有 Usage，形成永久 Usage Write-off，不收费；
- Attempt 3 有有效 Usage，应收费；
- Model Call 的展示费用是 Attempt 1 与 Attempt 3 的聚合。

### Usage Ledger Entry

已经 dispatch 的 Provider Attempt 完成 Settlement 时，追加一条不可变 Usage 结果。它保存 Usage 状态、四个 Token 分区、适用的 Pricing Revision、实际应用的四项 Rate 快照和 Customer Charge。付费结算时 Revision 与 Rate 快照必须完整保存；免费 Attempt 不应用任何 Rate，因此四项 applied Rate 一律为空，其中默认免费可以没有 Revision，显式免费则保留 Revision ID。

一个已 dispatch 且终结的 Attempt 恰好对应一条 Usage Ledger Entry。崩溃后保持 incomplete 的 `dispatching` Attempt 没有 Ledger；确认从未发送的 `not_dispatched` Attempt 也没有 Ledger。

### Wallet Entry

Wallet Entry 是改变 Credits 余额的不可变事实：

- 模型消费产生 `usage_debit`；
- 充值交付产生 `top_up_credit`。

Usage Ledger 回答“这次 Provider Attempt 消耗了什么、应收多少 Credits”；Wallet Entry 回答“用户余额为什么改变”。两者不能合并成一张表。

## 四、上下文架构与依赖方向

![Cube Credits 计量与账务上下文](/diagrams/provider-attempt-credit-accounting/01-system-context.svg)

### Core Agent Runtime

`cube.core` 只拥有平台无关的执行协议：

- Workload、Model Call 和 Provider Attempt 身份；
- 显式 Usage Report 状态；
- lifecycle hook/protocol；
- 通用、机器可读的错误码传播。

Core 不能导入 `cube.platform` 或 Playground。未来可以通过类似 `ProviderAttemptLifecycle` 的协议由宿主注入持久化行为；没有注入 lifecycle 的 standalone Core client 保持现有兼容行为，不自动获得 Playground Credits 语义。

### Platform Host

Platform 拥有 Runtime Database 中的 accounting 状态：

- Credit Pricing；
- Admission；
- Provider Attempt Record；
- Usage Ledger；
- Wallet；
- Settlement。

本地部署使用本地 Runtime Database；cluster backend/worker 通过组合根连接共享数据库。`cube.platform` 保持 local-first，不加入 Redis lease、worker identity 或 MySQL 特例。

### Playground Billing

Playground backend 继续拥有：

- Account、credential 与登录态；
- Billing Subject 映射；
- Top-up Order 与 Payment Transaction；
- HTTP/WebSocket 接口；
- 面向不同 viewer 的客户投影。

Platform 只看到不透明 `billing_subject_id`，不跨库关联 Playground Account，也不在 SDK 中实现认证。

## 五、Provider Attempt 状态机

![Provider Attempt 状态机](/diagrams/provider-attempt-credit-accounting/03-attempt-state-machine.svg)

Attempt 使用三个持久化状态：

```text
prepared → dispatching → terminal
```

其中有两条不同的终结路径。

### 路径 A：确认未发送

Admission 成功后先提交 `prepared`。如果当前执行明确决定不再发送，或后台清理长期停留的 `prepared` Attempt，可以用另一条 CAS 把它终结为：

```text
status = terminal
outcome = not_dispatched
```

因为可以证明 Provider 没收到请求，所以它没有 Usage Ledger，也不收费。

```sql
UPDATE provider_attempt
SET status = 'terminal', outcome = 'not_dispatched', terminal_at = :now
WHERE attempt_id = :attempt_id
  AND status = 'prepared';
```

只有这条 CAS 提交且恰好更新一行，才能判定 `not_dispatched`。更新零行时必须重新读取 Attempt：另一个 Worker 可能已经把它推进到 `dispatching`，绝不能把“CAS 没抢到”解释为“请求未发送”。反过来，准备发送的 Worker 如果推进 `dispatching` 的 CAS 更新零行，也必须重新读取并停止发送。

这一步是本轮设计复核后补上的明确不变量：不能强行让所有 `terminal` Attempt 都有 Ledger，否则“确认未发送”会被错误伪装成 Missing Usage。

### 路径 B：已经 dispatch

任何 Provider 外部 I/O 前，都必须用 CAS 将 Attempt 更新为 `dispatching` 并提交：

```sql
UPDATE provider_attempt
SET status = 'dispatching', dispatching_at = :now
WHERE attempt_id = :attempt_id
  AND status = 'prepared';
```

只有事务提交并且恰好更新一行，才能发送 Provider 请求。

Provider 返回后，通过原子 Settlement 进入 `terminal`。这条路径必须产生一条 Usage Ledger Entry，即使 Usage 状态是 `missing`、`invalid` 或合法全零。

### 为什么不自动终结 stale `dispatching`

原方案曾考虑使用 scanner，在 deadline 后将悬空 `dispatching` 自动终结为 Missing Usage。复核后删除了这个机制，因为 scanner 可能与迟到的真实 Provider 响应竞争：

```text
Provider 正准备返回有效 Usage
        ↕
scanner 抢先把 Attempt 写成 missing
```

不可变 Ledger 一旦写入，真实 Usage 就不能再覆盖。

最终规则是：

- 正常 timeout、cancel 或错误由仍持有执行权的调用链终结；
- 进程崩溃遗留的 `dispatching` 长期保持原状态；
- 查询层把它派生显示为 `incomplete` 或 `dispatch_unknown`；
- 不自动重发、不自动终结、不收费、不补扣。

`incomplete` 不是 Missing Usage Write-off。前者没有 Ledger，后者是已终结 Attempt 的明确 Ledger 结果。

## 六、一次付费 Attempt 的完整流程

![一次付费 Provider Attempt 的流程](/diagrams/provider-attempt-credit-accounting/04-paid-attempt-flow.svg)

完整流程为：

1. Cube 选择实际 deployment，确定 `llm_code`、provider 和 model；
2. Admission 事务读取 Workload、当前 Pricing 和 Wallet；
3. 准入成功后插入并提交 `prepared` Attempt；
4. CAS 更新并提交 `dispatching`；
5. 发送 Provider 请求；
6. 将 Provider Usage 归一化为 `valid | missing | invalid`；
7. 在单一 Runtime Database 事务中完成 Settlement；
8. Settlement 提交后交付非流式结果，或允许开始下一个 retry/fallback。

Admission 失败发生在 Provider 请求之前，不创建 Attempt、Usage Ledger 或 Wallet Entry。同步调用返回结构化错误；异步调用由 Run 错误与运维遥测表达，不增加 `admission_rejection` 表。

`insufficient_credits` 是 dispatch 前的不可重试产品错误：它立即终止当前 Model Call，不进入 retry/fallback，也不把用户消息改写成普通 Provider“发送失败”。

如果 Provider 已经收到请求后 accounting 暂时失败，只能重试同一个幂等 Settlement，不能把 accounting 故障解释成 Provider 失败并再次 dispatch。

## 七、Retry 与 Fallback 必须显式编排

![Retry Fallback Settlement Barrier](/diagrams/provider-attempt-credit-accounting/05-retry-settlement-barrier.svg)

Provider Attempt 只有在 Cube 能观察每次真实 dispatch 时才成立。因此实施时必须关闭所有隐藏重试：

- direct LiteLLM client 的 `max_retries`；
- LiteLLM Router 的内部 retry；
- Router 内部 fallback；
- 单次运行参数可能传入的 retry 配置。

Cube 显式执行：

```text
resolve candidate
  → begin Attempt
  → dispatch，或 CAS 终结为 not_dispatched
  → 已 dispatch 时 settle
  → 根据合法终态决定下一个 candidate
```

前一个 Attempt 到达合法终态前，不得开始下一个 retry/fallback；已经 dispatch 的 Attempt 必须等 Settlement 提交，`terminal:not_dispatched` 则没有 Ledger 或 Settlement。这条 Barrier 防止两个问题：

1. 前一次实际 Usage 和 Charge 尚未确定时就继续消耗；
2. accounting 故障错误触发新的 Provider 请求。

Router 仍可承担候选选择和常规路由策略，但每次最终外部 dispatch 必须显式形成一个新的 `attempt_no`。

## 八、Usage：四个互斥分区与三种状态

Canonical Usage 固定为四个互斥分区：

1. 非缓存 input；
2. cache read；
3. cache write；
4. 完整 output。

完整 output 已经包含 reasoning tokens，不能再次把 reasoning 相加。Tool 定义和 Tool Result 属于输入内容，Tool Call 参数属于模型输出内容；v1 不增加独立 Tool Token 收费桶。

### `valid`

Provider 按明确字段合同返回可以可靠归一化的 Usage。合法全零也属于 `valid`：

```text
input = 0
cache_read = 0
cache_write = 0
output = 0
```

它会形成 Usage Ledger Entry，但 Charge 为零，不创建 Wallet Debit。

### `missing`

Provider 没有提供可用 Usage。Missing 不等于零，也不能用本地 tokenizer 估算值代替。

### `invalid`

Provider 返回了 usage 数据，但 adapter 无法按该 Provider 的明确合同可靠映射，例如：

- 字段是非法类型或负数；
- cache read/cache write 与输入总量关系不可能成立；
- 出现无法映射到四分区的独立计价项；
- 字段含义必须依赖猜测。

Missing 和 Invalid 都是永久 Usage Write-off：

- 保存状态和最小诊断代码；
- Customer Charge 为零；
- 不估算、不查询 Provider 补齐；
- 不做 Reconciliation；
- 不在未来补扣用户。

这是收费路径的 fail-open：Cube 无法证明 Usage 时，损失由平台承担。

### Streaming

如果 Provider 在多个 chunks 中返回累计 Usage，只使用最后一份有效累计值：

```text
chunk 1 = 100
chunk 2 = 180
chunk 3 = 250
最终 Usage = 250
```

不能计算为 `100 + 180 + 250`。

即使 Streaming 最终失败、取消或只输出部分内容，只要已经取得有效 Usage，仍按这份 Usage 结算。Streaming 内容一旦交给客户端便无法撤回；如果最终 Settlement 持续失败，当前连接以非重试 accounting error 结束。

## 九、Credits、Rate Card 与不可变 Pricing Revision

Cube 不保存 Provider Price 或 Provider Cost，只计算面向用户的 Credit Charge。

```text
1 Credit = 1,000,000 Microcredits
```

Wallet、Rate 和 Charge 全部使用整数 Microcredits。Token 使用非负 `BIGINT`；计算中间值使用 Python 大整数或数据库 `DECIMAL`，写入 `BIGINT` 前检查溢出，不能依赖 64 位中间乘法。

### Credit Rate Card

收费 LLM Configuration 有四项 Rate，单位是“每一百万 Token 消耗多少 Credits”：

- 非缓存 input；
- cache read；
- cache write；
- output。

Rate 最多接受六位 Credits 小数，超出 Microcredit 精度的输入直接拒绝，不能静默舍入。

计算公式为：

```text
charge_microcredits =
  round_half_up(
    Σ(tokens_i × rate_microcredits_per_1m_i) / 1,000,000
  )
```

四个分区先精确求和，一个 Attempt 的总额只执行一次 round-half-up。不能逐分区舍入，也不能跨 retry/fallback Attempts 合并舍入。

例如：

```text
100,000 input       × 1 Credit / 1M = 0.1000
20,000 cache read   × 0.1             = 0.0020
10,000 cache write  × 1.25            = 0.0125
30,000 output       × 5               = 0.1500
合计                                      0.2645 Credits
```

最终 Charge 是 `264,500 Microcredits`。显式 Rate `0` 合法；最终舍入为零时保留 Ledger，但不创建 Wallet Debit。

### Pricing Revision

收费配置仍放在现有 LLM Configuration 管理界面，不新增独立“模型定价后台”。每次保存收费开关或 Rate Card 时：

1. 创建新的不可变 `credit_pricing_revision`；
2. 将 `credit_pricing_current` 指向新 revision；
3. 立即对之后准入的 Attempts 生效。

已准入 Attempt 固定使用当时 revision。修改价格不能改变历史 Charge；所谓回滚，也是复制旧值创建新的 revision。

后端可以使用 accounting 专用子资源或 command 来保证双重授权和不可变 revision，但前端位置仍是现有 LLM 配置页，不形成第二套管理产品。

Pricing 字段不进入 Core `LLMConfig` 或 `llm.json`。连接配置的普通 PUT 只修改 provider、model、Base URL、credential 和运行参数，不能隐式创建或切换 Pricing Revision；收费字段必须经过独立的 accounting command/sub-resource。

### 默认免费兼容

- 既有配置默认免费；
- 从未出现过 current Pricing 的新 `(agency_code, llm_code)` 默认免费；
- 查询数据库成功且确认 current 不存在，才能解释为默认免费；
- 查询失败不能解释为免费，Platform accounting 路径 fail-closed；
- 显式免费 revision 的 Rate Card 可以缺省；如果保存 Rate Card，四项必须同时存在且非负，不能只保存一部分；
- 开启收费后，四项 Rate 必须全部存在，显式 `0` 合法。

前端只使用 placeholder 隐式提示推荐值，例如 `1 / 0.1 / 1.25 / 5`，不会自动填入或保存。

### 权限与永久 Billing 身份

修改 Credit Billing 开关或 Rate Card，需要调用者同时是：

- 当前 Agency 的 owner/admin；
- Platform Admin。

Agency Admin 继续在原位置修改 provider/model、Base URL、credential 和运行参数；收费字段对不满足双重权限的用户只读。连接信息变化不会自动修改当前 Pricing。

`(agency_code, llm_code)` 被视为永久 Billing 身份：删除连接配置后以相同 `llm_code` 重建，继续沿用原 Pricing。

这个规则有两个明确边界：

1. 它只防止相同 code 通过删除重建清空 Pricing；Agency Admin 仍可以创建一个从未使用的新 code，获得默认免费配置。默认免费是兼容策略，不是平台级不可绕过的强制收费。
2. 它假设 `agency_code` 不会在账务存留期内被另一个租户复用。如果未来允许复用，付费上线前必须改用不可复用的 Agency identity。

## 十、Wallet：控制新调用，而不是保证永不透支

付费 Attempt 的 Admission Check 要求：

- Workload 有 Billing Subject；
- Pricing Revision 完整且 billing enabled；
- Wallet Balance `> 0`；
- Runtime accounting 可以可靠持久化；
- Attempt 的 attribution 和 pricing 已被冻结。

免费配置不检查 Wallet，也不产生 Customer Charge；但只要使用 Platform accounting lifecycle，仍需在 Provider dispatch 前保存 Attempt。因此 Runtime Database 不可用时，Platform 路径对免费和付费调用都 fail-closed。完全未注入 accounting lifecycle 的 standalone Core client 不受此规则影响。

### 为什么没有 Reservation

设计按照实际 Usage 事后扣款，不预估、不冻结 Credits。余额为正只是新的付费 Attempt 的准入条件，不是严格 hard cap。

单个高额 Attempt 可以形成负余额：

```text
调用前：0.1 Credits
实际费用：0.5 Credits
结算后：-0.4 Credits
```

多个并发 Attempts 也可以形成负余额：

```text
余额：1.0 Credit
Attempt A 准入
Attempt B 准入
A 扣 0.8
B 扣 0.7
最终：-0.5 Credits
```

这些已准入 Attempts 正常结算。余额变为 `<= 0` 后，拒绝新的付费 Attempt。

这用可控的 Settlement Overage，换取不引入 Reservation、上界估算、lease 和账务专用并发限制。

### Atomic Settlement

已经 dispatch 的 Attempt 必须在同一个 Runtime Database 事务中完成：

```text
Attempt → terminal
+ 唯一 Usage Ledger Entry
+ 非零费用的唯一 Wallet Debit
+ Wallet Balance 原子增量
```

终态迁移本身也必须是 CAS：

```sql
UPDATE provider_attempt
SET status = 'terminal', outcome = :outcome, terminal_at = :now
WHERE attempt_id = :attempt_id
  AND status = 'dispatching';
```

只有更新一行时，本事务才继续写 Ledger、Debit 和 Balance。更新零行必须重读 Attempt 与 Ledger：既有终态、Usage、Revision、Rate 快照和 Charge 与本次 Settlement payload 全部相同，才作为幂等成功返回；否则是冲突，禁止覆盖既有 outcome 或账务事实。

`wallet_balance` 禁止使用 ORM 的“读取 → Python 加减 → 保存”，必须使用：

```sql
balance_microcredits = balance_microcredits + :delta
```

或等价的行锁/版本 CAS。

Wallet Entries 是唯一余额事实源，Wallet Balance 只是高频 Admission 使用的可重建投影。

## 十一、最小持久化模型：7 + 3

![Runtime 7 + Account 3 ERD](/diagrams/provider-attempt-credit-accounting/02-runtime-account-erd.svg)

### 通用约定

- 业务 ID 使用全局唯一的不透明字符串，推荐 UUID/ULID；
- 跨数据库幂等键不能使用本地自增整数；
- Credits、Rate、Charge 和 Balance 使用有符号 `BIGINT` Microcredits；
- Token 数使用非负 `BIGINT`；
- 时间统一使用 UTC；
- `wallet_entry.posted_at` 是 Statement 周期归属的唯一时间；
- Runtime Database 的 accounting 表不向 Session、Message、LLM 配置文件或 Playground Account Database 建物理 FK；
- accounting 内部 FK 使用 `RESTRICT`，禁止级联删除；
- v1 的 Runtime 7 表与 Account 3 表 Accounting Records 全部无限期保留，不随 Message、Session、Channel、Agency、LLM 连接配置或 Account 等运行对象删除；自动归档、匿名化和法务保留以后单独设计；
- 不保存 prompt、response、Tool payload、API Key 或原始 Provider 错误正文。

### Runtime Database：7 张表

#### 1. `workload_attribution`

不可变根归属事实。

| 字段 | 约束与含义 |
| --- | --- |
| `workload_id` | PK，全局唯一 |
| `billing_subject_id` | nullable、index；Playground 付费主体，不收费宿主可空 |
| `agency_code` | nullable、index；根执行所属 Agency 快照 |
| `channel_code` | nullable；根 Channel 快照 |
| `root_session_id` | nullable |
| `root_run_id` | nullable |
| `workload_kind` | nullable，例如 `chat/task/workflow` |
| `initiated_at` | not null |

相同 `workload_id` 和相同内容重放时幂等；Billing Subject 或根归属不同则报冲突，永不覆盖。

#### 2. `credit_pricing_revision`

不可变收费政策事实。

| 字段 | 约束与含义 |
| --- | --- |
| `pricing_revision_id` | PK |
| `agency_code`、`llm_code` | not null，永久 Billing 身份 |
| `revision_no` | 正整数 |
| `billing_enabled` | not null boolean |
| 四项 `*_rate_microcredits_per_1m_tokens` | 免费时可全空或完整保存；收费时必须全部存在；只要存在就必须非负且禁止部分为空 |
| `created_at` | not null |

唯一约束：

- `UNIQUE(agency_code, llm_code, revision_no)`；
- `UNIQUE(agency_code, llm_code, pricing_revision_id)`，作为身份安全复合外键的候选键。

Revision 插入后禁止修改和删除。`created_by_actor_ref` 可以作为审计字段，但不属于收费正确性的最小字段。

#### 3. `credit_pricing_current`

当前 Revision 指针。

| 字段 | 约束与含义 |
| --- | --- |
| `agency_code`、`llm_code` | composite PK |
| `pricing_revision_id` | unique、not null |
| `updated_at` | not null |

使用 `(agency_code, llm_code, pricing_revision_id)` 复合 FK 指向 Revision，防止指向另一个配置的价格。没有 current 行表示从未配置过收费，按默认免费解释；显式从付费切回免费时创建新的免费 Revision，不删除 current。

#### 4. `provider_attempt`

权威但可状态迁移的 Provider 请求生命周期记录。

| 字段 | 约束与含义 |
| --- | --- |
| `attempt_id` | PK |
| `workload_id` | FK → `workload_attribution` |
| `call_id`、`attempt_no` | not null，`UNIQUE(call_id, attempt_no)` |
| `agency_code`、`llm_code` | not null；实际命中配置的永久 Billing 身份 |
| `session_id`、`run_id`、`agent_code` | 实际执行维度 |
| `llm_router_code` | nullable；实际命中的可选 Router |
| `provider`、`model` | 实际 deployment 快照 |
| `pricing_revision_id` | nullable；默认免费可空；非空时与 `agency_code`、`llm_code` 组成复合 FK → `credit_pricing_revision` |
| `status` | `prepared | dispatching | terminal` |
| `outcome` | terminal 时为 `not_dispatched | succeeded | failed | cancelled | timed_out` |
| `provider_request_id`、`error_code` | nullable、归一化诊断 |
| `prepared_at`、`dispatching_at`、`terminal_at` | 生命周期时间 |

Workload、实际 provider/model、`(agency_code, llm_code)` 和 Pricing Revision 创建后不可变，任何状态迁移都不得顺带修改这些静态字段。

生命周期约束为：

```text
prepared:
  dispatching_at IS NULL, terminal_at IS NULL, outcome IS NULL
dispatching:
  dispatching_at IS NOT NULL, terminal_at IS NULL, outcome IS NULL
terminal:not_dispatched:
  dispatching_at IS NULL, terminal_at IS NOT NULL
terminal:其他 outcome:
  dispatching_at IS NOT NULL, terminal_at IS NOT NULL
```

#### 5. `usage_ledger_entry`

不可变 Usage 与 Customer Charge 事实，直接使用 `attempt_id` 作为 PK/FK。

| 字段 | 约束与含义 |
| --- | --- |
| `attempt_id` | PK/FK → `provider_attempt` |
| `usage_status` | `valid | missing | invalid` |
| 四项 Token | valid 时全部非空非负；missing/invalid 时全部为空 |
| `usage_error_code` | nullable |
| `pricing_revision_id` | nullable；必须与 Attempt 固定的 Revision 一致 |
| 四项 `applied_*_rate_microcredits_per_1m_tokens` | 付费 Ledger 全部非空非负；所有免费 Ledger 全部为空；禁止部分为空 |
| `customer_charge_microcredits` | 非负；missing/invalid 必须为零 |
| `settled_at` | not null |

`terminal:not_dispatched` 没有 Ledger。其他 terminal outcomes 必须与 Ledger 在同一事务中形成。付费 Ledger 复制 Revision 的四项 Rate；免费 Revision 即使保存了完整 Rate Card，也不代表这些 Rate 被应用，因此 Ledger 的 applied Rate 仍全部为空。Attempt Revision、Ledger Revision 与 Rate 快照的一致性，以及“其他 terminal 必有 Ledger”属于 Settlement 服务和测试保证的跨表事务不变量，不能只靠单表 `CHECK` 表达。零舍入保留 Ledger，但不创建 Wallet Entry。

#### 6. `wallet_entry`

不可变余额变动事实，也是 Statement 的唯一事实源。

| 字段 | 约束与含义 |
| --- | --- |
| `wallet_entry_id` | PK |
| `billing_subject_id` | not null、index |
| `entry_kind` | `usage_debit | top_up_credit` |
| `source_id` | attempt ID 或跨库 payment transaction ID |
| `delta_microcredits` | 非零有符号 BIGINT |
| `posted_at` | not null |

唯一约束：`UNIQUE(entry_kind, source_id)`。`usage_debit` 必须为负且绝对值等于 Ledger Charge；`top_up_credit` 必须为正。后二者涉及其他表时属于服务事务不变量。

重复业务键不能无条件视为成功：只有既有 Entry 的 Billing Subject、Entry Kind、Source ID 和 Delta 与本次请求全部相同，才是幂等重放；任一字段不同都必须拒绝、记录冲突并告警。

#### 7. `wallet_balance`

可重建余额投影。

| 字段 | 约束与含义 |
| --- | --- |
| `billing_subject_id` | PK |
| `balance_microcredits` | 有符号 BIGINT，可为负 |
| `updated_at` | not null |

没有行等价于余额零。充值必须用原子 UPSERT 创建或增加余额；付费 Admission 已要求存在正余额行，因此 Settlement 更新不到恰好一行时必须整笔回滚，不能临时创建余额。系统应持续校验并能够重建：

```text
wallet_balance.balance_microcredits
= SUM(wallet_entry.delta_microcredits)
```

这是可验证、可重建的不变量，不是跨行数据库 `CHECK`。

### Playground Account Database：3 张新增表

#### 1. `billing_subject`

| 字段 | 约束与含义 |
| --- | --- |
| `billing_subject_id` | PK |
| `user_code` | UNIQUE、FK → Playground Account |
| `created_at` | not null |

Account 删除与匿名化不在 v1 范围，FK 使用 `RESTRICT`，不能 cascade 删除账务身份。

#### 2. `top_up_order`

保存购买意图与下单时商品快照。

| 字段 | 约束与含义 |
| --- | --- |
| `top_up_order_id` | PK |
| `billing_subject_id` | FK → `billing_subject` |
| `idempotency_key` | 与 Billing Subject 组成唯一键 |
| `package_code`、`package_version`、`package_name` | 套餐快照 |
| `payment_amount_minor`、`currency` | 套餐价格与预期支付金额快照；实际支付事实属于 Payment Transaction |
| `credit_amount_microcredits` | 获得的 Credits |
| `created_at` | not null |

v1 不增加 Top-up Package 表，套餐由后端固定版本化配置提供；Order 保存完整快照。

为了保持最小模型，#18 v1 明确一个 Top-up Order 只对应一个 Payment Transaction，支付失败后重新创建 Order，不处理“一单多次支付、至多一次成功”的并发约束。这是 fake/dev 阶段的简化，不宣称是所有真实支付渠道的通用模型；#22 接入具体渠道时，如果确有同一 Order 多次支付尝试的需求，必须先升级基数和“至多一个成功交易”的约束。

#### 3. `payment_transaction`

Payment History 的事实源，同时承载 Credit Fulfillment 标记。

| 字段 | 约束与含义 |
| --- | --- |
| `payment_transaction_id` | PK、全局唯一 |
| `top_up_order_id` | UNIQUE、FK → `top_up_order` |
| `channel`、`channel_transaction_id` | 支付渠道及其交易身份 |
| `status` | `pending | succeeded | failed` |
| `payment_amount_minor`、`currency` | 必须与 Order 快照一致 |
| `failure_code` | nullable |
| `created_at`、`updated_at`、`succeeded_at` | 生命周期时间 |
| `credited_at` | Runtime Wallet 已确认入账的时间 |

```text
status = succeeded AND credited_at IS NULL
```

就是 Credit Pending，不需要独立 Outbox 表。

唯一约束还包括 `UNIQUE(channel, channel_transaction_id)`。状态只允许 `pending → succeeded | failed`：`succeeded_at` 仅在 `succeeded` 时非空，`credited_at` 非空必然意味着 `status = succeeded`，并且 `credited_at` 只能通过 `NULL → timestamp` 的 CAS 设置。

支付终态同样必须使用 `WHERE status = 'pending'` 的状态 CAS。更新零行后重读：相同渠道交易、相同内容和相同终态的重复通知视为幂等成功；已经是相反终态，或任何金额、币种、Order、Subject 不同，都必须冲突并告警，不能用后写覆盖先写。

重复支付通知只有在渠道交易身份、Order、Billing Subject、金额、币种和结果全部一致时才是幂等成功；相同渠道交易身份携带不同内容必须冲突并告警。Payment 金额、币种与 Order 快照的一致性由 Payment 服务事务和测试保证。

### 哪些对象不建表

- Model Call：通过 `call_id` 聚合 Attempts；
- Statement：从 Wallet Entries 派生；
- Payment History：从 Payment Transactions 派生；
- Usage 查询中的 Workload Charge：从 Attempt/Ledger 聚合；Statement 中的 Workload Charge：只聚合本周期按 `posted_at` 实际入账的 Wallet Debits；
- Top-up Package：后端固定版本化配置，Order 保存快照；
- Admission Rejection：调用结果、Run 错误与遥测；
- Budget、Reservation、Reconciliation：明确排除；
- Provider Cost：由其他系统按不可变 Usage Ledger 自行计算。

## 十二、Workload、Billing Subject 与隐私

Playground Billing Subject 与登录 Account 一一对应。

创建根 Workload 时：

1. 从服务端认证上下文解析 Account；
2. 查找稳定 Billing Subject；
3. 固化 `workload_id → billing_subject_id`；
4. 所有因果后代继承同一 Workload。

客户端、Agent、Tool 和 Plugin 不能指定或覆盖付款人。

Playground 未登录用户不能启动根 Workload，即使使用免费模型也不例外；v1 不提供 System Billing Subject。CLI、直接 Core client 和其他宿主不继承 Playground 认证规则，不收费宿主的 Workload 可以没有 Billing Subject。

必须覆盖的传播路径包括：

- Chat、steer 和 follow-up；
- `task_start`；
- Workflow；
- SubAgent；
- Tool；
- background continuation；
- compaction；
- retry/fallback；
- crash recovery 和重放。

`task_create` 只创建 pending Task，不产生付费 Workload；真正执行的 `task_start` 才由实际启动者形成 Workload。

### 查询权限

- 普通 Account：只能查看自己的 Wallet、Statement 和调用明细；
- Agency owner/admin：查看当前 Agency 聚合 Usage/Credits，不能下钻其他 Account Wallet；
- Platform Admin：查看全局 Usage、Settlement、Pricing 和无内容诊断；
- 所有接口：不返回 prompt、response、Tool payload、API Key 或无权限的 Provider 错误正文。

### Viewer-aware Billing 错误

![共享 Session 中的 Billing 错误投影](/diagrams/provider-attempt-credit-accounting/08-viewer-aware-error.svg)

共享 Session 中不能把付款人的财务状态广播给所有成员。

当 Run 因 `insufficient_credits` 失败：

- 实际付款 Account 看到“积分不足”和充值动作；
- 其他 Session 成员只看到“本次运行未能继续”；
- 其他成员看不到余额、充值入口或具体 Billing 原因；
- realtime `run_upsert`、重连恢复与历史查询使用同一 projector。

Core 只承载机器可读 `error_code`；中文文案、余额和充值动作属于 Playground 投影。

同步等待准入的接口可以直接返回 HTTP `402`。异步 Chat 的 `202` 或 WebSocket ACK 只表示命令/Run 已接受；后续准入失败时，Run 进入错误终态。该错误立即终止本次 Model Call，不进入 retry/fallback。充值后不自动重放此前失败的 Run，用户需要主动重新发起。

## 十三、充值、Statement 与 Payment History

Statement 是预付费 Credits 流水，不是后付费 Invoice。

### Statement

Statement 只由 Wallet Entries 派生：

- 充值 Credit 形成充值条目；
- 模型消费 Debit 形成消费条目；
- 周期按 `wallet_entry.posted_at` 归属；
- 默认按 Workload 聚合；
- 可以展开到 Model Call 和 Provider Attempt；
- 免费、零舍入、Missing/Invalid Write-off 和 incomplete Attempt 不生成虚假消费条目。

月底开始、次月完成 Settlement 的调用进入次月 Statement，因为 Statement 反映实际入账时间。

### Payment History

Payment History 只由 Payment Transactions 派生。它可以为 Statement 的充值条目补充支付金额、币种、渠道、套餐和收据状态，但 Payment Transaction 本身不能直接改变 Credits 余额。

### 渠道无关充值交付

![充值支付与 Credits 交付](/diagrams/provider-attempt-credit-accounting/07-top-up-fulfillment.svg)

流程为：

```text
Top-up Order
  → Payment Transaction succeeded, credited_at = NULL
  → Fulfillment Worker
  → Runtime top_up_credit Wallet Entry
  → Account DB CAS credited_at = now
```

Runtime 使用 `(top_up_credit, payment_transaction_id)` 作为唯一业务键。如果 Wallet 已入账但 Account Database 回写前崩溃，后台会再次投递；Runtime 只有在 Billing Subject 和 Credit 数量也完全一致时才幂等返回，不会重复增加 Credits。相同 Payment ID 携带不同 Subject 或数量必须冲突并告警。

固定 Top-up Packages 保存版本与订单快照，Purchased Credits 永不过期。v1 不实现退款和 Chargeback。

#18 中的 deterministic fake payment 只允许自动化测试或显式开发环境。真实 checkout、Webhook 验签、商户配置和 Sandbox/生产验证由 #22 实现。

在 #22 完成前：

- 生产充值入口显示“暂未开放”；
- 不发布伪支付成功接口；
- 当前方案没有管理员 Grant Entry；
- 因而不能提前在生产启用付费 LLM Configuration，否则用户没有合法 Credits 来源。

## 十四、崩溃窗口、结果交付与幂等

![崩溃窗口与可恢复语义](/diagrams/provider-attempt-credit-accounting/06-crash-and-incomplete.svg)

最低唯一约束包括：

```text
provider_attempt(call_id, attempt_no)
usage_ledger_entry.attempt_id
wallet_entry(entry_kind, source_id)
wallet_balance.billing_subject_id
workload_attribution.workload_id
credit_pricing_current(agency_code, llm_code)
credit_pricing_revision(agency_code, llm_code, pricing_revision_id)
payment_transaction(channel, channel_transaction_id)
```

重复 Settlement：

- 内容相同：返回已有结果，视为幂等成功；
- 内容不同：拒绝覆盖，记录幂等冲突并告警。

这里的“内容相同”包含收费主体、Source、Token/Usage、Revision、Rate 快照、Charge 或 Top-up Delta 等所有会影响账务结果的字段，不是只比较幂等键。

### 崩溃窗口

| 崩溃位置 | 可观察状态 | 处理 |
| --- | --- | --- |
| `prepared` 提交前 | 无 Attempt、无 dispatch | 不收费 |
| `prepared` 后、dispatch CAS 前 | 清理 CAS 仍可能安全抢占 | CAS 成功才写 `terminal:not_dispatched`；CAS 为零则重读，绝不假定未发送 |
| `dispatching` 提交后、网络发送前后 | 是否到达 Provider 未知 | 保持 `dispatching`，派生 incomplete，不重发、不收费 |
| Provider 返回后、Settlement 前 | Usage 可能随进程丢失 | 保持 incomplete，不补扣、不 Reconcile |
| Settlement 重试期间 | 同一 attempt/result | 依靠唯一约束幂等完成 |
| Top-up 入 Wallet 后、`credited_at` 前 | Payment 已 succeeded，但 Credit Fulfillment pending | 重投；内容完全相同时 Runtime 幂等返回 |

### Dispatch 后 accounting 失败

Provider 已经收到请求后发生 accounting 故障时：

- 当前进程内幂等重试 Settlement；
- 不能触发新的 Provider retry/fallback；
- 非流式结果在 Settlement commit 后才交给 Agent；
- Streaming 已输出内容不能撤回；
- Streaming 最终失败时以 `accounting_unavailable_after_dispatch` 结束连接；
- 如果进程直接崩溃，Attempt 保持 incomplete、零收费。

还有一个不能夸大的边界：如果 Runtime Database 整体不可用，而 Run 状态也存在同一数据库，那么 `Run.error_code` 只能 best-effort 返回给客户端或写入日志，不能承诺一定持久化。

## 十五、事实源与派生查询

| 模型 | 分类 |
| --- | --- |
| `workload_attribution` | 不可变归属事实 |
| `credit_pricing_revision` | 不可变政策事实 |
| `credit_pricing_current` | 可重建当前指针 |
| `provider_attempt` | 可状态迁移的权威生命周期记录 |
| `usage_ledger_entry` | 不可变 Usage/Charge 事实 |
| `wallet_entry` | 不可变余额事实、Statement 事实源 |
| `wallet_balance` | 可重建余额投影 |
| `billing_subject` | 不可变身份映射 |
| `top_up_order` | 不可变购买意图与商品快照 |
| `payment_transaction` | 权威支付/交付生命周期、Payment History 事实源 |

Model Call Charge、Usage 视角的 Workload Charge、Statement、Payment History、Agency 聚合、Account 余额视图和 incomplete Attempt 列表都是派生查询，不是新的事实表。前两者可以聚合 Usage Ledger；Statement 的周期和金额只认 Wallet Entry 的 `posted_at` 与实际 Debit，不能由 Ledger 直接决定。

派生查询的原则是：事实源可以重建投影，投影不能反向修改事实源。例如 Wallet Balance 损坏时从 Wallet Entries 重建，而不是把 Balance 当作最终账本。

## 十六、从旧指标到新 Ledger 的 Cutover

### 阶段 1：先建新表，不改变收费行为

- Runtime Database 注册 7 张表；
- Account Database 注册 3 张表；
- 为既有 Account 幂等创建 Billing Subject；
- 所有既有 LLM Configuration 仍默认免费。

### 阶段 2：先完整捕获 Attempt

- 引入 Core lifecycle 协议；
- 显式区分 Usage 状态；
- 关闭隐藏 retry/fallback；
- 覆盖 direct、router、Streaming、cancel 和 error 路径。

在“每次真实 dispatch 恰好一个 Attempt”被测试证明之前，不开放付费开关。

### 阶段 3：新 Ledger 与旧 metric 并行

- 旧 `LLMCallMetric` 和当前 `AccountingService` 继续提供历史 Token 查询；
- 新 Ledger 从明确 cutover 时间开始写入；
- 不迁移旧 metric；
- 不构造历史 Wallet Debit；
- 不追溯扣款；
- 查询必须标明数据来源。

### 阶段 4：最后开放 opt-in Billing

收费默认关闭。只有双重权限管理员显式创建收费 Revision 后，新的 Attempts 才开始检查 Wallet 和结算 Credits。

生产环境还必须等待 #22 提供合法 Credits 来源。默认免费保证升级后 Playground、CLI 和嵌入式 PlatformRuntime 不会突然停止工作。

## 十七、实施分层

### Core contracts

- `UsageReport(valid|missing|invalid)`；
- Workload/Model Call/Attempt identity；
- `ProviderAttemptLifecycle`；
- 显式 retry/fallback 编排；
- 通用错误码传播。

验证：Core 不导入 Platform；未注入 lifecycle 的 standalone client 保持兼容；每次真实 dispatch 恰好一个 Attempt。

### Platform accounting kernel

- Runtime 7 表；
- Pricing revision/current；
- Admission；
- Attempt 状态机；
- Usage Ledger；
- Wallet；
- Atomic Settlement。

验证：事务回滚、重复 finish、多 worker 竞争、Balance 重建和 dispatch 前 fail-closed。

### Workload attribution

贯穿 `AgentRunRequest/Context/State`、Tool context、SubAgent、Workflow、background、compaction、task start 和恢复/重放。

验证：所有后代继承同一 Billing Subject；另一 Account 的新根执行形成新 Workload。

### Playground Billing backend

- Billing Subject；
- 现有 LLM 配置页中的 Credit Billing 子资源；
- 双重权限；
- Wallet/Statement/Payment History；
- viewer-aware Run projection；
- Top-up Order、Payment Transaction；
- 仅测试/开发 fake fulfillment；
- 旧 Account 幂等 backfill。

### Playground frontend

- 现有 LLM 配置页增加收费开关与四项 Rate；
- placeholder 提示推荐值，不默认填入；
- 个人信息展示 Credits；
- Statement 与 Payment History；
- 用户发起付费调用时展示 `insufficient_credits`；
- 共享 Session 其他成员展示通用错误；
- #22 完成前显示充值暂未开放。

不增加持续余额 Banner，不展示 LiteLLM USD Provider Price。

### 生产支付渠道

由 #22 选择一个真实 Provider，交付 checkout、Webhook 验签、支付幂等、商户配置和 Sandbox/生产验证。它依赖 #18 已稳定的 Payment Transaction 与 Credit Fulfillment 契约。

## 十八、测试矩阵

普通测试使用 deterministic fakes，不调用真实 LLM 或支付渠道。

| 维度 | 场景 | 预期 |
| --- | --- | --- |
| Usage | 合法四分区 | valid Ledger |
| Usage | 合法全零 | Ledger 存在，无 Debit |
| Usage | 缺少报告 | missing，零收费 |
| Usage | 非法值/无法映射 | invalid，零收费 |
| Usage | output 含 reasoning | reasoning 不重复相加 |
| Streaming | 多份累计 Usage | 只用最后一份有效值 |
| Streaming | 部分输出后 cancel 且已有 Usage | 按有效 Usage 结算 |
| Retry | 第一次失败有 Usage、第二次成功 | 两个 Attempts，分别结算 |
| Retry | 前一次无 Usage | 前一次 Write-off，后一次正常 |
| Router | primary/fallback | 每次 dispatch 独立 Attempt |
| Admission | paid 且 balance > 0 | 允许 |
| Admission | balance <= 0 | dispatch 前拒绝 |
| Admission | insufficient_credits 且配置了 retry/fallback | 立即终止 Model Call，不 dispatch 任何 candidate |
| Admission | free 且余额为负 | 允许，不收费 |
| Admission | paid 缺 Billing Subject | 拒绝 |
| Admission | paid 缺任一 Rate | 拒绝 |
| Accounting | current Pricing 查询失败 | fail-closed，不能解释为免费 |
| Pricing | 保存新费率 | 创建新 Revision，不改历史 |
| Pricing | 调用中修改费率 | 已准入 Attempt 使用旧 Revision |
| Pricing | 免费 Revision | Rate 四项全空或完整均合法；部分为空拒绝 |
| Pricing | 显式免费 Revision 带完整 Rate Card | Ledger 保留 Revision，但 applied Rates 全空、Charge 为零 |
| Pricing | 普通连接配置 PUT | 不得隐式修改当前 Pricing Revision |
| Credits | 四分区计算 | Attempt 总额只 round 一次 |
| Credits | 显式 Rate 0 | 合法 |
| Credits | 超过六位小数 | 拒绝保存 |
| Wallet | 单次费用超过余额 | 允许结算为负 |
| Wallet | 并发 Attempts | 可形成 Settlement Overage |
| Wallet | 负余额后的新 paid Attempt | 拒绝 |
| Settlement | 相同 finish 重放 | 恰好一个 Ledger/Debit |
| Settlement | 不同 payload 重放 | 幂等冲突并告警 |
| Settlement | 两个终态并发 CAS | 只允许一个成功；另一方相同 payload 幂等、不同 payload 冲突 |
| Crash | prepared 后、CAS 前 | `not_dispatched`，无 Ledger |
| Crash | dispatch CAS 与 not_dispatched CAS 竞争 | 只允许一个成功；失败方重读且不得误发/误判 |
| Crash | dispatching 后 | incomplete，不重发、不收费 |
| Accounting | Provider 返回后 DB 暂时失败 | 只重试 Settlement |
| Workload | Tool/SubAgent/Workflow | 继承同一 Billing Subject |
| Workload | 另一 Account 在同 Session 发起 | 新 Workload、新付款人 |
| Privacy | 付款人查看 | 显示积分不足与充值动作 |
| Privacy | 其他共享成员查看 | 只显示通用错误 |
| Statement | 跨月 Settlement | 按 `posted_at` 归期 |
| Statement | zero/write-off/incomplete | 不生成消费条目 |
| Top-up | 同一 Payment 重复交付 | Credits 恰好入账一次 |
| Top-up | 同一渠道支付成功通知重复到达 | 只形成一个 Payment Transaction |
| Top-up | 相同支付身份但金额/主体不同 | 幂等冲突，不入账 |
| Top-up | succeeded/failed 通知并发竞争 | 只允许首个终态；相反终态冲突、禁止覆盖 |
| Top-up | Wallet 入账后回写崩溃 | 重投不重复充值 |
| Cutover | 旧 metric | 不迁移、不追溯扣款 |
| Compatibility | standalone Core client | 无 lifecycle 时保持原行为 |

完成 focused tests 后，还应运行完整 Python 测试、Playground backend 测试、frontend typecheck/build、静态导出构建和 compileall。

## 十九、这套设计接受的权衡

### 不使用 Reservation

模型和事务更简单，不需要预估最大输出、冻结、释放和 stale reservation；代价是单次高额或并发调用可以产生负余额。

### Missing/Invalid 永久不补扣

用户只为 Cube 能证明的 Usage 付费；代价是 Provider 已产生成本但没有可信 Usage 时，平台承担损失。

### `dispatching` 崩溃后保持 incomplete

不与迟到结果竞争，不自动重发可能已经执行的请求；代价是长期保留 incomplete records，并放弃相应收入。

### Platform accounting fail-closed

无法形成账务事实时不继续 dispatch；代价是 Runtime Database 故障会影响 Platform 路径中的免费配置。

### 永久 `llm_code` Billing 身份

Pricing 不会因删除重建丢失；代价是 code 不能被当作删除后完全重置的临时名称。

### 7 + 3 最小模型

事实源清晰，没有为 Statement、Model Call 或 Outbox 增加表；代价是 `wallet_balance` 和 `credit_pricing_current` 是需要校验、可重建的投影。未来支付出现多个下游时，可能再拆出通用 Outbox。

### 默认免费

兼容所有既有部署；代价是它不是平台级强制收费机制，新 code 仍可获得默认免费状态。

### 延后真实支付

#18 可以先把 Attempt、Usage、Wallet 和充值交付契约做正确；代价是 #22 完成前不能在生产开启付费配置。

## 结语

Issue #18 的核心不是给现有 Token metric 增加一个 `cost` 字段，而是重新确定账务事实边界：

```text
真实 Provider dispatch
  → Provider Attempt
  → Canonical Usage
  → Credit Pricing Revision
  → Customer Charge
  → Wallet Entry
```

Model Call、Workload、Statement 和 Payment History 都是围绕这些事实形成的聚合或投影。

最终方案遵循几条克制原则：

- 不知道 Usage，就不向用户收费；
- 每次真实 Provider 请求必须可见；
- 账务事实只能追加，不能覆盖；
- Wallet 控制新调用，但不承诺绝不透支；
- 身份和支付留在 Playground，运行账务留在 Platform；
- Core 只提供平台无关生命周期协议；
- 不为尚未需要的 Budget、Reservation、Provider Cost 和真实支付渠道提前增加复杂度。

这套设计牺牲了极端情况下的收入回收和严格额度控制，换取更清晰的事实源、更小的持久化模型，以及在 retry、Streaming、并发和崩溃场景下仍然可以解释的账务结果。
