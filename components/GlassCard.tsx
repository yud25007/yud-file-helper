import React from 'react';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
}

export const GlassCard: React.FC<GlassCardProps> = ({ children, className = '' }) => {
  return (
    <div className={`
      relative 
      bg-white/60 
      backdrop-blur-[50px] 
      rounded-[40px] 
      border border-white/60 
      shadow-[0_24px_48px_-12px_rgba(0,0,0,0.08)]
      ring-1 ring-black/5
      overflow-hidden
      ${className}
    `}>
      {/* Glossy Reflection effect at top */}
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/80 to-transparent opacity-50 pointer-events-none" />
      {children}
    </div>
  );
};

export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }> = ({ 
  children, 
  variant = 'primary', 
  className = '', 
  ...props 
}) => {
  const baseStyle = "h-14 px-8 rounded-[24px] font-semibold tracking-tight transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-2";
  
  const variants = {
    primary: "bg-[#1C1C1E] text-white shadow-lg hover:bg-black/90 hover:shadow-xl",
    secondary: "bg-white text-[#1C1C1E] border border-gray-200 shadow-sm hover:bg-gray-50"
  };

  return (
    <button 
      className={`${baseStyle} ${variants[variant]} ${className}`} 
      {...props}
    >
      {children}
    </button>
  );
};
