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

// Lua 脚本：原子性检查、消耗并返回完整数据
// 注意：使用 table.unpack 兼容 Redis 5+/7+
const CONSUME_LUA = `
local key = KEYS[1]
if redis.call('EXISTS', key) == 0 then return nil end
local max = tonumber(redis.call('HGET', key, 'maxDownloads') or '0')
local current = tonumber(redis.call('HGET', key, 'currentDownloads') or '0')
if max > 0 and current >= max then
  return {0, current, max}
end
local newCount = redis.call('HINCRBY', key, 'currentDownloads', 1)
local burned = 0
if max > 0 and newCount >= max then burned = 1 end
local data = redis.call('HGETALL', key)
local result = {1, newCount, max, burned}
for i, v in ipairs(data) do
  result[#result + 1] = v
end
return result
`;

export const consumeTransfer = async (code) => {
  const key = keyFor(code);
  const result = await redis.eval(CONSUME_LUA, 1, key);
  if (!result) return null;

  const [consumed, currentDownloads, maxDownloads, burned, ...pairs] = result;
  if (!consumed) {
    return { consumed: false, currentDownloads, maxDownloads, burned: true, transfer: null };
  }

  const data = {};
  for (let i = 0; i < pairs.length; i += 2) {
    data[pairs[i]] = pairs[i + 1];
  }
  if (Object.keys(data).length === 0) return null;

  return {
    consumed: true,
    currentDownloads,
    maxDownloads,
    burned: Boolean(burned),
    transfer: deserialize(data),
  };
};

export const deleteTransfer = async (code) => {
  await redis.del(keyFor(code));
};

// 待删除队列（用于持久化延迟删除任务）
const PENDING_DELETE_KEY = `${KEY_PREFIX}pendingDelete:queue`;

/**
 * 调度待删除任务
 * @param {string} r2Key - R2 对象的 Key
 * @param {number} deleteAt - 删除时间戳（毫秒）
 */
export const schedulePendingDelete = async (r2Key, deleteAt) => {
  await redis.zadd(PENDING_DELETE_KEY, deleteAt, r2Key);
};

/**
 * 获取到期的待删除任务
 * @param {number} beforeTimestamp - 截止时间戳（毫秒）
 * @returns {Promise<string[]>} 待删除的 R2 Keys
 */
export const getPendingDeletes = async (beforeTimestamp) => {
  return redis.zrangebyscore(PENDING_DELETE_KEY, 0, beforeTimestamp);
};

/**
 * 移除已处理的待删除任务
 * @param {string} r2Key - R2 对象的 Key
 */
export const removePendingDelete = async (r2Key) => {
  await redis.zrem(PENDING_DELETE_KEY, r2Key);
};
