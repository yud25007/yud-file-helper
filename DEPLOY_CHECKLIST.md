# Leapcell 部署检查清单

## 部署前

- [ ] 代码已推送到 GitHub
- [ ] 已确认 Leapcell 服务绑定的仓库和分支
- [ ] 已准备好 Cloudflare R2 配置
- [ ] 已准备好 Redis 连接串
- [ ] 已准备好 Gemini `API_KEY`
- [ ] 已确认是否继续使用外部标准 Redis

## 重要前提

- [ ] 不直接把 Redis 切到 Leapcell Redis，除非你准备继续改掉 `api/redis.js` 里的 `redis.eval(...)`
- [ ] 已知悉 `server.js` 里有进程内 `setTimeout(...)` 延迟删除逻辑，迁到按请求暂停 CPU 的运行模型后可靠性会下降
- [ ] 已确认当前仓库默认分支是 `master`，需要检查 Leapcell 是否直接支持，或改成 `main`

## Build / Start

- [ ] Build Command: `npm install && npm run build`
- [ ] Start Command: `node server.js`
- [ ] 端口使用平台注入的 `PORT`

## 环境变量

```bash
PORT=8080
CORS_ORIGIN=
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
MAX_DOWNLOADS=10
MAX_UPLOAD_BYTES=52428800

REDIS_URL=
REDIS_TTL_SECONDS=86400
REDIS_PREFIX=transfer:

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=yud-files
R2_PRESIGN_EXPIRES_SECONDS=300

API_KEY=
GEMINI_BASE_URL=
GEMINI_MODEL=gemini-3-flash-preview

VITE_API_BASE_URL=
```

核对点：

- [ ] 用的是 `API_KEY`，不是 `GEMINI_API_KEY`
- [ ] 用的是 `R2_BUCKET`，不是 `R2_BUCKET_NAME`
- [ ] 前后端同域时，`VITE_API_BASE_URL` 可以留空

## 首次部署后验证

- [ ] 首页可访问
- [ ] 上传接口正常
- [ ] 文本分享正常
- [ ] 文件上传到 R2 正常
- [ ] 提取码查询正常
- [ ] 下载/消费次数扣减正常

## 切自定义域名前

- [ ] 已先用 Leapcell 默认域名完成验证
- [ ] 已准备好 `tr.yud25007.site` 的 DNS 修改
- [ ] 已准备在切域名后更新 `CORS_ORIGIN`

## 切自定义域名后

- [ ] 域名解析已生效
- [ ] 证书状态正常
- [ ] `CORS_ORIGIN=https://tr.yud25007.site`
- [ ] 再做一轮上传/提取回归测试
