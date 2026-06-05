# 织影 VisiWeave

[English](README.md) | [简体中文](README.zh-CN.md)

织影 VisiWeave 是一个本地优先的 AI 视觉创作工作台，用来把提示词、参考图、生成图、Agent 计划和视频任务编织到同一张可编辑画布里。项目把 tldraw 画布、Hono API、SQLite 本地持久化、OpenAI 兼容图像 provider、视频 provider 适配、Agent 规划和可选腾讯云 COS 备份组合在一起，适合在自己的电脑上完成创作、整理、复用和导出资产。

当前版本：`v0.2.0`。

对外产品名是 `织影 / VisiWeave`。部分 package 名、workspace filter 和本地数据库文件名仍保留历史标识 `gpt-image-canvas`，这是为了兼容当前项目结构。

## 预览

![织影 VisiWeave 预览图](docs/assets/app-preview.png)

## 主要功能

- 在无限 tldraw 画布上摆放生成图、参考图和 Agent 计划节点，把创作过程组织成可视化生产板。
- 手动文生图，支持尺寸、质量、格式和风格预设。
- 选中画布图片后作为参考图继续生成。
- Agent 可以把多图任务规划成可检查的 DAG，并支持失败重试。
- Creative Video 和 Video Library 支持文生视频任务与本地视频资产管理。
- 图像 provider 可来自 `.env`、应用内本地配置或 Codex 登录兜底。
- 视频 provider 支持关键帧图像视频、Grok Imagine 以及 custom HTTP/OpenAI 兼容视频网关。
- SQLite 本地保存项目状态、生成历史、资产元数据、provider 配置、Agent 配置和可选 COS 上传状态。
- Gallery 支持浏览、定位、重跑、下载和检查本地输出。

## 环境要求

- Node.js `24.15.0`；仓库内包含 `.nvmrc` 和 `.node-version`。
- pnpm `9.14.2`；版本已经在 `package.json` 中固定。
- 可访问 `gpt-image-2` 的 OpenAI API key、OpenAI 兼容图像端点，或在应用内完成 Codex 登录。
- Docker Desktop 或兼容 Docker Engine，仅 Docker 工作流需要。

如需启用固定 pnpm 版本：

```sh
corepack prepare pnpm@9.14.2 --activate
```

## 快速开始

Windows PowerShell：

```powershell
pnpm install
Copy-Item .env.example .env
pnpm dev
```

macOS/Linux：

```sh
pnpm install
cp .env.example .env
pnpm dev
```

