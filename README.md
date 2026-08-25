# AI Context Collector v1.0.0

> 一个纯本地运行的 Windows 工具，帮助开发者快速收集项目源码上下文，生成适合发送给 ChatGPT、Claude、Gemini 等大模型的 Markdown 格式上下文。

---

## 🎬 新：Seedance 短剧工作台

本仓库同时包含一个独立的 AI 短剧生成工具，位于 [`seedance-studio/`](seedance-studio/)：

- 填写**剧情主题、角色人设、分镜数量、视频风格**，自动完成「剧本 → 分镜脚本 → 逐镜视频生成 → 成片合成」全流程
- 基于**字节跳动 Seedance 2.0**（火山方舟 `doubao-seedance-2-0-260128`），配置 `ARK_API_KEY` 即走真实视频生成；未配置时使用本地演示引擎完整模拟
- 实时展示生成进度（四阶段步骤条 + 逐镜进度 + 日志）与成片列表（播放/分镜片段/下载/单镜重生成）

```bash
cd seedance-studio && node server.js   # 打开 http://localhost:8787
```

详见 [seedance-studio/README.md](seedance-studio/README.md)。

---

## 目录

- [简介](#简介)
- [核心特性](#核心特性)
- [使用场景](#使用场景)
- [系统要求](#系统要求)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [功能详解](#功能详解)
  - [1. 设置项目目录](#1-设置项目目录)
  - [2. 粘贴 AI 内容并生成上下文](#2-粘贴-ai-内容并生成上下文)
  - [3. 手动搜索模式](#3-手动搜索模式)
  - [4. 查看索引信息](#4-查看索引信息)
  - [5. 重建索引](#5-重建索引)
- [配置说明](#配置说明)
- [支持的文件类型](#支持的文件类型)
- [常见问题](#常见问题)

---

## 简介

在日常开发中，当使用 ChatGPT、Claude、Gemini 等 AI 工具辅助编程时，AI 经常会要求你提供项目中的某些源文件作为上下文。手动查找、复制、粘贴这些文件不仅繁琐，而且容易遗漏。

**AI Context Collector** 就是为了解决这个问题而生的——它会在本地为你的项目建立文件索引，当你粘贴 AI 返回的文件列表时，自动搜索匹配文件并生成一份结构清晰的 Markdown 文档，同时自动复制到剪贴板，方便你直接粘贴到 AI 对话中。

**完全离线运行，不调用任何 AI 模型，不发送任何网络请求，你的代码始终安全地留在本地。**

---

## 核心特性

- **离线运行**：无需网络连接，不调用任何外部 API，源码安全
- **智能索引**：自动扫描项目目录，建立文件名索引，支持模糊匹配
- **一键生成**：粘贴 AI 返回的文件列表，自动提取文件名、搜索、生成 Markdown
- **自动复制**：生成的 Markdown 内容自动复制到剪贴板，即粘即用
- **多种输入方式**：支持从剪贴板读取或手动粘贴 AI 内容
- **手动搜索**：支持手动输入关键词搜索文件，灵活补充上下文
- **缓存机制**：项目索引自动缓存，下次启动无需重新扫描
- **彩色终端**：友好的彩色命令行界面，操作直观

---

## 使用场景

当 AI 大模型要求你提供项目文件时：

> 请提供以下文件：
> AuditController.java、AuditService.java、AuditMapper.xml、Audit.vue

你只需要：

1. **设置项目目录**（如 `D:\workspace\pia`）
2. **粘贴 AI 返回的内容**（选择从剪贴板读取或手动粘贴）
3. **点击生成** — 工具自动完成扫描、搜索、生成 Markdown 并复制到剪贴板

整个过程只需几秒钟，告别手动逐个文件查找复制的烦恼。

---

## 系统要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10 / 11 |
| PowerShell | 5.1 或更高版本 |
| 磁盘空间 | < 10 MB |
| 网络 | 不需要 |

---

## 项目结构

```
AIContextCollector/
├── AIContextCollector.ps1   # 主入口脚本
├── config.json              # 配置文件
├── README.md                # 本文件
├── modules/                 # 功能模块
│   ├── Utils.ps1            # 通用工具函数
│   ├── Console.ps1          # 终端 UI 交互
│   ├── Index.ps1            # 文件索引构建与管理
│   ├── Search.ps1           # 文件搜索与匹配
│   ├── Markdown.ps1         # Markdown 内容生成
│   └── Clipboard.ps1        # 剪贴板操作
├── cache/                   # 缓存目录
│   └── index.json           # 项目文件索引缓存
└── output/                  # 输出目录
    └── last.md              # 最近一次生成的 Markdown 文件
```

---

## 快速开始

### 方式一：直接运行

在项目目录下打开 PowerShell，执行：

```powershell
.\AIContextCollector.ps1
```

### 方式二：右键运行

在文件资源管理器中，右键点击 `AIContextCollector.ps1`，选择 **"使用 PowerShell 运行"**。

> **注意**：如果遇到执行策略限制，请先以管理员身份运行 PowerShell 并执行：
> ```powershell
> Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
> ```

---

## 功能详解

启动工具后，会显示一个彩色命令行菜单，包含 5 个主要功能：

```
============================================
     AI Context Collector v1.0.0
     当前项目: 未设置
============================================

  [1] 设置项目目录
  [2] 粘贴 GPT 内容并生成上下文
  [3] 手动搜索文件
  [4] 查看索引信息
  [5] 重建索引
  [Q] 退出
```

### 1. 设置项目目录

输入项目根目录的绝对路径（如 `D:\workspace\my-project`），工具会自动扫描项目中的所有源码文件，建立文件名索引。

- 支持的扩展名和忽略的目录可在 `config.json` 中配置
- 索引会缓存到 `cache/index.json`，下次启动自动加载
- 扫描完成后会显示项目名称和文件总数

### 2. 粘贴 AI 内容并生成上下文

这是最核心的功能。支持两种输入方式：

- **[1] 从剪贴板读取**：直接读取当前剪贴板中的 AI 回复内容，并显示预览
- **[2] 手动粘贴输入**：打开多行输入模式，手动粘贴内容（以空行结束输入）

工具会自动从 AI 回复中提取文件名（支持多种格式），然后在项目索引中搜索匹配。找到文件后，确认即可生成 Markdown 文档。

生成的 Markdown 文件会保存到 `output/last.md`，同时自动复制到剪贴板。

### 3. 手动搜索模式

除了自动提取文件名，你也可以手动输入关键词搜索文件。输入文件名或部分关键词，工具会在索引中模糊匹配，找到后可以选择生成上下文。

适用场景：
- AI 只描述了功能但没有给出具体文件名
- 需要补充额外的相关文件
- 想快速查看某个文件是否存在

### 4. 查看索引信息

查看当前项目的索引概况，包括：
- 项目名称和路径
- 已索引的文件总数
- 各文件类型分布
- 索引建立时间

### 5. 重建索引

当项目文件有增删改时，可以手动重建索引。工具会重新扫描项目目录，更新索引缓存。

---

## 配置说明

`config.json` 中的主要配置项：

### 索引配置 (`index`)

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `supportedExtensions` | 需要索引的文件扩展名列表 | `.java`, `.xml`, `.vue`, `.js`, `.ts`, `.json`, `.sql`, `.yml`, `.yaml`, `.properties`, `.md` |
| `ignoredDirectories` | 扫描时忽略的目录 | `.git`, `.idea`, `target`, `node_modules`, `dist`, `logs`, `.cache`, `.vscode`, `build`, `.gradle`, `bin`, `out`, `.svn`, `.hg` |
| `maxFileSizeKB` | 最大文件大小限制 (KB) | `1024` |

### 输出配置 (`output`)

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `outputDir` | 输出目录 | `output` |
| `defaultFileName` | 默认输出文件名 | `last.md` |
| `cacheDir` | 缓存目录 | `cache` |
| `indexFileName` | 索引文件名 | `index.json` |

### 终端配色 (`console`)

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `titleColor` | 标题颜色 | `Cyan` |
| `successColor` | 成功提示颜色 | `Green` |
| `warningColor` | 警告提示颜色 | `Yellow` |
| `errorColor` | 错误提示颜色 | `Red` |
| `infoColor` | 信息提示颜色 | `White` |
| `highlightColor` | 高亮颜色 | `Magenta` |

---

## 支持的文件类型

默认支持以下文件类型（可在 `config.json` 中扩展）：

| 类别 | 扩展名 |
|------|--------|
| 后端 | `.java`, `.sql`, `.yml`, `.yaml`, `.properties` |
| 前端 | `.vue`, `.js`, `.ts` |
| 配置/数据 | `.json`, `.xml` |
| 文档 | `.md` |

需要添加更多文件类型时，编辑 `config.json` 中的 `index.supportedExtensions` 数组即可。

---

## 常见问题

### Q: 可以同时为多个项目建立索引吗？

目前工具只维护一个项目索引，切换项目时旧索引会被覆盖。如需切换项目，使用 **功能 1** 重新设置项目目录即可。

### Q: 生成的 Markdown 文件在哪里？

默认保存在 `output/last.md`。每次生成会覆盖上一次的内容，同时内容也会自动复制到剪贴板。

### Q: 如何添加新的文件类型？

编辑 `config.json`，在 `index.supportedExtensions` 数组中添加新的扩展名（如 `".py"`、`".go"`），然后运行 **功能 5** 重建索引。

### Q: 如何排除更多目录？

编辑 `config.json`，在 `index.ignoredDirectories` 数组中添加需要忽略的目录名。

### Q: 索引文件太大怎么办？

可以调整 `index.maxFileSizeKB` 限制单个文件的大小，或增加 `index.ignoredDirectories` 排除更多目录。

### Q: 工具需要联网吗？

不需要。工具完全离线运行，不发送任何网络请求，也不调用任何 AI 模型 API。