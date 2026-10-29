---
title: 周末计划：构建个人 LLM Wiki，打通 Obsidian 多端同步
slug: weekend-plan-llm-wiki-obsidian-livesync
date: 2026.10.29
category: 计划
summary: 这个周末准备做两件事：让 Codex 帮我把本机积累的知识整理成个人 LLM Wiki，再用 NAS 上的 CouchDB 打通 Obsidian 电脑与手机的同步。
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

### 让 Codex 帮我构建知识库

客户端安装好后，准备从下面这段提示词开始：

> 我想构建我的 LLM Wiki 知识库，已经安装了客户端，但我的知识大部分都在本机 Codex 的历史记录里。请先检查可访问的历史记录和 LLM Wiki 项目，梳理适合沉淀的主题，给出目录和导入方案。先选一小批有价值的内容试跑，保留来源和时间，区分事实、结论与待验证想法，去除密钥和隐私信息，不要修改原始记录。然后协助我导入资料、构建 Wiki，并检查生成结果。

这里要先验证两件事：Codex 能否读取本机历史记录，以及这些记录应该怎样整理成适合导入的资料。安装 Skill 只是接通工具，历史记录的整理和导入还需要单独完成。

这次先以一个小范围的结果为目标：选一个主题，整理一批资料，生成页面，再用几个真实问题检查能否找到来源、得到有用的回答。

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
- 从本机 Codex 历史记录整理一批资料，完成首次 Wiki 构建。
- 在 NAS 上部署 CouchDB。
- 电脑端和手机端 Obsidian 配置 LiveSync。
- 完成笔记与附件的双向同步测试。

先把知识整理和多端使用的流程跑通，实际配置、遇到的问题和最终效果，做完再记录。
