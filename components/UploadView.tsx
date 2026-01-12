import React, { useState, useRef } from 'react';
import { Upload, File as FileIcon, Zap, Shield, Loader2, MessageSquare, X } from 'lucide-react';
import { Button } from './GlassCard';
import { savePackage } from '../services/storage';
import { generateMissionBriefing } from '../services/gemini';
import { TransferFile, TransferType } from '../types';

interface UploadViewProps {
  onSuccess: (fileData: TransferFile) => void;
}

export const UploadView: React.FC<UploadViewProps> = ({ onSuccess }) => {
  const [activeTab, setActiveTab] = useState<TransferType>('FILE');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string>('');
  
  const [limit, setLimit] = useState<number>(1);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    if (activeTab === 'FILE' && e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (activeTab === 'FILE' && !file) return;
    if (activeTab === 'TEXT' && !message.trim()) return;

    setIsProcessing(true);
    setError('');
    setUploadProgress(0);

    try {
      const content: File | string = activeTab === 'FILE' && file ? file : message;
      const briefingInput = activeTab === 'FILE' && file ? file.name : message;

      // 并行执行：Gemini 生成简报（后台） + 文件上传（前台）
      // briefing 失败不影响上传
      const briefingPromise = generateMissionBriefing(briefingInput, activeTab)
        .catch(err => {
          console.warn('Briefing generation failed:', err);
          return '安全数据已加密并锁定。';
        });

      // 先等待 briefing（在上传开始前获取），然后上传
      // 但如果 briefing 太慢，可以使用超时
      const missionBriefing = await Promise.race([
        briefingPromise,
        new Promise<string>(resolve => setTimeout(() => resolve('安全数据已加密并锁定。'), 5000))
      ]);

      const storedFile = await savePackage(content, activeTab, limit, missionBriefing, (p) => {
        setUploadProgress(p);
      });
      onSuccess(storedFile);
    } catch (uploadError) {
      console.error('Upload failed:', uploadError);
      setError(uploadError instanceof Error ? uploadError.message : '上传失败，请稍后重试。');
    } finally {
      setIsProcessing(false);
      setUploadProgress(0);
    }
  };

  // Check if current mode has valid data
  const isValid = activeTab === 'FILE' ? !!file : message.length > 0;

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
          !file ? (
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
                  <p className="text-xs text-gray-500 mt-1">支持所有格式</p>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  onChange={handleFileSelect}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4 p-4 rounded-[24px] bg-white/60 border border-white/50 shadow-sm animate-in zoom-in-95">
              <div className="w-12 h-12 rounded-2xl bg-gray-900 flex items-center justify-center text-white shrink-0">
                <FileIcon className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate text-gray-900">{file.name}</p>
                <p className="text-xs text-gray-500 uppercase tracking-wider font-bold">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <button 
                onClick={() => setFile(null)}
                className="p-2 rounded-full hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
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

      {/* Settings */}
      <div className="space-y-3">
        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-2">自毁机制设定</label>
        <div className="grid grid-cols-3 gap-3">
          {[1, 5, 10].map((num) => (
            <button
              key={num}
              onClick={() => setLimit(num)}
              className={`
                h-12 rounded-2xl text-sm font-medium transition-all duration-200 border
                ${limit === num 
                  ? 'bg-white border-gray-200 text-gray-900 shadow-md ring-1 ring-black/5' 
                  : 'bg-transparent border-transparent text-gray-400 hover:bg-white/30'}
              `}
            >
              {num === 1 ? '1次' : `${num}次`}
            </button>
          ))}
        </div>
      </div>

      {/* Upload Progress */}
      {isProcessing && activeTab === 'FILE' && uploadProgress > 0 && (
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
            加密上传中...
          </>
        ) : (
          <>
            <Shield className="w-5 h-5" />
            {activeTab === 'FILE' ? '安全上传' : '加密发送'}
          </>
        )}
      </Button>
    </div>
  );
};