打开 [http://localhost:5173](http://localhost:5173) 使用 Web 应用。

`pnpm dev` 会同时启动两个本地服务：

- API：[http://127.0.0.1:8787](http://127.0.0.1:8787)
- Web：[http://localhost:5173](http://localhost:5173)，并把 `/api` 代理到 API 服务

应用可以在没有凭证的情况下启动。没有可用 provider 时，`/` 会显示凭证感知首页，生成请求会返回 `missing_provider`，直到你完成配置。

## 配置图像生成

图像 provider 的默认优先级是：

1. `.env` 或运行时环境变量中的 OpenAI 兼容配置。
2. 应用内保存的本地 OpenAI 兼容配置。
3. Codex 登录兜底。

最简单的 API key 配置方式是编辑 `.env`：

```env
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_PROVIDER_FORMAT=newapi
OPENAI_IMAGE_TIMEOUT_MS=1200000
```

使用官方 OpenAI API 时留空 `OPENAI_BASE_URL`。如果使用其他 OpenAI 兼容服务，把它设置为兼容的 `/v1` 端点；如果该端点需要不同的图像模型名，修改 `OPENAI_IMAGE_MODEL`。
`OPENAI_IMAGE_PROVIDER_FORMAT` 默认为 `newapi`；如果是 Sub2API 兼容生图端点，设置为 `sub2api`，应用会按流式事件解析最终图片。

也可以打开右上角 provider 设置弹窗，保存一套本地 OpenAI 兼容配置。本地 key 会存储在 `DATA_DIR` 下的 SQLite 数据库中，读取时只返回掩码，并一直保留到你输入新 key 替换它。

## 配置视频生成

视频生成是可选能力，并且与图像生成分开配置。

支持的视频 provider 类型：

- `keyframe-image`：使用图像关键帧和 FFmpeg 插值生成视频。
- `grok-imagine`：调用 Grok Imagine 兼容视频端点和常见中转网关。
- `custom-http`：调用 OpenAI 兼容或自定义 HTTP 视频网关。

`.env` 示例：

```env
VIDEO_PROVIDER_KIND=grok-imagine
VIDEO_PROVIDER_URL=https://video-provider.example.com/v1
VIDEO_PROVIDER_MODEL=grok-imagine-video
VIDEO_PROVIDER_API_KEY=
VIDEO_PROVIDER_DOWNLOAD_PROXY_URL=
```

custom HTTP 视频网关可以使用基础 URL，也可以配置不同模式的 URL：

```env
VIDEO_PROVIDER_KIND=custom-http
VIDEO_PROVIDER_URL=https://video-provider.example.com
VIDEO_PROVIDER_TEXT_TO_VIDEO_URL=
VIDEO_PROVIDER_IMAGE_TO_VIDEO_URL=
VIDEO_PROVIDER_STATUS_URL=
VIDEO_PROVIDER_MODEL=grok-imagine-video
VIDEO_PROVIDER_API_KEY=
```

视频 provider 密钥只能保存在 `.env` 或本地 SQLite 数据库中，不要提交真实 key。

## 路由说明

- `/` 是凭证感知首页。没有 provider 时会提供 Codex 登录和 API 接入入口。
- `/canvas` 是画布工作区。没有 provider 时会返回 `/`。
- `/gallery` 始终可以访问，方便在没有凭证时查看本地图片作品。
- `/creative-video` 是视频生成工作区。
- `/video-library` 展示本地保存的视频输出和任务状态。

Provider 弹窗中的环境变量是只读的。修改 `.env` 后，需要重启 API 或 Docker 容器。

## 使用画布

右侧面板有两个主要流程：

- `Manual`：输入提示词，选择尺寸、质量和格式后生成。选中一张图片形状时，会切换到参考图生成。
- `Agent`：描述一个多图任务，可选中最多 3 张画布图片作为参考；确认生成的计划节点后执行。

Agent 规划使用独立于图像 provider 的 OpenAI 兼容聊天配置。请在 Agent LLM 设置中保存 API key、Base URL、模型、超时和 `supportsVision`。

开启 `supportsVision` 时，选中的图片会作为多模态输入传给规划模型。关闭时，选中图片只作为后续生图的 reference handle；Agent 不应声称自己看过图片内容。当前版本不持久化 Agent 对话消息，但已经落在画布上的计划节点会随普通 canvas snapshot 保存。

计划执行按 DAG 调度。互不依赖的 job 可以并发运行；引用上游生成图的 job 会等待依赖完成；`Retry failed` 只重跑失败或被阻塞的 job，并保留已经成功的上游输出。单个计划最多生成 16 张图，包括中间锚点图。

## 云端备份

生成图始终先保存到本地。启用应用内腾讯云 COS 配置后，新生成图还会上传到：

```text
<key-prefix>/YYYY/MM/<assetId>.<ext>
```

COS 弹窗默认值来自：

- `COS_DEFAULT_BUCKET`
- `COS_DEFAULT_REGION`
- `COS_DEFAULT_KEY_PREFIX`

保存 COS 配置前会执行一次测试上传和删除。`SecretKey` 会存储在本地 SQLite 中，读取配置时只返回掩码。COS 上传失败不会导致生图失败；图片仍可从本地读取，历史记录会显示上传失败状态。

## 项目结构

```text
apps/api          Hono API、SQLite 存储、provider 选择、Agent 规划与执行、视频任务
apps/web          Vite + React + tldraw Web 应用
packages/shared   共享契约和常量
docs              项目文档和预览素材
data              本地运行时数据，已被 Git 忽略
```

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 同时启动 API 和 Web 开发服务。 |
| `pnpm api:dev` | 启动 API 开发流程。 |
| `pnpm web:dev` | 启动 Vite Web 开发流程。 |
| `pnpm typecheck` | 检查 shared、web 和 API 的 TypeScript。 |
| `pnpm build` | 构建 shared、web 和 API 包。 |
| `pnpm start` | 启动构建后的 API 包。 |
| `pnpm --filter @gpt-image-canvas/api smoke:planner` | 检查 Agent plan 校验 fixture。 |
| `pnpm --filter @gpt-image-canvas/api smoke:agent` | 检查 Agent 配置和 WebSocket 基础行为。 |
| `pnpm --filter @gpt-image-canvas/api smoke:executor` | 用 fake image provider 检查 Agent DAG 执行器。 |
| `pnpm --filter @gpt-image-canvas/api smoke:provider-video-config` | 检查视频 provider 配置行为。 |
| `pnpm --filter @gpt-image-canvas/api smoke:grok-imagine-video` | 检查 Grok Imagine 视频网关适配。 |
| `pnpm --filter @gpt-image-canvas/api smoke:custom-http-grok2api-video` | 检查 custom HTTP/grok2api 风格视频适配。 |

完成代码改动前请运行：

```sh
pnpm typecheck
pnpm build
```

涉及 UI 改动时，请运行 `pnpm dev`，并在浏览器中验证 [http://localhost:5173](http://localhost:5173)。

如果切换 Node 版本后 `better-sqlite3` 报 `NODE_MODULE_VERSION` 不匹配，重新构建原生依赖：

```sh
pnpm --filter @gpt-image-canvas/api rebuild better-sqlite3 --stream
```

## Docker

Docker Compose 会把共享契约、Web 应用和 API 构建到同一个镜像中。API 在同一个本地端口同时提供 `/api` 和构建后的 Web bundle。SQLite 数据和生成资产会持久化到宿主机 `./data`。

推荐使用仓库内置启动脚本，它会在缺少本地 `.env` 时自动创建，先执行不会展开密钥的 Compose 配置校验，再启动容器。

Windows PowerShell：

```powershell
.\scripts\docker-start.ps1
```

macOS/Linux：

```sh
sh scripts/docker-start.sh
```

后台运行：

```powershell
.\scripts\docker-start.ps1 -Detached
```

```sh
sh scripts/docker-start.sh --detached
```

手动启动等价于：

```sh
docker compose config --quiet --no-env-resolution
docker compose up --build
```

默认打开 [http://localhost:8787](http://localhost:8787)。如需使用其他本地端口，请在启动 Compose 前设置 `.env` 中的 `PORT`，例如 `PORT=8788`。

真实凭证存在时，请使用 `docker compose config --quiet --no-env-resolution` 做校验。普通 `docker compose config` 会展开 env 文件，可能打印密钥。

Compose 默认设置 `SQLITE_JOURNAL_MODE=DELETE` 和 `SQLITE_LOCKING_MODE=EXCLUSIVE`，用于避开 Docker Desktop 绑定挂载目录时常见的 SQLite shared-memory 错误。不要让 `pnpm dev` 和 Docker 同时使用同一个 `data/` 目录。

Compose 构建支持这些网络相关 build args。需要内网镜像或代理时，在 `.env` 或命令行中显式设置：

- `NODE_IMAGE`
- `NPM_CONFIG_REGISTRY`
- `APT_MIRROR`
- `APT_SECURITY_MIRROR`

默认 `NODE_IMAGE` 是 `node:24.15.0-bookworm-slim`。

## 本地数据与密钥

`DATA_DIR` 本地默认是 `./data`，Docker 中默认是 `/app/data`。其中包含：

- `gpt-image-canvas.sqlite`：项目状态、生成历史、资产元数据、provider 配置、Agent LLM 配置、可选 COS 配置，以及 Codex OAuth token 记录。
- `assets/`：生成的图像和视频文件。

不要提交 `.env`、`.ralph/`、`.codex-temp/`、`data/`、生成资产、SQLite 数据库或构建输出。

保存本地 provider key、Agent LLM key、COS secret 或 Codex token 后，请把 `data/gpt-image-canvas.sqlite` 视为敏感文件。当前应用面向本地工作站使用；如果没有自行增加认证和网络隔离，不要把它公开暴露。

如果真实 API key 曾经被提交过，请先轮换该 key。Git ignore 只能防止之后继续泄露，不能从已有 Git 历史中删除密钥。

## 故障排查

- 缺少 provider：在 `.env` 添加 `OPENAI_API_KEY` 并重启，或从设置弹窗保存本地 provider，或完成 Codex 登录。
- 自定义图像端点失败：确认 `OPENAI_BASE_URL` 指向 OpenAI 兼容 `/v1` 端点、支持当前图像模型，并且 `OPENAI_IMAGE_PROVIDER_FORMAT` 与端点格式匹配（`newapi` 或 `sub2api`）。
- 视频 provider 失败：确认 `VIDEO_PROVIDER_KIND`、URL、模型和 API key 与所选网关匹配。
- Agent 无法规划：Agent LLM 配置需要独立于图像 provider 保存。如果开启 `supportsVision` 后失败，减少选中图片数量或尺寸。
- 端口冲突：为 API/Docker 设置 `PORT`。Web 开发端口冲突时，停止占用 `5173` 的进程，或运行 `pnpm web:dev -- --port 5174`。
- Docker 无法拉取基础镜像：恢复 Docker Hub 访问，或把 `NODE_IMAGE` 设置为本地缓存的等价 Node `24.15.0` 镜像。
- Docker 中出现 SQLite `SQLITE_IOERR_SHMOPEN`：保留 Compose 的 SQLite 默认值，重新构建，并确认没有本地 API 进程同时占用同一个数据库。
- SQLite `SQLITE_CORRUPT`：停止所有应用进程，备份 `data/`，再从备份恢复，或删除 SQLite 文件让应用创建新数据库。`data/assets/` 下的资源文件可以保留。

## 升级

升级旧版本本地安装前，先备份运行时数据：

Windows PowerShell：

```powershell
Copy-Item -Recurse data data-backup-before-upgrade
docker compose up --build
```

macOS/Linux：

```sh
cp -R data data-backup-before-upgrade
docker compose up --build
```

升级后请一起重建 Web 应用和 API。

## 许可证

MIT

## 友情链接

- [LINUX DO](https://linux.do/)
