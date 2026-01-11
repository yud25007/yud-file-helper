import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { getPresignedUploadUrl, getPresignedDownloadUrl, deleteObject } from './api/r2.js';
import { saveTransfer, getTransfer, incrementDownloads, deleteTransfer } from './api/redis.js';

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
const MAX_DOWNLOADS = parsePositiveInt(process.env.MAX_DOWNLOADS, 10);
const MAX_UPLOAD_BYTES = parsePositiveInt(process.env.MAX_UPLOAD_BYTES, 50 * 1024 * 1024);
const RATE_LIMIT_WINDOW_MS = parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
const RATE_LIMIT_MAX = parsePositiveInt(process.env.RATE_LIMIT_MAX, 100);

const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
  : '*';

app.set('trust proxy', 1);

app.use(
  rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(cors({ origin: corsOrigin, methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const generateCode = () => {
  let result = '';
  for (let i = 0; i < 6; i += 1) {
    result += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
  }
  return result;
};

const normalizeCode = (value) => String(value ?? '').trim().toUpperCase();
const isCodeValid = (code) => code.length === 6;

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

    const maxDownloadsInput = parsePositiveInt(req.body.maxDownloads, 1);
    const maxDownloads = Math.min(maxDownloadsInput, MAX_DOWNLOADS);
    const aiDescription = typeof req.body.aiDescription === 'string' ? req.body.aiDescription : undefined;
    const ttlSeconds = parsePositiveInt(req.body.ttlSeconds, DEFAULT_TTL_SECONDS);
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
    const filename = file?.originalname || (typeof req.body.filename === 'string' ? req.body.filename : '');
    const size = file?.size ?? parsePositiveInt(req.body.size, 0);
    const contentType = file?.mimetype || (typeof req.body.contentType === 'string' ? req.body.contentType : 'application/octet-stream');

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

// GET /api/file/:code - 获取文件信息
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

    let downloadUrl;
    if (transfer.type === 'FILE' && transfer.r2Key) {
      downloadUrl = await getPresignedDownloadUrl(transfer.r2Key);
    }

    return res.json(buildResponse(transfer, downloadUrl ? { downloadUrl } : {}));
  } catch (error) {
    return next(error);
  }
});

// POST /api/consume/:code - 消耗下载次数
app.post('/api/consume/:code', async (req, res, next) => {
  try {
    const code = normalizeCode(req.params.code);
    if (!isCodeValid(code)) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    const transfer = await incrementDownloads(code);
    if (!transfer) {
      return res.status(404).json({ error: 'Not found' });
    }

    const burned = transfer.currentDownloads >= transfer.maxDownloads;
    if (burned) {
      await deleteTransfer(code);
      if (transfer.r2Key) await deleteObject(transfer.r2Key);
    }

    return res.json({
      currentDownloads: transfer.currentDownloads,
      maxDownloads: transfer.maxDownloads,
      burned,
    });
  } catch (error) {
    return next(error);
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

app.listen(PORT, () => {
  console.log(`API server listening on ${PORT}`);
});
