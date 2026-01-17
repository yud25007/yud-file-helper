import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import { getPresignedUploadUrl, getPresignedDownloadUrl, deleteObject, objectExists, deleteObjectWithRetry } from './api/r2.js';
import { saveTransfer, getTransfer, consumeTransfer, deleteTransfer, schedulePendingDelete, getPendingDeletes, removePendingDelete } from './api/redis.js';
import { sanitizeFilename, normalizeContentType } from './utils/sanitize.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const PORT = parsePositiveInt(process.env.PORT, 8080);
const DEFAULT_TTL_SECONDS = parsePositiveInt(process.env.REDIS_TTL_SECONDS, 24 * 60 * 60);
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60; // 最大 7 天
// MAX_DOWNLOADS 不再限制上限，用户可自定义任意正整数
const MAX_UPLOAD_BYTES = parsePositiveInt(process.env.MAX_UPLOAD_BYTES, 50 * 1024 * 1024);
const RATE_LIMIT_WINDOW_MS = parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
const RATE_LIMIT_MAX = parsePositiveInt(process.env.RATE_LIMIT_MAX, 100);

const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [];

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https://*.r2.cloudflarestorage.com", "https://lottie.host"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
}));

app.use(
  rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(cors({
  origin: (origin, callback) => {
    if (corsOrigin.length === 0) return callback(null, true);
    if (!origin) return callback(null, true);
    return callback(null, corsOrigin.includes(origin));
  },
  methods: ['GET', 'POST', 'OPTIONS']
}));
app.use(express.json({ limit: '1mb' }));

const upload = multer({
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;
const CODE_REGEX = /^[2-9A-HJ-NP-Z]{6}$/;

const generateCode = () => {
  const bytes = randomBytes(CODE_LENGTH);
  let result = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    result += CODE_CHARS.charAt(bytes[i] % CODE_CHARS.length);
  }
  return result;
};

const normalizeCode = (value) => String(value ?? '').trim().toUpperCase();
const isCodeValid = (code) => CODE_REGEX.test(code);

const allocateCode = async () => {
  for (let i = 0; i < 6; i += 1) {
    const code = generateCode();
    const exists = await getTransfer(code);
    if (!exists) return code;
  }
  throw new Error('Failed to allocate code');
};

const buildResponse = (transfer, extras = {}) => ({
  id: transfer.id,
  code: transfer.code,
  type: transfer.type,
  maxDownloads: transfer.maxDownloads,
  currentDownloads: transfer.currentDownloads,
  expiresAt: transfer.expiresAt,
  aiDescription: transfer.aiDescription,
  message: transfer.message,
  filename: transfer.filename,
  size: transfer.size,
  contentType: transfer.contentType,
  ...extras,
});

// POST /api/upload - 上传文件或文本
app.post('/api/upload', upload.single('file'), async (req, res, next) => {
  try {
    const type = String(req.body.type ?? '').toUpperCase();
    if (type !== 'FILE' && type !== 'TEXT') {
      return res.status(400).json({ error: 'Invalid type' });
    }

    const maxDownloads = parsePositiveInt(req.body.maxDownloads, 1);
    const aiDescription = typeof req.body.aiDescription === 'string' ? req.body.aiDescription : undefined;
    const ttlSeconds = Math.min(parsePositiveInt(req.body.ttlSeconds, DEFAULT_TTL_SECONDS), MAX_TTL_SECONDS);
    const expiresAt = Date.now() + ttlSeconds * 1000;
    const id = randomUUID();
    const code = await allocateCode();

    if (type === 'TEXT') {
      const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      const transfer = {
        id, code, type, maxDownloads,
        currentDownloads: 0, expiresAt, aiDescription, message,
      };

      await saveTransfer(code, transfer, ttlSeconds);
      return res.json(buildResponse(transfer));
    }

    const file = req.file;
    const filenameInput = file?.originalname || (typeof req.body.filename === 'string' ? req.body.filename : '');
    const filename = sanitizeFilename(filenameInput);
    const size = file?.size ?? parsePositiveInt(req.body.size, 0);
    const contentType = normalizeContentType(
      file?.mimetype || (typeof req.body.contentType === 'string' ? req.body.contentType : undefined)
    );

    if (!filename || !size) {
      return res.status(400).json({ error: 'File metadata is required' });
    }

    const r2Key = `packages/${id}`;
    const uploadUrl = await getPresignedUploadUrl(r2Key, contentType);

    const transfer = {
      id, code, type, maxDownloads,
      currentDownloads: 0, expiresAt, aiDescription,
      r2Key, filename, size, contentType,
    };

    await saveTransfer(code, transfer, ttlSeconds);
    return res.json(buildResponse(transfer, { uploadUrl }));
  } catch (error) {
    return next(error);
  }
});

// GET /api/file/:code - 获取文件信息（不含敏感内容）
app.get('/api/file/:code', async (req, res, next) => {
  try {
    const code = normalizeCode(req.params.code);
    if (!isCodeValid(code)) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    const transfer = await getTransfer(code);
    if (!transfer) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (transfer.expiresAt && Date.now() > transfer.expiresAt) {
      await deleteTransfer(code);
      if (transfer.r2Key) await deleteObject(transfer.r2Key);
      return res.status(404).json({ error: 'Not found' });
    }

    if (transfer.currentDownloads >= transfer.maxDownloads) {
      await deleteTransfer(code);
      if (transfer.r2Key) await deleteObject(transfer.r2Key);
      return res.status(404).json({ error: 'Not found' });
    }

    // 只返回元数据，不返回 downloadUrl 和 message
    return res.json({
      id: transfer.id,
      code: transfer.code,
      type: transfer.type,
      maxDownloads: transfer.maxDownloads,
      currentDownloads: transfer.currentDownloads,
      expiresAt: transfer.expiresAt,
      aiDescription: transfer.aiDescription,
      filename: transfer.filename,
      size: transfer.size,
      contentType: transfer.contentType,
    });
  } catch (error) {
    return next(error);
  }
});

// POST /api/consume/:code - 原子性消耗并返回内容
app.post('/api/consume/:code', async (req, res, next) => {
  try {
    const code = normalizeCode(req.params.code);
    if (!isCodeValid(code)) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    // 先检查记录是否存在，如果是文件类型则验证对象存在性
    const precheck = await getTransfer(code);
    if (!precheck) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (precheck.type === 'FILE') {
      if (!precheck.r2Key) {
        return res.status(500).json({ error: 'Missing file payload' });
      }
      // 检查 R2 对象是否存在，避免消耗计数后才发现文件不存在
      const exists = await objectExists(precheck.r2Key);
      if (!exists) {
        // 文件不存在，清理孤儿记录
        await deleteTransfer(code);
        return res.status(404).json({ error: 'File not found in storage' });
      }
    }

    const result = await consumeTransfer(code);
    if (!result) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (!result.consumed) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { transfer, currentDownloads, maxDownloads, burned } = result;

    let downloadUrl;
    let message;

    if (transfer.type === 'FILE') {
      if (!transfer.r2Key) {
        return res.status(500).json({ error: 'Missing file payload' });
      }
      downloadUrl = await getPresignedDownloadUrl(
        transfer.r2Key,
        transfer.filename,
        transfer.contentType
      );
    } else if (transfer.type === 'TEXT') {
      if (!transfer.message) {
        return res.status(500).json({ error: 'Missing message payload' });
      }
      message = transfer.message;
    }

    if (burned) {
      await deleteTransfer(code);
      if (transfer.r2Key) {
        const presignSeconds = Number.parseInt(process.env.R2_PRESIGN_EXPIRES_SECONDS ?? '300', 10);
        const deleteDelayMs = ((Number.isFinite(presignSeconds) && presignSeconds > 0 ? presignSeconds : 300) + 60) * 1000;
        const deleteAt = Date.now() + deleteDelayMs;

        // 持久化删除任务到 Redis（服务重启后可恢复）
        // 如果持久化失败，仍然使用 setTimeout 作为 fallback
        try {
          await schedulePendingDelete(transfer.r2Key, deleteAt);
        } catch (err) {
          console.error('Failed to schedule pending delete:', err);
        }

        // 正常流程：使用 setTimeout 执行删除
        setTimeout(async () => {
          try {
            const success = await deleteObjectWithRetry(transfer.r2Key);
            if (success) {
              await removePendingDelete(transfer.r2Key);
            }
          } catch (err) {
            console.error('Delayed delete callback error:', err);
          }
        }, deleteDelayMs);
      }
    }

    return res.json({
      currentDownloads,
      maxDownloads,
      burned,
      downloadUrl,
      message,
    });
  } catch (error) {
    return next(error);
  }
});

// POST /api/briefing - 生成任务简报 (Gemini AI)
app.post('/api/briefing', async (req, res) => {
  try {
    const { nameOrPreview, type } = req.body;

    if (!process.env.API_KEY) {
      return res.json({ briefing: "安全数据已加密并锁定。" });
    }

    const aiConfig = { apiKey: process.env.API_KEY };
    if (process.env.GEMINI_BASE_URL) {
      aiConfig.httpOptions = { baseUrl: process.env.GEMINI_BASE_URL };
    }
    const ai = new GoogleGenAI(aiConfig);

    let prompt = "";
    if (type === 'FILE') {
      prompt = `你是一名秘密特工联络员。一个名为 "${nameOrPreview}" 的文件刚刚被上传到死信箱。请用中文写一句非常简短、酷炫的"任务简报"来描述这个包裹。语气要像间谍行动或科幻数据传输。例如："截获来自第七区的加密图纸。" 或 "轨道武器系统的核心代码已锁定。"不要包含引号。`;
    } else {
      const preview = String(nameOrPreview || '').substring(0, 20);
      prompt = `你是一名秘密特工联络员。一段秘密留言刚刚被加密上传。内容片段(仅供参考风格，不要直接复述内容): "${preview}..."。请用中文写一句非常简短、酷炫的"情报摘要"来描述这条消息。语气要神秘、紧迫。例如："收到代号'夜莺'的紧急加密通讯。" 或 "来自前线的最高机密指令。"不要包含引号。`;
    }

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
      contents: prompt,
    });

    return res.json({ briefing: response.text || "安全数据已加密并锁定。" });
  } catch (error) {
    console.error("Gemini briefing error:", error);
    return res.json({ briefing: "安全数据已加密并锁定。" });
  }
});

// 静态文件服务 - 托管前端构建产物
const distPath = join(__dirname, 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(join(distPath, 'index.html'));
  });
}

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((error, req, res, next) => {
  console.error(error);
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.message });
  }
  return res.status(500).json({ error: 'Internal server error' });
});

// 处理遗留的待删除任务（服务重启后恢复）
let isProcessingDeletes = false;
const processPendingDeletes = async () => {
  if (isProcessingDeletes) return; // 防止重叠执行
  isProcessingDeletes = true;
  try {
    const pendingKeys = await getPendingDeletes(Date.now());
    for (const r2Key of pendingKeys) {
      const success = await deleteObjectWithRetry(r2Key);
      if (success) {
        await removePendingDelete(r2Key);
        console.log(`Recovered pending delete: ${r2Key}`);
      }
    }
  } catch (error) {
    console.error('Failed to process pending deletes:', error);
  } finally {
    isProcessingDeletes = false;
  }
};

app.listen(PORT, async () => {
  console.log(`API server listening on ${PORT}`);
  await processPendingDeletes();
  // 每 5 分钟检查一次到期任务
  setInterval(processPendingDeletes, 5 * 60 * 1000);
});
