# YUD 文件助手

一个基于“阅后即焚”理念的临时文件/文本分享工具，前端使用 Vite + React，后端使用 Express，文件内容通过 Cloudflare R2 存储，元数据和下载次数通过 Redis 管理。

## 本地运行

前置条件：

- Node.js 22+
- 可用的 Redis
- 可用的 Cloudflare R2 配置

步骤：

1. 安装依赖

```bash
npm install
```

2. 复制环境变量模板并填写实际值

```bash
copy .env.example .env
```

至少要注意这些变量名：

- `API_KEY` 是后端 Gemini 配置
- `R2_BUCKET` 是 R2 存储桶名
- `REDIS_URL` 是 Redis 连接串
- `VITE_API_BASE_URL` 为空时前端默认走同域 `/api`

3. 启动前端开发服务器

```bash
npm run dev
```

4. 启动后端服务

```bash
npm run dev:server
```

## 生产构建

```bash
npm run build
npm start
```

后端默认监听 `PORT=8080`，并在存在 `dist/` 时同时托管前端静态资源。

## 部署文档

- 通用部署说明见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- Leapcell 迁移说明见 [LEAPCELL_DEPLOY.md](LEAPCELL_DEPLOY.md)
