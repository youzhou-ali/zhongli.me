---
title: 周末计划：构建个人 LLM Wiki，打通 Obsidian 多端同步
slug: weekend-plan-llm-wiki-obsidian-livesync
date: 2026.10.29
category: 计划
summary: 这个周末准备做两件事：让 Codex 从对话和项目中提炼 source，由 LLM Wiki 构建个人知识库，再用 NAS 上的 CouchDB 打通 Obsidian 电脑与手机的同步。
---

这个周末（10 月 31 日—11 月 1 日），准备整理一下自己的知识管理工具。先把要做的事记下来，完成之后再补实际过程和踩坑记录。

## 第一件事：构建个人 LLM Wiki

准备使用 [nashsu/llm_wiki](https://github.com/nashsu/llm_wiki/blob/main/README_CN.md)。它可以让 LLM 从原始资料中构建并持续维护结构化 Wiki，也支持用 Obsidian 打开 Wiki 目录。

我想先把本机 Codex 里积累的知识整理出来，让过去的讨论、方案和经验变成以后能检索、能继续更新的个人知识库。

### 安装客户端和 Skill

1. 安装并启动 LLM Wiki 客户端，创建个人知识库项目。
2. 安装配套的 [llm_wiki_skill](https://github.com/nashsu/llm_wiki_skill)，接入 Codex。
3. 按项目文档配置本地 API 和访问 Token，确认 Codex 可以访问知识库。

Skill 的安装命令：

```bash
npx skills add https://github.com/nashsu/llm_wiki_skill.git --skill llm-wiki
```

### 让 Codex 提炼资料，让 LLM Wiki 构建 Wiki

Codex 负责从对话和项目上下文中提炼适合沉淀的资料，写入 `raw/sources/`；LLM Wiki 负责读取这些资料，生成并维护项目 Wiki。

这里的 source 是经过提炼、带有出处的资料：一个问题的背景、一次技术决策的理由、一段排错过程或一个阶段的项目进展。无需搬运所有项目文件，也无需逐条归档全部聊天。Codex 生成的摘要应明确标记为整理资料，保留原始会话或项目文件的出处，方便后续核对。

客户端安装好后，准备从下面这段提示词开始：

> 我已经安装了 LLM Wiki 客户端。请从本机可访问的 Codex 对话和项目上下文中，总结出适合 LLM Wiki 摄入的 source 资料，写入我指定知识库的 raw/sources 目录。先选一个项目试跑，按项目、资料类型和主题控制分类与命名，每份资料聚焦一个主题。内容包含背景、关键事实、决策及理由、验证结果、待解决问题和来源，区分已验证结论、讨论中的方案与未执行计划，不确定的信息明确标注。过滤密钥和隐私信息，保持原始对话与项目文件不变。你的写入范围仅限 raw/sources，由 LLM Wiki 自己摄入资料、生成并维护 wiki。先展示分类规则和少量样例，检查后再扩展。

### Source 的分类与命名约定

先采用一个简单、固定的约定，后续按实际使用调整：

- 按项目分类：`raw/sources/projects/<project>/`。
- 项目下按资料类型分类：`context/`（背景）、`decisions/`（决策）、`troubleshooting/`（排错）、`progress/`（阶段进展）。
- 文件名使用 `YYYY-MM-DD--<topic>.md`，日期取资料对应事件或阶段日期，主题使用简短且稳定的英文 slug。
- 每份资料记录标题、项目、类型、发生时间、整理时间、来源会话 ID／文件路径／提交号，以及结论状态。无法获取的来源信息明确标注，不补造。
- 同一主题的补充内容在定稿前合并；已经摄入的资料尽量保留，通过新的补充或修订 source 关联旧资料，说明替代了哪项结论。

例如：`raw/sources/projects/cube/decisions/2026-10-31--payment-provider-selection.md`。这只是命名示例，不代表已经作出支付渠道决策。

### 后续增量更新

后续同步也沿用这个分工：定期检查新增对话和项目变化，提炼新增的有效知识，生成 source，再交给 LLM Wiki 摄入。使用处理记录和内容哈希避免重复生成；一次对话可以提炼成多个主题，多次对话也可以合并为一份资料。

这次先验证完整流程：选一个项目，生成少量 source，检查分类、命名和出处，再让 LLM Wiki 构建页面，用几个真实问题检查结果。

## 第二件事：给 Obsidian 配置 LiveSync

电脑端与手机端都要能查看和编辑笔记。这次准备使用 [Self-hosted LiveSync 插件](https://community.obsidian.md/plugins/obsidian-livesync)，在自己的 NAS 上部署 CouchDB 作为同步后端。

### NAS 部署 CouchDB

1. 在 NAS 上部署 CouchDB 服务，配置持久化存储。
2. 按 LiveSync 的服务端文档完成数据库、账号和连接配置。
3. 配置手机可访问的连接方式，再验证客户端能正常连接。

### 电脑和手机接入

1. 先备份现有 Obsidian 笔记库。
2. 电脑端安装并启用 Self-hosted LiveSync，连接 NAS 上的 CouchDB。
3. 手机安装 Obsidian，并安装同一个插件。
4. 从已经配置好的设备生成 Setup URI，完成另一台设备的配置。
5. 测试电脑新建笔记、手机修改笔记，以及附件的双向同步。

同一个笔记库只使用这一套同步方案，避免与 iCloud、Obsidian Sync 等同时同步。同步跑通之后，再考虑把 LLM Wiki 的 Markdown 内容接到这套流程里，并确认需要同步的目录范围。

## 周末完成清单

- 安装并配置 LLM Wiki 客户端。
- 在 Codex 中安装 LLM Wiki Skill，验证连接。
- 从 Codex 对话和项目中提炼一批 raw/sources，统一命名与分类，由 LLM Wiki 完成首次 Wiki 构建。
- 在 NAS 上部署 CouchDB。
- 电脑端和手机端 Obsidian 配置 LiveSync。
- 完成笔记与附件的双向同步测试。

先把知识整理和多端使用的流程跑通，实际配置、遇到的问题和最终效果，做完再记录。
