import React, { useState } from 'react';
import { Download, Lock, FileCheck, EyeOff, Loader2, AlertCircle, Copy, Check, MessageSquare } from 'lucide-react';
import { Button } from './GlassCard';
import { getFile, incrementDownload } from '../services/storage';
import { TransferFile } from '../types';

export const RetrieveView: React.FC = () => {
  const [code, setCode] = useState('');
  const [foundFile, setFoundFile] = useState<TransferFile | null>(null);
  const [error, setError] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const [isRevealed, setIsRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revealedMessage, setRevealedMessage] = useState('');
  const [fileMeta, setFileMeta] = useState<{ filename?: string; size?: number } | null>(null);

  const handleSearch = async () => {
    if (code.length < 6) return;
    setIsSearching(true);
    setError('');
    setIsRevealed(false);
    setRevealedMessage('');
    setFileMeta(null);

    try {
      const result = await getFile(code);
      if (result) {
        setFoundFile(result.transfer);
        setFileMeta({
          filename: result.filename,
          size: result.size
        });
      } else {
        setFoundFile(null);
        setError('无效的提取码或文件已销毁。');
      }
    } catch (lookupError) {
      console.error('Lookup failed:', lookupError);
      setFoundFile(null);
      setError('解析失败，请稍后再试。');
    } finally {
      setIsSearching(false);
    }
  };

  const handleDownloadFile = async () => {
    if (!foundFile) return;
    setIsDownloading(true);
    setError('');

    try {
      const result = await incrementDownload(code);
      if (!result || !result.downloadUrl) {
        setError('提取失败，文件已销毁或链接已过期。');
        return;
      }

      setFoundFile(prev => prev ? {
        ...prev,
        currentDownloads: result.currentDownloads,
        maxDownloads: result.maxDownloads
      } : null);

      const link = document.createElement('a');
      link.href = result.downloadUrl;
      if (fileMeta?.filename) {
        link.download = fileMeta.filename;
      }
      link.rel = 'noopener';
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Download failed:', err);
      setError('提取失败，请稍后再试。');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleRevealText = async () => {
    if (!foundFile || isRevealing) return;
    setError('');
    setIsRevealing(true);

    try {
      const result = await incrementDownload(code);
      if (!result || !result.message) {
        setError('内容已销毁或无法解密。');
        return;
      }

      setFoundFile(prev => prev ? {
        ...prev,
        currentDownloads: result.currentDownloads,
        maxDownloads: result.maxDownloads
      } : null);
      setRevealedMessage(result.message);
      setIsRevealed(true);
    } catch (err) {
      console.error('Reveal failed:', err);
      setError('解密失败，请稍后再试。');
    } finally {
      setIsRevealing(false);
    }
  };

  const handleCopyText = async () => {
    if (!revealedMessage) return;
    try {
      await navigator.clipboard.writeText(revealedMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (copyError) {
      console.error('Copy failed:', copyError);
      setError('复制失败，请检查浏览器权限。');
    }
  };

  // View: Success/Found
  if (foundFile) {
    const isBurned = foundFile.currentDownloads >= foundFile.maxDownloads;
    const isText = foundFile.type === 'TEXT';

    return (
      <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-50 text-green-600 mb-2 shadow-inner">
            {isText ? <MessageSquare className="w-8 h-8" /> : <FileCheck className="w-8 h-8" />}
          </div>
          <h3 className="text-xl font-bold text-gray-900">
            {isText ? '机密留言锁定' : '文件包裹锁定'}
          </h3>
          <p className="text-sm text-gray-500 max-w-xs mx-auto">
            {foundFile.aiDescription || "准备进行安全提取。"}
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 p-3 rounded-xl animate-in slide-in-from-top-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {!isText ? (
          /* FILE CARD */
          <div className="p-6 rounded-[32px] bg-white border border-gray-100 shadow-sm space-y-4">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-400 font-medium">文件名</span>
              <span className="text-gray-900 font-semibold truncate max-w-[150px]">{fileMeta?.filename || '未知文件'}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-400 font-medium">大小</span>
              <span className="text-gray-900 font-semibold">{fileMeta?.size ? (fileMeta.size / 1024 / 1024).toFixed(2) : '--'} MB</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-400 font-medium">剩余次数</span>
              <span className="text-orange-500 font-bold">{Math.max(0, foundFile.maxDownloads - foundFile.currentDownloads)}</span>
            </div>
          </div>
        ) : (
          /* TEXT CARD */
          <div className="p-6 rounded-[32px] bg-white border border-gray-100 shadow-sm space-y-4 relative overflow-hidden">
            {isRevealed ? (
              <div className="animate-in fade-in duration-500">
                <div className="text-sm text-gray-400 font-medium mb-2 uppercase tracking-wider">留言内容</div>
                <div className="text-gray-900 font-medium leading-relaxed break-words max-h-40 overflow-y-auto pr-2">
                   "{revealedMessage}"
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 gap-3 text-gray-400">
                <Lock className="w-8 h-8 opacity-50" />
                <span className="text-xs font-bold uppercase tracking-widest">内容已加密隐藏</span>
              </div>
            )}

            <div className="h-px bg-gray-100 w-full my-2" />
            <div className="flex justify-between items-center text-sm">
               <span className="text-gray-400 font-medium">剩余查看次数</span>
               <span className="text-orange-500 font-bold">{Math.max(0, foundFile.maxDownloads - foundFile.currentDownloads)}</span>
            </div>
          </div>
        )}

        {isBurned && (!isText || (isText && !isRevealed)) ? (
          <Button disabled className="w-full opacity-50 cursor-not-allowed bg-gray-200 text-gray-500">
            <EyeOff className="w-5 h-5" />
            内容已销毁
          </Button>
        ) : (
          <>
            {isText ? (
              isRevealed ? (
                 <Button onClick={handleCopyText} className="w-full" variant="secondary">
                   {copied ? <Check className="w-5 h-5 text-green-600" /> : <Copy className="w-5 h-5" />}
                   {copied ? '已复制' : '复制留言'}
                 </Button>
              ) : (
                <Button onClick={handleRevealText} className="w-full" disabled={isRevealing || isBurned}>
                  {isRevealing ? <Loader2 className="w-5 h-5 animate-spin"/> : <Lock className="w-5 h-5" />}
                  {isRevealing ? '解密中...' : '解密并查看'}
                </Button>
              )
            ) : (
              <Button onClick={handleDownloadFile} className="w-full" disabled={isDownloading || isBurned}>
                {isDownloading ? <Loader2 className="w-5 h-5 animate-spin"/> : <Download className="w-5 h-5" />}
                提取文件
              </Button>
            )}
          </>
        )}
      </div>
    );
  }

  // View: Search
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-2">
          提取码
        </label>
        <div className="relative group">
          <input
            type="text"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXXXX"
            className="
              w-full h-20 text-center text-3xl font-mono tracking-[0.5em] font-bold text-gray-900
              bg-gray-100/50 border border-transparent rounded-[28px]
              focus:bg-white focus:border-gray-200 focus:ring-4 focus:ring-gray-100 focus:shadow-inner
              outline-none transition-all duration-300 placeholder-gray-300
            "
          />
          <div className="absolute right-6 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-gray-400 transition-colors">
            <Lock className="w-6 h-6" />
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 p-3 rounded-xl animate-in slide-in-from-top-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <Button
        onClick={handleSearch}
        disabled={code.length < 6 || isSearching}
        className="w-full"
      >
        {isSearching ? <Loader2 className="w-5 h-5 animate-spin"/> : '解析并提取'}
      </Button>
    </div>
  );
};
