# 🎬 Seedance 短剧工作台（Seedance Short Drama Studio）

> 基于 **字节跳动 Seedance 2.0**（火山方舟 `doubao-seedance-2-0-260128`）的 AI 短剧生成工具：
> 填写**剧情主题 + 角色人设 + 分镜数量 + 视频风格**，自动完成
> `剧本 → 分镜脚本 → 逐镜视频生成 → 成片合成` 全流程，并实时展示生成进度与成片列表。

![架构](https://img.shields.io/badge/Node-18%2B-green) ![零依赖](https://img.shields.io/badge/npm%20deps-0-blue) ![Seedance](https://img.shields.io/badge/Seedance-2.0-purple)

---

## ✨ 功能特性

| 模块 | 说明 |
| --- | --- |
| 📖 创作表单 | 剧情主题（自由文本/关键词）、角色人设（最多 6 个：姓名/身份/性格/目标）、分镜数量（2–10）、6 种视频风格 |
| ✍️ 编剧引擎 | 本地模板引擎按题材（逆袭/悬疑/甜宠/复仇/热血/古风/温情）自动生成**剧名、梗概、分幕剧情、逐镜脚本**（场景/画面/运镜/台词/时长），同输入结果可复现 |
| 🎥 视频生成 | **两种模式**：配置 `ARK_API_KEY` 走真实 Seedance 2.0 API；未配置则用本地演示引擎（Pillow 海报 + ffmpeg 运镜合成）模拟完整流程 |
| 📊 进度展示 | 四阶段步骤条（剧本→分镜→视频→成片）+ 总体进度条 + 逐镜卡片进度 + 滚动生成日志 |
| 🎞️ 成片列表 | 成片库（封面/风格/状态）、成片播放器、分镜片段预览、单镜重生成、一键下载 MP4 |

## 🚀 快速开始

```bash
cd seedance-studio

# 1. 准备本地渲染依赖（仅演示模式需要；一次性）
mkdir -p vendor
python3 -m pip install --target vendor imageio-ffmpeg pillow fonttools
# 字体与 ffmpeg 二进制：见 vendor/ 说明（本仓库演示环境已预置）

# 2. 启动
node server.js
# 浏览器打开 http://localhost:8787
```

> 仓库 `vendor/` 已被 .gitignore 排除。演示环境已预置：
> `vendor/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2`、
> `vendor/fonts/NotoSansSC-Regular.ttf`（由 Noto Sans SC woff 转换）、Pillow/fontTools 包。

## 🔑 接入真实 Seedance 2.0

```bash
export ARK_API_KEY="你的火山方舟 API Key"
node server.js
```

配置后自动切换为真实模式（顶栏徽章变绿），每个分镜调用火山方舟异步任务接口：

- 创建任务 `POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks`
- 轮询查询 `GET  /contents/generations/tasks/{id}`，成功后下载 `content.video_url`（24h 有效）
- 单镜提示词由「风格标签 + 角色人设 + 场景/画面/运镜/台词」自动拼装，支持 `generate_audio` 对口型配音

可选环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ARK_API_KEY` | 空 | 火山方舟 API Key，配置即启用真实模式 |
| `SEEDANCE_MODEL` | `doubao-seedance-2-0-260128` | 模型 ID（极速版 `doubao-seedance-2-0-fast-260128`） |
| `SEEDANCE_BASE_URL` | `https://ark.cn-beijing.volces.com/api/v3` | 接口地址 |
| `SEEDANCE_CONCURRENCY` | `2` | 真实模式并行生成的分镜数 |
| `SEEDANCE_POLL_MS` | `8000` | 任务轮询间隔 |
| `SEEDANCE_TIMEOUT_MIN` | `20` | 单镜超时（分钟） |
| `MOCK_SHOT_SECONDS` | `7` | 演示模式单镜模拟耗时（秒） |
| `PORT` | `8787` | 服务端口 |

## 📁 项目结构

```
seedance-studio/
├── server.js             # HTTP 服务 + REST API（零 npm 依赖）
├── lib/
│   ├── scriptEngine.js   # 编剧引擎：剧名/梗概/分幕/逐镜脚本
│   ├── styles.js         # 6 种视频风格配方（调色/运镜/音效/提示词标签）
│   ├── seedance.js       # 火山方舟 Seedance 2.0 客户端（真实模式）
│   ├── mockEngine.js     # 演示引擎：海报 + ffmpeg 模拟生成
│   ├── ffmpeg.js         # ffmpeg 封装（渲染/拼接/抽帧）
│   ├── pipeline.js       # 流水线编排（剧本→分镜→视频→成片）
│   └── store.js          # 项目持久化（data/projects/<id>/project.json）
├── bin/poster.py         # Pillow 中文海报渲染器
├── public/               # 前端（原生 HTML/CSS/JS，暗色电影风格 UI）
├── data/                 # 运行时数据（项目、成片，gitignore）
└── vendor/               # 本地二进制与字体（gitignore）
```

## 🔌 API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/status` | 运行模式 / 风格 / 参数限制 |
| GET | `/api/projects` | 项目列表（成片库） |
| POST | `/api/projects` | 创建项目（config：theme/characters/shotCount/style/resolution/ratio/duration/generateAudio） |
| GET | `/api/projects/:id` | 项目详情（剧本/分镜/进度/日志） |
| POST | `/api/projects/:id/generate` | 启动生成流水线 |
| POST | `/api/projects/:id/cancel` | 取消生成 |
| POST | `/api/projects/:id/shots/regenerate` | 重新生成单镜（body: `{"index": 0}`） |
| DELETE | `/api/projects/:id` | 删除项目 |
| GET | `/api/projects/:id/files/:name` | 视频/海报（支持 Range 拖动播放） |

## ⚠️ 说明

- **演示模式**生成的视频为「风格化占位画面 + 环境音」的本地合成片，用于完整走通产品流程；配置 API Key 后即为真实 Seedance 2.0 视频（约 2–5 分钟/镜，请注意 API 用量）。
- 剧本由内置编剧引擎本地生成（快速、免费、可复现）；如需 LLM 编剧，可在 `lib/scriptEngine.js` 处接入豆包大模型。
- 本项目为演示项目，仅供学习交流。
