# Leapcell 部署指南

这个项目可以迁移到 Leapcell，但不要按“原样平移 + 全部换成 Leapcell 内建组件”的思路直接上。

当前仓库已经满足基础部署条件：

- 前端可通过 `npm run build` 产出 `dist/`
- 后端通过 `node server.js` 启动
- 服务监听 `process.env.PORT`，未提供时默认 `8080`
- 文件内容不落本地磁盘，实际文件走 Cloudflare R2 预签名 URL

本地已验证构建成功：

```bash
npm run build
```

## 先说结论

推荐的迁移方案是：

1. 应用托管迁到 Leapcell
2. 文件存储继续用 Cloudflare R2
3. Redis 优先继续使用“标准 Redis 提供商”，不要默认切到 Leapcell Redis
4. 自定义域名再从 `tr.yud25007.site` 切到 Leapcell

## 为什么不建议直接用 Leapcell Redis

这个项目当前在 `api/redis.js` 里使用 `redis.eval(...)` 执行 Lua 脚本来保证下载次数的原子扣减。

Leapcell 官方 Redis 文档写明它兼容的是一部分 Redis 命令，并单独列了兼容性列表；我没有在官方兼容性说明里看到 `EVAL`。这意味着：

- 直接使用 Leapcell Redis，有较大概率在 `consumeTransfer` 这里出兼容性问题
- 更稳妥的做法是继续使用完整 Redis 服务，例如你现有的外部 Redis、Redis Cloud、Upstash 之外的标准 Redis 实例等

如果你后面明确想“应用和 Redis 都迁到 Leapcell”，那就需要继续改代码，把 Lua 脚本改成 Leapcell Redis 可接受的原子方案。

## 另一个要注意的问题

`server.js` 在文件被阅后即焚时，会用进程内 `setTimeout(...)` 延迟删除 R2 对象。

Leapcell 官方运行约束里提到，空闲时 CPU 会暂停，不适合依赖没有新请求时仍持续运行的后台任务。因此：

- 如果你的部署形态会在空闲时暂停，这个延迟删除逻辑不够稳
- 更稳的做法是先按现状部署应用，但保留这个风险认知
- 如果你要彻底规避这个问题，后续需要把“延迟删除”改成外部调度或请求驱动清理

这不会阻止应用上线，但会影响“烧毁后延迟删 R2 文件”的可靠性。

## Leapcell 控制台配置

在 Leapcell 里创建一个从 GitHub 拉代码的 Node 服务，使用下面的配置：

- Build Command: `npm install && npm run build`
- Start Command: `node server.js`
- Port: 使用平台注入的 `PORT`

当前仓库分支是 `master`。Leapcell 官方持续部署文档当前写的是监控 `main` 分支，所以你需要二选一：

1. 确认 Leapcell 创建服务时支持选择 `master`
2. 或者把仓库默认分支改成 `main`

如果不处理这个点，自动部署可能不按你预期触发。

## 需要配置的环境变量

按当前代码实际使用的变量名填写，不要照旧文档里错误的 `GEMINI_API_KEY` 或 `R2_BUCKET_NAME` 去配。

```bash
# Backend
PORT=8080
CORS_ORIGIN=https://你的-leapcell-域名
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
MAX_DOWNLOADS=10
MAX_UPLOAD_BYTES=52428800

# Redis
REDIS_URL=redis://:password@host:6379/0
REDIS_TTL_SECONDS=86400
REDIS_PREFIX=transfer:

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=yud-files
R2_PRESIGN_EXPIRES_SECONDS=300

# Gemini
API_KEY=
GEMINI_BASE_URL=
GEMINI_MODEL=gemini-3-flash-preview

# Frontend
VITE_API_BASE_URL=
```

说明：

- `API_KEY` 才是后端 `server.js` 实际读取的变量名
- `R2_BUCKET` 才是 `api/r2.js` 实际读取的变量名
- `VITE_API_BASE_URL` 留空时，前端默认走同域 `/api`
- 如果前后端同域部署，`CORS_ORIGIN` 可以先配成你的 Leapcell 域名，切自定义域名后再更新

## 推荐迁移顺序

1. 先把代码推到 GitHub
2. 在 Leapcell 创建服务并配置 Build/Start Command
3. 先填一套可用环境变量
4. Redis 先接外部标准 Redis
5. 部署成功后，先用 Leapcell 分配域名验证
6. 确认上传、提取、文本分享都正常
7. 最后把 `tr.yud25007.site` 的 DNS 指到 Leapcell
8. 域名切换后更新 `CORS_ORIGIN`

## 验证清单

部署完成后至少检查这些：

- 首页可以正常打开
- `POST /api/upload` 正常返回上传元数据
- 文件可以上传到 R2
- `GET /api/file/:code` 正常返回元数据
- `POST /api/consume/:code` 能正确扣减次数并返回内容/下载链接
- 触发一次“阅后即焚”流程，确认下载链路正常

## 自定义域名切换

Leapcell 官方文档支持自定义域名。建议切换顺序如下：

1. 先用 `*.leapcell.dev` 域名验证应用
2. 在 Leapcell 后台添加 `tr.yud25007.site`
3. 按平台提示修改 DNS 记录
4. 等证书和域名状态就绪
5. 更新 `CORS_ORIGIN=https://tr.yud25007.site`
6. 再做一轮上传/提取回归测试

## 现在这次迁移里哪些东西已经确认

- 构建命令可用
- 启动命令可用
- 端口处理符合平台习惯
- 不依赖本地持久磁盘
- 继续使用 R2 是合适的

## 现在还没做的事情

- 没有把 Redis 原子消费逻辑从 Lua 改掉
- 没有把延迟删除改成外部调度模型
- 没有替你实际在 Leapcell 控制台点部署
- 没有替你切 DNS

## 参考链接

- Leapcell GitHub Deploy: https://docs.leapcell.io/docs/web-hosting/deploy-github-repository
- Leapcell Continuous Deployments: https://docs.leapcell.io/docs/web-hosting/continuous-deployments
- Leapcell Custom Domains: https://docs.leapcell.io/docs/web-hosting/custom-domains
- Leapcell Express Example: https://docs.leapcell.io/examples/nodejs/express
- Leapcell Redis Quick Start: https://docs.leapcell.io/docs/redis/quick-start
- Leapcell Redis Compatibility: https://docs.leapcell.io/docs/redis/compatibility
- Leapcell Troubleshooting: https://docs.leapcell.io/docs/getting-started/troubleshooting
