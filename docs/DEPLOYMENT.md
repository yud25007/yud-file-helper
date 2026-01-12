# YUD 文件助手 - 技术文档与部署指南

YUD 文件助手是一个基于 **阅后即焚** 理念的轻量级文件与文本分享工具。它结合了极简的 UI 设计、间谍风格的 AI 任务简报以及可靠的云存储技术。

---

## 1. 项目概述

YUD 文件助手旨在提供一个临时、安全且有趣的分享渠道。其核心功能包括：

- **阅后即焚**：文件或文本在达到设定的下载次数或过期时间后，会自动从存储和数据库中永久抹除
- **混合分享**：支持最高 50MB 的文件上传或纯文本内容分享
- **AI 任务简报**：利用 Google Gemini AI 为每个分享任务生成独特的"间谍行动"风格描述
- **原子性计数**：通过 Redis Lua 脚本确保下载次数计数的精确性，防止并发双扣

---

## 2. 技术栈

### 前端 (Frontend)
| 技术 | 说明 |
| --- | --- |
| Vite | 构建工具 |
| React 19 | UI 框架 |
| TypeScript | 类型安全 |
| TailwindCSS | 样式框架 |
| Lucide React | 图标库 |

### 后端 (Backend)
| 技术 | 说明 |
| --- | --- |
| Node.js + Express | API 服务器 |
| Helmet | 安全响应头（CSP, HSTS 等） |
| Express Rate Limit | 防止接口被恶意刷取 |
| Multer | 处理分段上传元数据 |

### 存储与数据库
| 服务 | 用途 |
| --- | --- |
| Cloudflare R2 | S3 兼容对象存储，存储实际文件 |
| Redis | 文件元数据、提取码映射及原子性下载计数 |

### 人工智能 (AI)
| 服务 | 用途 |
| --- | --- |
| Google Gemini | 生成任务简报（默认 `gemini-2.0-flash`） |

---

## 3. 环境变量配置

### 3.1 基础配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | API 与静态资源监听端口 |
| `CORS_ORIGIN` | 空 | 允许跨域的域名列表（逗号分隔），空值表示放行全部 |

### 3.2 Redis 配置（必须）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `REDIS_URL` | 空 | 连接串优先（格式 `redis://:password@host:port/0`） |
| `REDIS_HOST` | `127.0.0.1` | Redis 主机（`REDIS_URL` 未设置时使用） |
| `REDIS_PORT` | `6379` | Redis 端口 |
| `REDIS_PASSWORD` | 空 | Redis 密码 |
| `REDIS_PREFIX` | `transfer:` | Key 前缀 |
| `REDIS_TTL_SECONDS` | `86400` | 默认有效期（秒），最大 7 天 |

### 3.3 Cloudflare R2 配置（必须）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `R2_ACCOUNT_ID` | 空 | Cloudflare 账户 ID |
| `R2_ACCESS_KEY_ID` | 空 | R2 API 令牌的 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | 空 | R2 API 令牌的 Secret Access Key |
| `R2_BUCKET` | 空 | R2 存储桶名称 |
| `R2_PRESIGN_EXPIRES_SECONDS` | `300` | 预签名链接有效期（秒） |

> ⚠️ **重要警告**：在配置环境变量时，请确保 **不要包含尖括号 `< >`**。
> 例如，如果你的 ID 是 `abc123`，请直接输入 `abc123`，而不是 `<abc123>`。

### 3.4 AI 配置（可选）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `API_KEY` | 空 | Google Gemini API Key，未配置时显示默认文案 |
| `GEMINI_BASE_URL` | 空 | Gemini API 自定义 Base URL（用于代理） |
| `GEMINI_MODEL` | `gemini-2.0-flash` | 使用的模型名称 |

### 3.5 限制配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MAX_DOWNLOADS` | `10` | 单次上传允许的最大下载次数上限 |
| `MAX_UPLOAD_BYTES` | `52428800` | 允许上传的最大文件大小（50MB） |
| `RATE_LIMIT_WINDOW_MS` | `900000` | 速率限制窗口（15分钟） |
| `RATE_LIMIT_MAX` | `100` | 速率限制窗口内最大请求数 |

### 3.6 前端配置（构建时）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_API_BASE_URL` | 空 | 前端 API 前缀，空值时使用同域 `/api` |

---

## 4. Cloudflare R2 配置指南

### 4.1 创建存储桶

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **R2 Object Storage**
3. 点击 **Create bucket** 创建新存储桶

### 4.2 创建 API 令牌

1. 在 R2 页面点击 **Manage R2 API Tokens**
2. 创建具有 **编辑** 权限的 API 令牌
3. 保存 **Access Key ID** 和 **Secret Access Key**

### 4.3 配置 CORS

在存储桶 **Settings → CORS Policy** 中添加：

```json
[
  {
    "AllowedOrigins": ["https://your-app.zeabur.app", "http://localhost:5173"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": [],
    "MaxAgeSeconds": 3600
  }
]
```

