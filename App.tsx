import React, { useState } from 'react';
import { GlassCard } from './components/GlassCard';
import { UploadView } from './components/UploadView';
import { RetrieveView } from './components/RetrieveView';
import { AppMode, TransferFile } from './types';
import { ArrowLeft, Copy, Check } from 'lucide-react';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.UPLOAD);
  const [uploadedFile, setUploadedFile] = useState<TransferFile | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopyCode = () => {
    if (uploadedFile) {
      navigator.clipboard.writeText(uploadedFile.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const reset = () => {
    setUploadedFile(null);
    setMode(AppMode.UPLOAD);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      
      {/* Abstract Background Blobs */}
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-blue-200/30 rounded-full blur-[120px] mix-blend-multiply filter pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-purple-200/30 rounded-full blur-[100px] mix-blend-multiply filter pointer-events-none" />

      <div className="w-full max-w-md space-y-8 relative z-10">
        
        {/* Header / Nav */}
        <div className="flex items-center justify-between px-2">
          {mode === AppMode.RETRIEVE && !uploadedFile ? (
            <button 
              onClick={() => setMode(AppMode.UPLOAD)}
              className="p-2 rounded-full hover:bg-white/50 transition-colors text-gray-500"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
          ) : (
            <div className="w-10" /> // Spacer
          )}
          
          <h1 className="text-xl font-extrabold tracking-tight text-gray-900">
            YUD<span className="text-gray-400 font-normal">文件助手</span>
          </h1>
          
          <div className="w-10" /> 
        </div>

        {/* Main Interface Card */}
        <GlassCard className="p-8 min-h-[480px] flex flex-col">
          
          {uploadedFile ? (
            // Success State (Code Display)
            <div className="flex-1 flex flex-col items-center justify-center space-y-8 animate-in zoom-in-95 duration-500">
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold text-gray-900">上传成功</h2>
                <p className="text-gray-500">请分享此一次性提取码。</p>
              </div>

              <div 
                onClick={handleCopyCode}
                className="
                  w-full py-8 bg-gray-900 rounded-[32px] text-white text-center cursor-pointer
                  hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl group relative
                "
              >
                <div className="text-xs text-gray-400 uppercase tracking-widest mb-2 font-bold">提取码</div>
                <div className="text-5xl font-mono tracking-widest font-bold">{uploadedFile.code}</div>
                
                <div className="absolute inset-0 flex items-center justify-center bg-black/80 rounded-[32px] opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="flex items-center gap-2 font-semibold">
                    {copied ? <Check className="w-5 h-5 text-green-400"/> : <Copy className="w-5 h-5"/>}
                    {copied ? '已复制' : '复制'}
                  </span>
                </div>
              </div>

              <div className="bg-gray-50 p-6 rounded-3xl w-full text-sm text-gray-600 border border-gray-100">
                <p className="mb-2 font-semibold text-gray-900">任务简报：</p>
                <p className="italic">"{uploadedFile.aiDescription}"</p>
              </div>

              <button 
                onClick={reset}
                className="text-gray-400 hover:text-gray-900 font-medium text-sm transition-colors mt-auto"
              >
                发送其他文件
              </button>
            </div>
          ) : (
            // Mode Switcher & Views
            <>
              {mode === AppMode.UPLOAD ? (
                <div className="flex flex-col h-full">
                  <UploadView onSuccess={setUploadedFile} />
                   {/* 红色警告提示 */}
    <p className="mt-2 text-xs text-red-500 text-center">
      ⚠️ 只能上传不超过 1GB 的文件并提取
    </p>
                  <div className="mt-8 text-center">
                    <button 
                      onClick={() => setMode(AppMode.RETRIEVE)}
                      className="text-sm text-gray-400 hover:text-gray-900 transition-colors font-medium"
                    >
                      已有提取码？ <span className="underline decoration-2 underline-offset-4 decoration-gray-200 hover:decoration-gray-900">前往提取</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col h-full justify-center">
                  <RetrieveView />
                </div>
              )}
            </>
          )}

        </GlassCard>

        {/* Footer */}
        <div className="text-center">
          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-widest opacity-60">
            端到端加密 • 阅后即焚
          </p>
        </div>
      </div>
    </div>
  );
};

export default App;
