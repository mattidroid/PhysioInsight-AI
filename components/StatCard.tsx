
import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  trend?: string;
  icon?: React.ReactNode;
  color?: string;
}

export const StatCard: React.FC<StatCardProps> = ({ label, value, unit, trend, icon, color = 'blue' }) => {
  const colorMap: Record<string, string> = {
    blue: 'border-blue-500/30 text-blue-400',
    green: 'border-emerald-500/30 text-emerald-400',
    purple: 'border-purple-500/30 text-purple-400',
    rose: 'border-rose-500/30 text-rose-400',
    amber: 'border-amber-500/30 text-amber-400',
  };

  const glowMap: Record<string, string> = {
    blue: 'shadow-blue-500/5',
    green: 'shadow-emerald-500/5',
    purple: 'shadow-purple-500/5',
    rose: 'shadow-rose-500/5',
    amber: 'shadow-amber-500/5',
  };

  return (
    <div className={`p-5 rounded-xl border bg-[#1e293b] ${colorMap[color]} shadow-xl ${glowMap[color]} flex flex-col justify-between transition-all hover:bg-[#243147] hover:border-opacity-100 group`}>
      <div className="flex justify-between items-start mb-3">
        <p className="text-[10px] font-black uppercase tracking-[0.15em] opacity-60 group-hover:opacity-100 transition-opacity">{label}</p>
        <div className="opacity-40 group-hover:opacity-100 transition-opacity">
          {icon}
        </div>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-black tracking-tighter text-white">{value}</span>
        <span className="text-[10px] font-bold uppercase opacity-40">{unit}</span>
      </div>
      {trend && (
        <p className="text-[9px] font-black uppercase tracking-widest mt-2 opacity-30 group-hover:opacity-60 transition-opacity border-t border-slate-800 pt-2">
          {trend}
        </p>
      )}
    </div>
  );
};
