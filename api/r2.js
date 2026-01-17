import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { sanitizeFilename, normalizeContentType, buildContentDisposition } from '../utils/sanitize.js';

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;

const R2_CONFIGURED = R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET;

if (!R2_CONFIGURED) {
  console.warn('Warning: R2 configuration incomplete. File uploads will fail.');
  console.warn('Required: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET');
} else {
  // 检查环境变量是否包含无效字符
  const invalidChars = /[<>]/;
  if (invalidChars.test(R2_ACCOUNT_ID) || invalidChars.test(R2_ACCESS_KEY_ID) || invalidChars.test(R2_SECRET_ACCESS_KEY)) {
    console.error('ERROR: R2 credentials contain invalid characters (<>). Please remove angle brackets from environment variables.');
  }
}

const R2_ENDPOINT = R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '';
const SIGNED_URL_TTL = Number.parseInt(process.env.R2_PRESIGN_EXPIRES_SECONDS ?? '300', 10);

const client = R2_CONFIGURED ? new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
}) : null;

export const getPresignedUploadUrl = async (key, contentType) => {
  if (!client) {
    throw new Error('R2 storage not configured');
  }
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn: SIGNED_URL_TTL });
};

export const getPresignedDownloadUrl = async (key, filename, contentType) => {
  if (!client) {
    throw new Error('R2 storage not configured');
  }

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ResponseContentDisposition: buildContentDisposition(filename),
    ResponseContentType: normalizeContentType(contentType),
  });
  return getSignedUrl(client, command, { expiresIn: SIGNED_URL_TTL });
};

export const deleteObject = async (key) => {
  if (!key || !client) return;
  const command = new DeleteObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
  });
  await client.send(command);
};

export const objectExists = async (key) => {
  if (!key || !client) return false;
  const command = new HeadObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
  });
  try {
    await client.send(command);
    return true;
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || error?.name === 'NotFound' || error?.Code === 'NoSuchKey') {
      return false;
    }
    throw error;
  }
};

/**
 * 带重试的删除函数（指数退避）
 * @param {string} key - R2 对象的 Key
 * @param {number} maxRetries - 最大重试次数（默认 3）
 * @returns {Promise<boolean>} 是否成功删除
 */
export const deleteObjectWithRetry = async (key, maxRetries = 3) => {
  if (!key) return true; // 空 key 视为"无需删除"
  if (!client) {
    console.error('R2 client not configured, cannot delete:', key);
    return false; // 客户端未配置，无法删除
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await deleteObject(key);
      return true;
    } catch (error) {
      console.error(`R2 delete attempt ${attempt}/${maxRetries} failed for ${key}:`, error.message);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }
  return false;
};
