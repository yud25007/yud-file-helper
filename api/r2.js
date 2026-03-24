import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
const STORAGE_UNAVAILABLE_MESSAGE = 'Storage service unavailable';

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
const SIGNED_URL_TTL = Number.parseInt(process.env.R2_PRESIGN_EXPIRES_SECONDS ?? '900', 10); // 15 minutes for large files

const client = R2_CONFIGURED ? new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
}) : null;

const createStorageError = (message, options = {}) => {
  const error = new Error(message);
  error.name = options.name || 'StorageError';
  error.statusCode = options.statusCode ?? 503;
  error.publicMessage = options.publicMessage ?? STORAGE_UNAVAILABLE_MESSAGE;
  error.details = options.details;
  if (options.cause) {
    error.cause = options.cause;
  }
  return error;
};

const ensureClient = (operation, key) => {
  if (client) {
    return client;
  }

  throw createStorageError('R2 storage not configured', {
    details: {
      operation,
      key,
      reason: 'not_configured',
    },
  });
};

const getErrorDetails = (error) => ({
  status: error?.$metadata?.httpStatusCode,
  name: error?.name,
  code: error?.Code ?? error?.code,
  message: error?.message,
});

export const getPresignedUploadUrl = async (key, contentType) => {
  const r2Client = ensureClient('PutObject', key);
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(r2Client, command, { expiresIn: SIGNED_URL_TTL });
};

export const getPresignedDownloadUrl = async (key, filename, contentType) => {
  const r2Client = ensureClient('GetObject', key);

  // 清理文件名：移除路径、控制字符
  const sanitizeFilename = (value) => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    const baseName = trimmed.split(/[\\/]/).pop();
    return baseName.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  };

  // RFC 5987 编码
  const encodeRFC5987 = (str) =>
    encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

  // 构建 Content-Disposition
  const buildContentDisposition = (fname) => {
    const safeName = sanitizeFilename(fname);
    if (!safeName) return 'attachment';
    const asciiFallback = safeName
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/["\\]/g, '_')
      .trim() || 'download';
    return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRFC5987(safeName)}`;
  };

  // 规范化 Content-Type
  const normalizeContentType = (value) => {
    if (typeof value !== 'string') return 'application/octet-stream';
    const trimmed = value.trim();
    if (!trimmed || /[\r\n]/.test(trimmed)) return 'application/octet-stream';
    return trimmed;
  };

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ResponseContentDisposition: buildContentDisposition(filename),
    ResponseContentType: normalizeContentType(contentType),
  });
  return getSignedUrl(r2Client, command, { expiresIn: SIGNED_URL_TTL });
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
  if (!key) return false;

  const r2Client = ensureClient('HeadObject', key);
  const command = new HeadObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
  });
  try {
    await r2Client.send(command);
    return true;
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    const code = error?.Code ?? error?.code;
    if (status === 404 || error?.name === 'NotFound' || code === 'NoSuchKey' || code === 'NotFound') {
      return false;
    }

    throw createStorageError('R2 object check failed', {
      details: {
        operation: 'HeadObject',
        key,
        ...getErrorDetails(error),
      },
      cause: error,
    });
  }
};
