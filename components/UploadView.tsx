import React, { useState, useRef } from 'react';
import { Upload, File as FileIcon, Zap, Shield, Loader2, MessageSquare, X, Package } from 'lucide-react';
import { zip } from 'fflate';
import { Button } from './GlassCard';
import { savePackage } from '../services/storage';
import { generateMissionBriefing } from '../services/gemini';
import { TransferFile, TransferType } from '../types';

interface UploadViewProps {
  onSuccess: (fileData: TransferFile) => void;
}

const MAX_FILES = 50;
const MAX_TOTAL_SIZE = 1024 * 1024 * 1024; // 1GB

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const getUploadErrorMessage = (error: unknown): string => {
  if (error instanceof DOMException) {
    if (error.name === 'SecurityError') {
      return '浏览器阻止了打包所需的 Worker，请检查站点 CSP 配置后重试。';
    }

    if (error.name === 'NotFoundError') {
      return '无法读取或打包所选文件。文件可能已被移动、删除，或站点未放行 blob Worker。请重新选择文件后重试。';
    }
  }

  if (error instanceof Error) {
    const lowerMessage = error.message.toLowerCase();
    if (
      lowerMessage.includes('content security policy') ||
      lowerMessage.includes('worker') ||
      lowerMessage.includes('blob:')
    ) {
      return '浏览器阻止了打包所需的 Worker，请检查站点 CSP 配置后重试。';
    }

    return error.message;
  }

  return '上传失败，请稍后重试。';
};

