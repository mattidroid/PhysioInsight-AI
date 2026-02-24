
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
    blue: 'border-blue-100 text-blue-600',
    green: 'border-emerald-100 text-emerald-600',
    purple: 'border-purple-100 text-purple-600',
    rose: 'border-rose-100 text-rose-600',
    amber: 'border-amber-100 text-amber-600',
  };

  const glowMap: Record<string, string> = {
    blue: 'shadow-blue-500/5',
    green: 'shadow-emerald-500/5',
    purple: 'shadow-purple-500/5',
    rose: 'shadow-rose-500/5',
    amber: 'shadow-amber-500/5',
  };

  return (
    <div className={`p-5 rounded-xl border bg-white ${colorMap[color]} shadow-sm ${glowMap[color]} flex flex-col justify-between transition-all hover:bg-slate-50 hover:border-opacity-100 group`}>
      <div className="flex justify-between items-start mb-3">
        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 group-hover:text-slate-900 transition-colors">{label}</p>
        <div className="text-slate-400 group-hover:text-inherit transition-colors">
          {icon}
        </div>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-black tracking-tighter text-slate-900">{value}</span>
        <span className="text-[10px] font-bold uppercase text-slate-400">{unit}</span>
      </div>
      {trend && (
        <p className="text-[9px] font-black uppercase tracking-widest mt-2 text-slate-400 group-hover:text-slate-600 transition-colors border-t border-slate-100 pt-2">
          {trend}
        </p>
      )}
    </div>
  );
};
