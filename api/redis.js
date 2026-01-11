import Redis from 'ioredis';

const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL)
  : new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number.parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
    });

redis.on('error', (error) => {
  console.error('Redis connection error:', error);
});

const KEY_PREFIX = process.env.REDIS_PREFIX || 'transfer:';
const keyFor = (code) => `${KEY_PREFIX}${code.toUpperCase()}`;

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
  const pipeline = redis.multi();
  pipeline.hset(key, data);
  if (ttlSeconds) {
    pipeline.expire(key, ttlSeconds);
  }
  await pipeline.exec();
};

export const getTransfer = async (code) => {
  const data = await redis.hgetall(keyFor(code));
  return deserialize(data);
};

export const incrementDownloads = async (code) => {
  const key = keyFor(code);
  const exists = await redis.exists(key);
  if (!exists) return null;
  const result = await redis.multi().hincrby(key, 'currentDownloads', 1).hgetall(key).exec();
  if (!result) return null;
  const data = result[1]?.[1];
  if (!data || Object.keys(data).length === 0) return null;
  const count = result[0]?.[1];
  if (count != null) {
    data.currentDownloads = String(count);
  }
  return deserialize(data);
};

export const deleteTransfer = async (code) => {
  await redis.del(keyFor(code));
};
