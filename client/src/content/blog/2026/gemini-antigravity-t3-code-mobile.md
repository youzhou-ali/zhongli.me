---
title: Gemini、Antigravity 与 T3 Code：把 AI 编程带到手机上
slug: gemini-antigravity-t3-code-mobile
date: 2026.11.25
category: AI 编程
summary: 整理 Antigravity CLI 的使用、T3 Code 的接入与日常操作，以及手机通过 T3 Connect 或现有 FRP + HTTPS 连接家中开发环境的方法。
---

11 月 24 日，我围绕 [Leaf 的这篇文章](https://x.com/leaf_sanren/status/2124489957679280384) 讨论了 Gemini 的使用方式。今天又继续研究 T3 Code 的远端 Connect：我已经在用 T3 桌面客户端，也有现成的 FRPC，想在外出时用手机查看进度、补充要求、处理审批，让家里的 Mac mini 继续执行任务。

这篇把两次讨论合成一份操作笔记。手机远程部分记录的是按官方文档核对过的方案与配置示例，尚未完成我的设备上的全流程验收。

**核对基准：2026 年 11 月 25 日，T3 Code 稳定版 [v0.1.11](https://github.com/pingdotgg/t3code/releases/tag/v0.1.11)，发布于 11 月 20 日。** 下文的 T3 文档链接固定在该版本；Google 的模型与额度以账号当前显示为准。

## 1. 先分清三个入口

我准备按下面的分工使用它们：

| 入口 | 主要用途 | 工作发生在哪里 |
| --- | --- | --- |
| Gemini 网页或 App | 对话、查资料、分析上传的材料 | 对应产品提供的环境 |
| Antigravity CLI，命令为 `agy` | 面向本地项目读写文件、执行命令、调用工具 | 启动 CLI 的电脑 |
| T3 Code | 在统一界面里管理项目、线程、Provider、审批和代码变更 | Agent 在所连接的主机上运行，桌面和手机负责交互 |

这里的 **`agy` 是 Antigravity CLI**。T3 的 Antigravity 接入使用 Google 提供的 ACP agent；ACP 是客户端与 Agent 交换请求、工具活动和审批等信息的协议。T3 自己不提供模型额度，模型权限仍由对应 Provider 和账号决定。

参考：[Antigravity ACP](https://antigravity.google/docs/cli/acp/) · [T3 Code 项目介绍](https://github.com/pingdotgg/t3code/blob/v0.1.11/README.md) · [T3 架构说明](https://github.com/pingdotgg/t3code/blob/v0.1.11/docs/internals/overview.md)。

## 2. 先用 Antigravity CLI 跑一个小任务

### 安装、登录与进入项目

按 [Google 官方安装说明](https://antigravity.google/docs/getting-started?tab=cli)，macOS / Linux 可以在终端执行：

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy --version

cd /path/to/your/project
agy
```

`/path/to/your/project` 替换为真实项目路径。首次启动按界面完成目录信任和 Google 登录。CLI 默认安装在 `~/.local/bin/agy`；安装后找不到命令时，按安装器提示处理 PATH，再打开新终端。

第一个任务可以足够小：

```text
先阅读这个项目，说明入口文件、启动方式和验证命令。
列出还不确定的地方，暂时不要修改文件。
```

### 常用操作与额度

| 命令 | 用途 |
| --- | --- |
| `/model` | 查看、选择当前账号可用的模型 |
| `/effort` | 调整当前模型支持的思考强度 |
| `/usage` | 查看额度与重置时间 |
| `/plan` | 先制定计划 |
| `/compact` | 压缩长对话上下文 |

需要直接运行一次任务并退出时，可以在完成交互登录后使用：

```bash
agy -p "说明这个项目的入口文件和启动步骤"
```

原帖中的模型套餐与额度划分已有变化。我把操作习惯定为：**选模型看 `/model`，看余量用 `/usage`，在 T3 中查看 Usage → Limits。** 不把某个模型永远属于某档会员、额度永远分成固定几池写成长期规则。

`agy -p` 的用途还要和接入方式一起看：[Google FAQ](https://antigravity.google/docs/faq) 将直接脚本、CI 与把消费计划包装进其他 Coding Agent 区分开，并限制后者及自动轮换账号。这里采用 T3 文档中的内置 Antigravity Provider 接入路径。

参考：[CLI 命令](https://antigravity.google/docs/cli/reference) · [Headless 模式](https://antigravity.google/docs/cli/headless) · [模型说明](https://antigravity.google/docs/models) · [额度查询](https://antigravity.google/docs/cli/commands/usage)。

### 把自己的规则带进去

Antigravity 支持项目中的 `AGENTS.md` 或 `GEMINI.md`。我刚整理的 [四条 AI 编码规则](/posts/my-agents-md) 可以作为基础，再补项目的构建命令、测试方式和目录约定。重复使用的工作流再整理成 Skill。

参考：[Rules](https://antigravity.google/docs/rules) · [Skills](https://antigravity.google/docs/skills)。

## 3. 在 T3 Code 里管理日常开发

### 桌面端与命令行入口

T3 可以从 [官方下载页](https://t3.codes/download) 安装；Mac 也可以使用：

```bash
brew install --cask t3-code
```

桌面应用自带服务器和 `t3` 命令。终端找不到 `t3` 时，在 **Settings → About → t3 command → Install** 安装，再打开新终端；需要时按界面提示 **Add to PATH**。已有其他来源的 `t3` 不会被自动覆盖，应确认它与桌面版本匹配。

桌面应用已经运行时，可以从项目目录打开一个新线程：

```bash
cd /path/to/your/project
t3 app
```

也可以把项目文件夹拖到桌面侧栏。`t3 app` 是把当前目录交给已运行的桌面应用，不是远程服务器的启动命令。

参考：[安装与命令行说明](https://github.com/pingdotgg/t3code/blob/v0.1.11/docs/user/install.md)。

### 接入 Antigravity

1. 打开 **Settings → Providers**，先选实际运行项目的 Environment，例如家里的 Mac mini。
2. 启用 **Antigravity**，在该环境中安装 runtime。
3. 点击 **Sign in**，完成 Google 登录。
4. Google 完成页显示临时代码后，把代码或完成页完整地址贴回发起登录的 T3 客户端。
5. 等 T3 确认账号权限、加载模型，再创建线程。

**T3 管理自己的 Antigravity 安装和登录，与终端或 IDE 的登录分开。** 终端里 `agy` 可用，不代表 T3 已登录。Provider 设置也属于选中的运行环境；手机连到 Mac 后，使用的是 Mac 上的 Provider。

v0.1.11 文档要求 Antigravity 1.5 及以上，推荐 1.5.12 及以上，优先使用设置中的更新入口。runtime 已装好后，也可以从手机端完成 Provider 登录。这里采用的是当前版本的代码粘贴流程。

参考：[v0.1.11 Antigravity 接入说明](https://github.com/pingdotgg/t3code/blob/v0.1.11/docs/user/providers-antigravity.md)。

### 一个任务、一条线程、一次检查

我的使用顺序准备固定为：选择环境和项目，创建线程，选择 Provider、模型与权限模式，写清任务和验收标准；完成后看工具输出与 diff，再处理提交或 PR。需要同时改不同功能时，再用独立 worktree 隔离。

T3 支持在同一线程内切换 Provider。短对话可以转交可见会话历史；长对话会受上下文预算限制，优先保留相关内容，上一 Agent 的内部推理、工具运行状态和附件不会完整迁移。因此关键约束适合在交接后的消息中再明确一次。

参考：[线程管理](https://github.com/pingdotgg/t3code/blob/v0.1.11/docs/user/thread-sidebar.md) · [Provider 上下文交接](https://github.com/pingdotgg/t3code/blob/v0.1.11/docs/user/portable-handoffs.md)。

## 4. 手机远程：先连接同一个 T3 环境

这里最关键的是“同一个环境”：项目目录、Git、Agent 进程与线程数据留在 Mac mini 上，手机用来查看、发消息和处理审批。

我有两条可选连接路线：

| 路线 | 手机怎么连接 | 需要准备什么 |
| --- | --- | --- |
| 官方 T3 Connect | T3 手机 App 或 `app.t3.codes`，登录同一个 T3 Connect 账号 | 在主机启用 Connect，并保持主机运行 |
| 自有 FRP + HTTPS | 使用自己的 HTTPS 地址，为同一环境添加 route | 现有 FRPC/FRPS、域名、HTTPS 反向代理与一次性配对码 |

### 官方 Connect 的操作顺序

1. 在 Mac 上保持 T3 桌面应用及本地环境运行。
2. 打开 **Settings → Sharing & access**，登录并为该环境启用 **T3 Connect**。
3. 在手机安装官方 T3 Code App，或打开 [app.t3.codes](https://app.t3.codes)。
4. 登录同一个 T3 Connect 账号，选择这台 Mac 的环境。
5. 若开启了 **Require approval for new devices**，在已连接设备上核对并批准手机显示的代码。

T3 Connect 账号用于连接设备；Google 登录用于 Antigravity 的模型权限。这两次登录分别解决不同问题。

**主机要保持运行与唤醒。** v0.1.11 文档明确说明，关闭桌面应用最后一个窗口会停止其本地服务器；保存过登录信息并不会自动让主机继续提供服务。长期需要后台运行时，再按 [后台服务文档](https://github.com/pingdotgg/t3code/blob/v0.1.11/docs/user/background-service.md) 配置 `t3 up`。

参考：[官方远程访问说明](https://github.com/pingdotgg/t3code/blob/v0.1.11/docs/user/remote-access.md)。

## 5. 复用现有 FRPC：给同一环境增加 HTTPS 路线

我目前更想验证这一条，因为已经有 FRP 基础设施。方案中的请求路径是：**手机 → VPS 上的 HTTPS 反向代理 → FRPS / FRPC 隧道 → Mac 上现有的 T3 服务。**

下面采用明确的部署假设：**frpc 与 T3 在同一台 Mac，Caddy 与 frps 在同一台 VPS。** 域名与端口均为示例。如果 frpc 实际跑在 NAS 或软路由上，需要改用 Mac 的局域网地址，并在 T3 开启 Network access；这时 `127.0.0.1` 指向的是 frpc 自己所在的设备。

### 第一步：查清当前环境与端口

在运行 T3 的 Mac 上执行：

```bash
t3 pair
```

输出包含环境名称、实际 HTTP 地址、`Token` 和过期时间。先确认名称是桌面正在使用的环境，再记录真实端口。**不要默认桌面一定监听 3773。**

如果命令指向了别的实例，再用 `--base-dir` 指定现有实例实际使用的 T3 home。这个参数指 T3 的数据根目录，通常是 `~/.t3`，不是项目目录，也不是其中的 `userdata` 子目录。

这里的配对码默认五分钟有效；可以先完成网络配置，最后再运行一次 `t3 pair` 取得新码。相关行为可在 [v0.1.11 的配对命令源码](https://github.com/pingdotgg/t3code/blob/v0.1.11/apps/server/src/cli/pair.ts) 和 [CLI 配置定义](https://github.com/pingdotgg/t3code/blob/v0.1.11/apps/server/src/cli/config.ts) 中核对。

### 第二步：在现有 frpc 配置中增加代理

保留已有的服务端地址、认证和其他代理配置，只追加这一段：

```toml
[[proxies]]
name = "t3-code"
type = "tcp"
localIP = "127.0.0.1"
localPort = 3773 # 示例：替换为刚确认的实际 T3 端口
remotePort = 13773 # 示例：选择 VPS 上未占用的端口
```

按现有 FRP 的运行方式加载配置。同机 frpc 可以直接访问 T3 的 loopback 地址，这个部署方式下无需额外开启 T3 的 Network access。

手机到 VPS 的 HTTPS 与 frpc 到 frps 的加密是两段连接，现有 FRP 配置也应确认启用了 TLS。

参考：[FRP TCP 代理示例](https://gofrp.org/en/docs/examples/ssh/) · [FRP 通信加密](https://gofrp.org/en/docs/features/common/network/network/)。

### 第三步：在 VPS 上加 HTTPS 反向代理

将自己的域名指向 VPS；使用 Caddy 的默认自动 HTTPS 时，让 Caddy 能接收 80/443 端口的流量，完成证书签发、HTTP 跳转和 HTTPS 访问。下面的 `t3.example.com` 必须替换为真实域名：

```caddyfile
t3.example.com {
    reverse_proxy 127.0.0.1:13773
}
```

该配置转发整个 T3 服务，并支持 WebSocket。Caddy 默认保留外部 Host、设置 `X-Forwarded-Proto`；如果改用已有的 Nginx，也要保留这些信息并正确处理 WebSocket 升级。

**13773 只供反向代理访问，对公网关闭该映射端口。** 使用现有共享 frps 时，应对这个端口单独设置防火墙或安全组规则；直接修改 frps 全局的 `proxyBindAddr` 会连带影响已有 SSH 等映射。

参考：[Caddy 反向代理](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) · [Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https) · [FRPS 服务端配置](https://gofrp.org/zh-cn/docs/reference/server-configures/) · [T3 请求地址识别](https://github.com/pingdotgg/t3code/blob/v0.1.11/apps/server/src/requestUrl.ts)。

### 第四步：从手机添加地址并配对

网络准备好后，在 Mac 再执行一次 `t3 pair`，使用新生成的 `Token`。

| 当前情况 | 操作 |
| --- | --- |
| 手机尚未添加这台机器 | 在 Add environment 中填自己的 HTTPS 地址与一次性配对码 |
| 已经通过 Connect 添加过这台机器 | 给原环境 Add route，增加 HTTPS 地址 |
| 在网页或桌面管理路线 | Settings → Environments → 机器下的 route 数量 → Add route |
| 在原生手机 App 管理路线 | Settings → Environments → 该机器 → Edit |

将自有 HTTPS route 调到优先位置，官方 Connect 可以保留为另一条路线。两条路线各自完成认证，最终进入同一个环境。

也可以在手机浏览器打开这样的配对地址：

```text
https://t3.example.com/pair#token=<新生成的一次性配对码>
```

保留 `/pair#token=` 结构，只替换地址和令牌；不要把令牌改放到查询参数中。配对码用完后，后续连接使用设备会话，无需重复使用旧码。

两个容易混淆的地方需要记住：手机上的 `127.0.0.1` 指手机自己，因此不能直接扫描指向 Mac loopback 的二维码；`app.t3.codes` 是客户端页面，它直接连接目标服务，仍然需要一个手机可达的 HTTPS 后端。

参考：[T3 routes 与手机配对](https://github.com/pingdotgg/t3code/blob/v0.1.11/docs/user/remote-access.md#reach-one-machine-several-ways) · [远程连接机制](https://github.com/pingdotgg/t3code/blob/v0.1.11/docs/internals/remote.md) · [配对 URL 实现](https://github.com/pingdotgg/t3code/blob/v0.1.11/apps/server/src/startupAccess.ts)。

## 6. 把三类问题分开排查

### 手机连不上 T3

先查主机是否休眠或退出、T3 当前端口是否变化、FRP 是否在线、HTTPS 证书与 WebSocket 转发是否正常，以及手机正在使用哪条 route。桌面重启后端口有变化时，要更新 FRPC 对应配置。

### T3 连上了，但 Antigravity 返回地区错误

我遇到过这个报错：

```text
HTTP 400
User location is not supported for the API use.
```

当时还没有确认根因，也没有经过验证的修复结论。[Google FAQ](https://antigravity.google/docs/faq) 要求账号关联地区符合服务开放范围，并说明了年龄和账号类型等资格条件；关联地区有误时，应按官方途径更正。

按这套部署结构，Provider 请求由 Mac 发出，所以排查时还要看运行 Provider 的主机与进程，而不能只根据手机浏览器能否打开网页判断。FRP 改变的是手机访问 T3 的路线，不会改变模型账号资格。

### 导入的 Codex 会话不继续更新

另一个已经遇到的问题是：把 Codex 会话导入 T3 后，继续在原生 Codex 中聊天，T3 没有显示新增消息。[讨论 #28681](https://github.com/pingdotgg/t3code/discussions/28681) 有相似反馈。

[v0.1.11 的导入说明](https://github.com/pingdotgg/t3code/blob/v0.1.11/docs/user/welcome-page.md) 写明，导入是尽力恢复可见历史，已导入的会话不会再次导入。因此，这个功能应当按历史导入使用，不能当成两边持续同步的保证。

我这次要实现的是从手机回到同一个 T3 环境，继续操作 T3 内部的线程。网络连通与外部 Codex 历史的增量同步需要分别解决。

## 7. 下一次实际验证什么

等手机线路部署好后，用一个小任务逐项验收：

- [ ] 手机关闭 Wi-Fi，改用蜂窝网络，仍能连接家里的 Mac。
- [ ] 能看到桌面已有的项目和线程。
- [ ] 在测试项目发一条请求，手机和桌面都能看到过程与结果。
- [ ] 能查看 diff，回答 Agent 的问题并处理需要批准的操作。
- [ ] 手机离开页面再回来，能够重新连接，并确认当前使用的 route。
- [ ] 主机重启后，T3 与 FRPC 能恢复，转发端口仍对应当前实例。

先把这个完整流程验证好：**电脑上开始任务，手机上查看和继续，最后回到电脑检查改动。** 后续再按实际使用情况补充稳定性和操作体验。
