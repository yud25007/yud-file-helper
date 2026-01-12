import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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

export const getPresignedDownloadUrl = async (key) => {
  if (!client) {
    throw new Error('R2 storage not configured');
  }
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
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