export const UploadView: React.FC<UploadViewProps> = ({ onSuccess }) => {
  const [activeTab, setActiveTab] = useState<TransferType>('FILE');
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState<string>('');

  const [limit, setLimit] = useState<number>(1);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'zipping' | 'uploading'>('idle');
  const [zipProgress, setZipProgress] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const isOverFileLimit = files.length > MAX_FILES;
  const isOverSizeLimit = totalSize > MAX_TOTAL_SIZE;
  const hasValidationError = isOverFileLimit || isOverSizeLimit;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (activeTab === 'FILE') setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (activeTab === 'FILE' && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const newFiles = Array.from(e.dataTransfer.files);
      setFiles(prev => [...prev, ...newFiles]);
      setError('');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files);
      setFiles(prev => [...prev, ...newFiles]);
      setError('');
    }
    // Reset input value to allow selecting the same file again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (activeTab === 'FILE' && files.length === 0) return;
    if (activeTab === 'TEXT' && !message.trim()) return;
    if (hasValidationError) return;

    setIsProcessing(true);
    setError('');
    setUploadPhase('idle');
    setZipProgress(0);
    setUploadProgress(0);

    try {
      if (activeTab === 'TEXT') {
        // Text upload - no change
        const briefingPromise = generateMissionBriefing(message, activeTab)
          .catch(err => {
            console.warn('Briefing generation failed:', err);
            return '安全数据已加密并锁定。';
          });

        const missionBriefing = await Promise.race([
          briefingPromise,
          new Promise<string>(resolve => setTimeout(() => resolve('安全数据已加密并锁定。'), 5000))
        ]);

        const storedFile = await savePackage(message, activeTab, limit, missionBriefing, (p) => {
          setUploadProgress(p);
        });
        onSuccess(storedFile);
      } else {
        // Multiple files - ZIP and upload
        setUploadPhase('zipping');

        // Generate briefing based on file count
        const briefingInput = files.length === 1
          ? files[0].name
          : `${files.length}个文件打包`;

        const briefingPromise = generateMissionBriefing(briefingInput, activeTab)
          .catch(() => '安全数据已加密并锁定。');

        // Build fflate input
        const zipInput: Record<string, Uint8Array> = {};
        const fileNames = new Set<string>();

        for (const file of files) {
          let buffer: ArrayBuffer;
          try {
            buffer = await file.arrayBuffer();
          } catch (error) {
            throw new Error(`无法读取文件“${file.name}”，请确认文件仍存在并重新选择后重试。`, {
              cause: error
            });
          }
          // Handle duplicate file names
          let name = file.name;
          let counter = 1;
          while (fileNames.has(name)) {
            const ext = file.name.lastIndexOf('.');
            if (ext > 0) {
              name = `${file.name.substring(0, ext)} (${counter})${file.name.substring(ext)}`;
            } else {
              name = `${file.name} (${counter})`;
            }
            counter++;
          }
          fileNames.add(name);
          zipInput[name] = new Uint8Array(buffer);
        }

        // ZIP compression with progress
        const zipBlob = await new Promise<Blob>((resolve, reject) => {
          zip(zipInput, { level: 6 }, (err, data) => {
            if (err) reject(err);
            else resolve(new Blob([data], { type: 'application/zip' }));
          });
        });

        setZipProgress(100);
        setUploadPhase('uploading');

        // Create File object for upload
        const timestamp = new Date().toISOString().slice(0, 10);
        const zipFileName = files.length === 1
          ? `${files[0].name}.zip`
          : `files-${timestamp}.zip`;
        const zipFile = new File([zipBlob], zipFileName, { type: 'application/zip' });

        // Get briefing result
        const missionBriefing = await Promise.race([
          briefingPromise,
          new Promise<string>(resolve => setTimeout(() => resolve('安全数据已加密并锁定。'), 2000))
        ]);

        // Upload
        const storedFile = await savePackage(zipFile, 'FILE', limit, missionBriefing, (p) => {
          setUploadProgress(p);
        });
        onSuccess(storedFile);
      }
    } catch (uploadError) {
      console.error('Upload failed:', uploadError);
      setError(getUploadErrorMessage(uploadError));
    } finally {
      setIsProcessing(false);
      setUploadPhase('idle');
      setUploadProgress(0);
      setZipProgress(0);
    }
  };

  // Check if current mode has valid data
  const isValid = activeTab === 'FILE' ? files.length > 0 && !hasValidationError : message.length > 0;

  // Get validation error message
  const getValidationError = () => {
    if (isOverFileLimit) return `最多只能选择 ${MAX_FILES} 个文件`;
    if (isOverSizeLimit) return `文件总大小不能超过 1GB`;
    return '';
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Type Switcher */}
      <div className="bg-gray-200/50 p-1 rounded-[20px] flex gap-1 relative">
        <button
          onClick={() => setActiveTab('FILE')}
          className={`flex-1 h-10 rounded-[16px] text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-300 ${
            activeTab === 'FILE' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <FileIcon className="w-4 h-4" />
          文件传输
        </button>
        <button
          onClick={() => setActiveTab('TEXT')}
          className={`flex-1 h-10 rounded-[16px] text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-300 ${
            activeTab === 'TEXT' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          加密留言
        </button>
      </div>

      <div className="min-h-[200px]">
        {activeTab === 'FILE' ? (
          /* FILE UPLOAD UI */
          files.length === 0 ? (
            <div
              className={`w-full transition-all duration-300 ${isDragging ? 'scale-[1.02]' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`
                  border-2 border-dashed rounded-[32px] h-60 flex flex-col items-center justify-center gap-4 cursor-pointer transition-colors
                  ${isDragging ? 'border-blue-500 bg-blue-50/50' : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50/30'}
                `}
              >
                <div className="w-12 h-12 rounded-full bg-white shadow-sm flex items-center justify-center">
                  <Upload className="w-5 h-5 text-gray-500" />
                </div>
                <div className="text-center">
                  <h3 className="text-lg font-bold text-gray-900">拖拽文件至此</h3>
                  <p className="text-xs text-gray-500 mt-1">支持多文件上传，最多 {MAX_FILES} 个</p>
                </div>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  onChange={handleFileSelect}
                  multiple
                />
              </div>
            </div>
          ) : (
            /* FILE LIST */
            <div
              className="space-y-3"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {/* File List Container */}
              <div className="max-h-[200px] overflow-y-auto space-y-2 pr-1">
                {files.map((file, index) => (
                  <div
                    key={`${file.name}-${index}`}
                    className="flex items-center gap-3 p-3 rounded-2xl bg-white/60 border border-white/50 shadow-sm animate-in zoom-in-95"
                  >
                    <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center text-white shrink-0">
                      <FileIcon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate text-gray-900 text-sm">{file.name}</p>
                      <p className="text-xs text-gray-500 uppercase tracking-wider font-bold">
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRemoveFile(index)}
                      className="p-2 rounded-full hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Summary & Add More */}
              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Package className="w-4 h-4" />
                  <span>已选择 <strong>{files.length}</strong> 个文件，共 <strong>{formatFileSize(totalSize)}</strong></span>
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  + 添加更多
                </button>
              </div>

              {/* Validation Error */}
              {hasValidationError && (
                <div className="text-sm text-red-500 text-center py-2 px-4 bg-red-50 rounded-xl">
                  {getValidationError()}
                </div>
              )}

              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                onChange={handleFileSelect}
                multiple
              />
            </div>
          )
        ) : (
          /* TEXT MESSAGE UI */
          <div className="relative group">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="在此输入机密信息..."
              className="
                w-full h-60 p-6 rounded-[32px] resize-none
                bg-white/40 border border-white/50 shadow-inner
                focus:bg-white/80 focus:ring-1 focus:ring-gray-200 focus:outline-none
                text-gray-900 placeholder-gray-400 transition-all duration-300
                font-medium leading-relaxed
              "
            />
            <div className="absolute bottom-4 right-4 text-xs text-gray-400 font-bold tracking-wider pointer-events-none uppercase">
              End-to-End Encrypted
            </div>
          </div>
        )}
      </div>

      {/* Settings - 快捷按钮 + 自定义输入 */}
      <div className="space-y-3">
        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-2">自毁机制设定</label>
        <div className="flex gap-2">
          {[1, 5, 10].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => setLimit(num)}
              className={`
                flex-1 h-12 rounded-2xl text-sm font-medium transition-all duration-200 border
                ${limit === num
                  ? 'bg-white border-gray-200 text-gray-900 shadow-md ring-1 ring-black/5'
                  : 'bg-transparent border-transparent text-gray-400 hover:bg-white/30'}
              `}
            >
              {num}次
            </button>
          ))}
          <div className="relative flex-1">
            <input
              type="number"
              min={1}
              value={![1, 5, 10].includes(limit) ? limit : ''}
              placeholder="自定义"
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') {
                  setLimit(1);
                  return;
                }
                const val = parseInt(raw, 10);
                if (!isNaN(val) && val >= 1) {
                  setLimit(val);
                }
              }}
              className={`
                w-full h-12 px-3 pr-8 rounded-2xl text-sm font-medium text-center
                transition-all duration-200 border
                [appearance:textfield]
                [&::-webkit-outer-spin-button]:appearance-none
                [&::-webkit-inner-spin-button]:appearance-none
                ${![1, 5, 10].includes(limit)
                  ? 'bg-white border-gray-200 text-gray-900 shadow-md ring-1 ring-black/5'
                  : 'bg-transparent border-transparent text-gray-400 hover:bg-white/30 placeholder:text-gray-400'}
                focus:outline-none focus:bg-white focus:border-gray-200 focus:shadow-md focus:ring-1 focus:ring-black/5
              `}
            />
            <span
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none"
            >
              次
            </span>
          </div>
        </div>
      </div>

      {/* Upload Progress - Two Phase */}
      {isProcessing && activeTab === 'FILE' && (
        <div className="space-y-3">
          {/* Phase Indicator */}
          <div className="flex items-center gap-2 text-sm">
            <span className={`font-medium ${uploadPhase === 'zipping' ? 'text-blue-600' : 'text-gray-400'}`}>
              步骤 1/2: 打包
            </span>
            <span className="text-gray-300">→</span>
            <span className={`font-medium ${uploadPhase === 'uploading' ? 'text-green-600' : 'text-gray-400'}`}>
              步骤 2/2: 上传
            </span>
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">
              <span>{uploadPhase === 'zipping' ? '正在打包...' : '正在上传...'}</span>
              <span>{uploadPhase === 'zipping' ? `${zipProgress}%` : `${uploadProgress}%`}</span>
            </div>
            <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ease-out ${
                  uploadPhase === 'zipping' ? 'bg-blue-500' : 'bg-green-500'
                }`}
                style={{ width: `${uploadPhase === 'zipping' ? zipProgress : uploadProgress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Text Upload Progress */}
      {isProcessing && activeTab === 'TEXT' && uploadProgress > 0 && (
        <div className="space-y-2">
          <div className="flex justify-between text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">
            <span>传输进度</span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gray-900 transition-all duration-300 ease-out"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      <div className="h-px bg-gray-200/50 w-full" />

      {error && (
        <div className="text-sm text-red-500 text-center">
          {error}
        </div>
      )}

      {/* Action */}
      <Button
        onClick={handleUpload}
        disabled={isProcessing || !isValid}
        className={`w-full ${!isValid ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {isProcessing ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            {uploadPhase === 'zipping' ? '打包中...' : '上传中...'}
          </>
        ) : (
          <>
            <Shield className="w-5 h-5" />
            {activeTab === 'FILE'
              ? (files.length > 1 ? '打包并上传' : '安全上传')
              : '加密发送'
            }
          </>
        )}
      </Button>
    </div>
  );
};
