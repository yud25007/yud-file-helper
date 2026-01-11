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
  aiDescription: string
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

    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': content.type || 'application/octet-stream'
      },
      body: content
    });

    if (!uploadResponse.ok) {
      throw new Error('File upload failed');
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
