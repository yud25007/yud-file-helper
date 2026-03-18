import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
      tls: process.env.REDIS_URL.includes('leapcell.cloud') ? {
        rejectUnauthorized: false
      } : undefined,
      maxRetriesPerRequest: 3,
    })
  : new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number.parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
    });

redis.on('error', (error) => {
  console.error('Redis connection error:', error);
});

const KEY_PREFIX = process.env.REDIS_PREFIX || 'transfer:';
const LOCK_TTL_MS = Number.parseInt(process.env.REDIS_LOCK_TTL_MS || '5000', 10);
const LOCK_RETRY_DELAY_MS = Number.parseInt(process.env.REDIS_LOCK_RETRY_DELAY_MS || '100', 10);
const LOCK_MAX_ATTEMPTS = Number.parseInt(process.env.REDIS_LOCK_MAX_ATTEMPTS || '50', 10);
const keyFor = (code) => `${KEY_PREFIX}${code.toUpperCase()}`;
const lockKeyFor = (code) => `${keyFor(code)}:lock`;

const serialize = (metadata) => ({
  id: metadata.id ?? '',
  code: metadata.code ?? '',
  type: metadata.type ?? '',
  maxDownloads: String(metadata.maxDownloads ?? 0),
  currentDownloads: String(metadata.currentDownloads ?? 0),
  expiresAt: metadata.expiresAt ? String(metadata.expiresAt) : '',
  aiDescription: metadata.aiDescription ?? '',
  message: metadata.message ?? '',
  r2Key: metadata.r2Key ?? '',
  filename: metadata.filename ?? '',
  contentType: metadata.contentType ?? '',
  size: metadata.size != null ? String(metadata.size) : '',
});

const parseNumber = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseOptionalNumber = (value) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const acquireLock = async (code) => {
  const lockKey = lockKeyFor(code);
  const token = randomUUID();

  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
    const acquired = await redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX');
    if (acquired === 'OK') {
      return { lockKey, token };
    }
    await sleep(LOCK_RETRY_DELAY_MS);
  }

  throw new Error('Failed to acquire transfer lock');
};

const releaseLock = async ({ lockKey, token }) => {
  if (!lockKey || !token) return;

  try {
    const currentToken = await redis.get(lockKey);
    if (currentToken === token) {
      await redis.del(lockKey);
    }
  } catch (error) {
    console.error('Failed to release Redis lock:', error);
  }
};

const deserialize = (data) => {
  if (!data || Object.keys(data).length === 0) return null;
  return {
    id: data.id,
    code: data.code,
    type: data.type,
    maxDownloads: parseNumber(data.maxDownloads),
    currentDownloads: parseNumber(data.currentDownloads),
    expiresAt: data.expiresAt ? parseOptionalNumber(data.expiresAt) : undefined,
    aiDescription: data.aiDescription || undefined,
    message: data.message || undefined,
    r2Key: data.r2Key || undefined,
    filename: data.filename || undefined,
    contentType: data.contentType || undefined,
    size: data.size ? parseNumber(data.size) : undefined,
  };
};

export const saveTransfer = async (code, metadata, ttlSeconds) => {
  const key = keyFor(code);
  const data = serialize(metadata);
  for (const [field, value] of Object.entries(data)) {
    if (value === '') continue;
    await redis.hset(key, field, value);
  }
  if (ttlSeconds) {
    await redis.expire(key, ttlSeconds);
  }
};

export const getTransfer = async (code) => {
  const data = await redis.hgetall(keyFor(code));
  return deserialize(data);
};

export const consumeTransfer = async (code) => {
  const key = keyFor(code);
  const lock = await acquireLock(code);

  try {
    const exists = await redis.exists(key);
    if (!exists) {
      return null;
    }

    const data = await redis.hgetall(key);
    const maxDownloads = parseNumber(data.maxDownloads);
    const currentDownloads = parseNumber(data.currentDownloads);

    if (maxDownloads > 0 && currentDownloads >= maxDownloads) {
      return {
        consumed: false,
        currentDownloads,
        maxDownloads,
        burned: true,
        transfer: null
      };
    }

    const newCount = currentDownloads + 1;
    await redis.hset(key, 'currentDownloads', String(newCount));

    const burned = maxDownloads > 0 && newCount >= maxDownloads;
    data.currentDownloads = String(newCount);

    return {
      consumed: true,
      currentDownloads: newCount,
      maxDownloads,
      burned,
      transfer: deserialize(data),
    };
  } finally {
    await releaseLock(lock);
  }
};

export const deleteTransfer = async (code) => {
  await redis.del(keyFor(code));
};
