import { TransferFile, TransferType } from '../types';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const API_PREFIX = API_BASE_URL ? `${API_BASE_URL}/api` : '/api';

const parseJson = async (response: Response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const parseNumber = (value: unknown, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseOptionalNumber = (value: unknown) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const requestJson = async (input: RequestInfo, init?: RequestInit) => {
  const response = await fetch(input, init);
  const data = await parseJson(response);
  if (!response.ok) {
    const message = data?.error || 'Request failed';
    throw new Error(message);
  }
  return data;
};

export const savePackage = async (
  content: File | string,
  type: TransferType,
  maxDownloads: number,
  aiDescription: string,
  onProgress?: (percent: number) => void
): Promise<TransferFile> => {
  const formData = new FormData();
  formData.append('type', type);
  formData.append('maxDownloads', String(maxDownloads));
  if (aiDescription) {
    formData.append('aiDescription', aiDescription);
  }

  if (type === 'FILE' && content instanceof File) {
    formData.append('filename', content.name);
    formData.append('size', String(content.size));
    formData.append('contentType', content.type || 'application/octet-stream');
  } else if (type === 'TEXT' && typeof content === 'string') {
    formData.append('message', content);
  }

  const data = await requestJson(`${API_PREFIX}/upload`, {
    method: 'POST',
    body: formData
  });

  if (type === 'FILE' && content instanceof File) {
    const uploadUrl = data?.uploadUrl;
    if (!uploadUrl) {
      throw new Error('Missing upload URL');
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', content.type || 'application/octet-stream');

        if (onProgress) {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              onProgress(Math.round((e.loaded / e.total) * 100));
            }
          };
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            console.error('R2 upload failed:', xhr.status, xhr.responseText);
            if (xhr.status === 403) {
              reject(new Error('存储服务认证失败，请检查 R2 CORS 配置'));
            } else {
              reject(new Error(`存储服务返回错误 (${xhr.status})`));
            }
          }
        };

        xhr.onerror = () => {
          console.error('R2 upload network error');
          reject(new Error('网络连接错误或被 CORS 策略阻止，请检查 R2 配置'));
        };

        xhr.ontimeout = () => {
          reject(new Error('上传超时，请检查网络连接'));
        };

        xhr.send(content);
      });
    } catch (uploadError) {
      console.error('R2 upload error:', uploadError);
      throw uploadError;
    }
  }

  const transferFile: TransferFile = {
    id: data.id,
    type: data.type,
    code: data.code,
    maxDownloads: parseNumber(data.maxDownloads, maxDownloads),
    currentDownloads: parseNumber(data.currentDownloads, 0),
    aiDescription: data.aiDescription,
    expiresAt: parseOptionalNumber(data.expiresAt)
  };

  if (data.type === 'TEXT' && typeof data.message === 'string') {
    transferFile.message = data.message;
  }

  return transferFile;
};

export interface FileResult {
  transfer: TransferFile;
  filename?: string;
  size?: number;
}

export const getFile = async (code: string): Promise<FileResult | null> => {
  const response = await fetch(`${API_PREFIX}/file/${encodeURIComponent(code.toUpperCase())}`);
  if (response.status === 404) return null;
  const data = await parseJson(response);
  if (!response.ok) {
    const message = data?.error || 'Request failed';
    throw new Error(message);
  }

  const transferFile: TransferFile = {
    id: data.id,
    type: data.type,
    code: data.code,
    maxDownloads: parseNumber(data.maxDownloads, 1),
    currentDownloads: parseNumber(data.currentDownloads, 0),
    aiDescription: data.aiDescription,
    expiresAt: parseOptionalNumber(data.expiresAt)
  };

  if (data.type === 'TEXT' && typeof data.message === 'string') {
    transferFile.message = data.message;
  }

  return {
    transfer: transferFile,
    filename: typeof data.filename === 'string' ? data.filename : undefined,
    size: parseOptionalNumber(data.size)
  };
};

export interface ConsumeResult {
  currentDownloads: number;
  maxDownloads: number;
  burned: boolean;
  downloadUrl?: string;
  message?: string;
}

export const incrementDownload = async (code: string): Promise<ConsumeResult | null> => {
  const response = await fetch(`${API_PREFIX}/consume/${encodeURIComponent(code.toUpperCase())}`, {
    method: 'POST'
  });
  if (response.status === 404) return null;
  const data = await parseJson(response);
  if (!response.ok) {
    const message = data?.error || 'Request failed';
    throw new Error(message);
  }
  return data;
};
