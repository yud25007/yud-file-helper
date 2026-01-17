// 安全消毒公共模块
// 防止路径注入、控制字符注入、响应头注入和 Unicode 双向控制符攻击

const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/**
 * 清理文件名：移除路径、控制字符、双向控制符，限制长度
 * @param {string} value - 原始文件名
 * @param {number} maxLength - 最大长度（默认 200）
 * @returns {string} 清理后的文件名
 */
export const sanitizeFilename = (value, maxLength = 200) => {
  if (typeof value !== 'string') return '';
  let result = value.trim();
  if (!result) return '';
  result = result.split(/[\\/]/).pop() || '';
  result = result.replace(CONTROL_CHARS, '').replace(BIDI_CONTROLS, '').trim();
  return result.slice(0, maxLength);
};

/**
 * 规范化 Content-Type：过滤所有控制字符，防止响应头注入
 * @param {string} value - 原始 Content-Type
 * @returns {string} 规范化后的 Content-Type
 */
export const normalizeContentType = (value) => {
  if (typeof value !== 'string') return 'application/octet-stream';
  const trimmed = value.trim();
  if (!trimmed || /[\x00-\x1F\x7F]/.test(trimmed)) return 'application/octet-stream';
  return trimmed;
};

/**
 * RFC 5987 编码（用于 Content-Disposition filename*）
 * @param {string} str - 原始字符串
 * @returns {string} 编码后的字符串
 */
export const encodeRFC5987 = (str) =>
  encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * 构建 Content-Disposition 头
 * @param {string} fname - 文件名
 * @returns {string} Content-Disposition 值
 */
export const buildContentDisposition = (fname) => {
  const safeName = sanitizeFilename(fname);
  if (!safeName) return 'attachment';
  const asciiFallback = safeName
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_')
    .trim() || 'download';
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRFC5987(safeName)}`;
};