> 将 `AllowedOrigins` 替换为你的实际域名

---

## 5. Zeabur 部署指南

### 5.1 导入项目

1. 在 [Zeabur](https://zeabur.com/) 中连接 GitHub 仓库
2. 选择 `yud文件助手` 项目导入

### 5.2 配置服务

- **Runtime**: Node.js
- **Build Command**: `npm install && npm run build`
- **Start Command**: `node server.js`

### 5.3 添加环境变量

在 **Variables** 标签页中添加所有必要的环境变量（参见第 3 节）

### 5.4 添加 Redis 服务

1. 在项目中点击 **Add Service → Prebuilt → Redis**
2. Zeabur 会自动注入 `REDIS_URL` 环境变量

### 5.5 绑定域名

在 **Networking** 标签页绑定生成或自定义的域名

---

## 6. Docker 部署

### 6.1 构建镜像

```bash
docker build -t yud-file-helper .
```

### 6.2 运行容器

```bash
docker run --rm -p 8080:8080 --env-file .env yud-file-helper
```

### 6.3 说明

- 镜像为多阶段构建（Node 22-alpine），内置 `dist/` + `server.js`
- 默认暴露 `8080` 端口
- 前后端同域时无需设置 `VITE_API_BASE_URL`
- 生产环境建议使用外部 Redis/R2，通过运行时环境变量注入密钥

---

## 7. API 端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/upload` | 上传文件或文本 |
| `GET` | `/api/file/:code` | 获取元数据（不含下载链接） |
| `POST` | `/api/consume/:code` | 消费并获取下载链接/内容 |
| `POST` | `/api/briefing` | 生成 AI 任务简报 |

### 7.1 上传接口详情

**请求**: `multipart/form-data`

| 字段 | 类型 | 必须 | 说明 |
| --- | --- | --- | --- |
| `type` | string | 是 | `FILE` 或 `TEXT` |
| `maxDownloads` | number | 否 | 最大下载次数（默认 1） |
| `ttlSeconds` | number | 否 | 过期时间（秒，最大 7 天） |
| `aiDescription` | string | 否 | AI 描述 |
| `message` | string | TEXT 必须 | 文本内容 |
| `filename` | string | FILE 必须 | 文件名 |
| `size` | number | FILE 必须 | 文件大小 |
| `contentType` | string | FILE 必须 | MIME 类型 |

**响应**: 元数据 + `uploadUrl`（仅 FILE 类型）

### 7.2 消费接口详情

**响应**:

```json
{
  "currentDownloads": 1,
  "maxDownloads": 3,
  "burned": false,
  "downloadUrl": "https://...",  // FILE 类型
  "message": "..."               // TEXT 类型
}
```

---

## 8. 安全与防护

### 8.1 速率限制

- 全站启用 `express-rate-limit`
- 默认 15 分钟窗口内最多 100 次请求
- 返回 `RateLimit-*` 响应头

### 8.2 CSP (Content Security Policy)

已配置白名单：
- `cdn.tailwindcss.com`
- `fonts.googleapis.com` / `fonts.gstatic.com`
- `*.r2.cloudflarestorage.com`
- `lottie.host`

### 8.3 原子消费（Lua 脚本）

1. `EXISTS` + `HGET` 读取下载计数，超限则直接返回不消费
2. `HINCRBY` 原子递增下载次数，避免并发双扣
3. 达到上限时自动删除 Redis 记录及 R2 对象

---

## 9. 常见问题排查

### 9.1 NoSuchKey 或存储认证失败

**原因**: 环境变量中包含了多余的尖括号 `< >`

**解决**: 检查 `R2_ACCOUNT_ID` 等变量，确保其值为纯文本字符串

### 9.2 502 Bad Gateway / Redis 错误

**原因**: 某些旧版 Redis 环境可能不完全兼容 Lua 脚本

**解决**: 本项目已优化 Lua 脚本以支持 Redis 5.0+

### 9.3 CSP 错误

**原因**: `helmet` 中间件严格限制了资源加载

**解决**: 如使用自定义 CDN，需在 `server.js` 的 `helmet` 配置中添加白名单

### 9.4 文件上传失败 (CORS)

**原因**: 浏览器拦截了向 R2 发送的 `PUT` 请求

**解决**: 检查 R2 存储桶的 CORS 配置，确保包含正确的域名和方法

### 9.5 AI 简报显示默认文案

**原因**: `API_KEY` 未配置或 Gemini 接口调用失败

**解决**: 检查 Gemini API Key 是否有效。此问题不影响核心文件分享功能

---

## 10. 项目结构

```
yud文件助手/
├── api/
│   ├── r2.js          # Cloudflare R2 客户端
│   └── redis.js       # Redis 客户端与 Lua 脚本
├── components/        # React 组件
├── services/
│   └── storage.ts     # 前端 API 调用
├── server.js          # Express 服务器
├── Dockerfile         # Docker 构建配置
└── package.json
```

---

**YUD 文件助手 - 安全、快速、阅后即焚。**
