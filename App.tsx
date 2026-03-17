
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  Area, ScatterChart, Scatter, Legend, ComposedChart, Bar, Line
} from 'recharts';
import { 
  Activity, Moon, Scale, Zap, TrendingDown, MessageSquare, Sparkles,
  Heart, Upload, FileText, RefreshCw, Dumbbell, Bike, Plus, Pill, Calendar, Clock, Filter, 
  Target, BarChart3, Info, Waves, Mountain, Settings, Key
} from 'lucide-react';
import { DaySummary } from './types';
import { parseTrainingPeaksCSV } from './services/dataParser';
import { geminiService } from './services/geminiService';
import { StatCard } from './components/StatCard';

interface DoseSegment {
  dose: string;
  startDate: string;
  endDate: string;
  startWeight: number | null;
  endWeight: number | null;
  weightLoss: number;
  totalTss: number;
  days: number;
}

export default function App() {
  const [data, setData] = useState<DaySummary[]>([]);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'model', text: string }[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [chartViewMode, setChartViewMode] = useState<'daily' | 'weekly'>('weekly');
  const [selectedWorkoutType, setSelectedWorkoutType] = useState<string>('All');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(localStorage.getItem('GEMINI_API_KEY') || '');
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const workoutTypes = useMemo(() => {
    const types = new Set<string>();
    data.forEach(d => {
      d.workoutTypes?.forEach(t => {
        if (t && t.trim() !== '') types.add(t);
      });
    });
    return ['All', ...Array.from(types).sort()];
  }, [data]);

  const filteredData = useMemo(() => {
    if (selectedWorkoutType === 'All') return data;
    return data.map(d => {
      const hasType = d.workoutTypes?.includes(selectedWorkoutType);
      if (hasType) return d;
      return { 
        ...d, 
        tss: 0, 
        totalTrainingHours: 0, 
        energyExpended: 0, 
        isStrengthDay: false,
        totalWorkouts: 0 
      };
    });
  }, [data, selectedWorkoutType]);

  const stats = useMemo(() => {
    if (filteredData.length === 0) return null;
    
    const weightEntries = filteredData.filter(d => d.weight && d.weight > 0);
    const firstWeight = weightEntries.length > 0 ? weightEntries[0].weight || 0 : 0;
    const latestWeight = weightEntries.length > 0 ? weightEntries[weightEntries.length - 1].weight || 0 : 0;
    
    const hrvEntries = filteredData.filter(d => d.hrv && d.hrv > 0);
    const avgHrv = hrvEntries.length > 0 
      ? hrvEntries.reduce((acc, d) => acc + (d.hrv || 0), 0) / hrvEntries.length 
      : 0;
    const minHrv = hrvEntries.length > 0 ? Math.min(...hrvEntries.map(d => d.hrv || Infinity)) : 0;
    const maxHrv = hrvEntries.length > 0 ? Math.max(...hrvEntries.map(d => d.hrv || -Infinity)) : 0;

    const sleepEntries = filteredData.filter(d => d.sleepHours && d.sleepHours > 0);
    const avgSleep = sleepEntries.length > 0
      ? sleepEntries.reduce((acc, d) => acc + (d.sleepHours || 0), 0) / sleepEntries.length
      : 0;
      
    const totalTss = filteredData.reduce((acc, d) => acc + (d.tss || 0), 0);
    const last7Days = filteredData.slice(-7);
    const lastWeekTss = last7Days.reduce((acc, d) => acc + (d.tss || 0), 0);
    
    const lastWeekHRVEntries = last7Days.filter(d => d.hrv && d.hrv > 0);
    const lastWeekHRV = lastWeekHRVEntries.length > 0
      ? lastWeekHRVEntries.reduce((acc, d) => acc + (d.hrv || 0), 0) / lastWeekHRVEntries.length
      : 0;

    const lastWeekSleepEntries = last7Days.filter(d => d.sleepHours && d.sleepHours > 0);
    const lastWeekSleep = lastWeekSleepEntries.length > 0
      ? lastWeekSleepEntries.reduce((acc, d) => acc + (d.sleepHours || 0), 0) / lastWeekSleepEntries.length
      : 0;

    const strengthCount = filteredData.filter(d => d.isStrengthDay).length;
    const totalSpanDays = data.length;

    const totalWeightLoss = latestWeight > 0 ? firstWeight - latestWeight : 0;
    const weightLossPercent = firstWeight > 0 ? (totalWeightLoss / firstWeight * 100).toFixed(1) : "0.0";
    const avgWeeklyLoss = (totalWeightLoss / Math.max(1, totalSpanDays / 7)).toFixed(2);
    const avgWeeklyStrength = (strengthCount / Math.max(1, totalSpanDays / 7)).toFixed(2);
    
    return {
      currentWeight: latestWeight > 0 ? latestWeight.toFixed(1) : "—",
      weightLoss: totalWeightLoss.toFixed(1),
      weightLossPercent,
      avgWeeklyLoss,
      avgHRV: avgHrv.toFixed(0),
      lastWeekHRV: lastWeekHRV.toFixed(0),
      minHrv: minHrv.toFixed(0),
      maxHrv: maxHrv.toFixed(0),
      avgSleep: avgSleep.toFixed(1),
      lastWeekSleep: lastWeekSleep.toFixed(1),
      totalTss: totalTss.toFixed(0),
      strengthSessions: strengthCount,
      avgWeeklyStrength,
      avgWeeklyTss: (totalTss / Math.max(1, totalSpanDays / 7)).toFixed(0),
      lastWeekTss: lastWeekTss.toFixed(0),
      dataPoints: filteredData.length
    };
  }, [filteredData, data.length]);

  const doseSegments = useMemo(() => {
    if (filteredData.length === 0) return [];
    const segments: DoseSegment[] = [];
    const doseDayIndices: number[] = [];
    filteredData.forEach((day, idx) => {
      if (day.notes?.match(/(\d+(?:\.\d+)?)\s*mg/i)) doseDayIndices.push(idx);
    });
    if (doseDayIndices.length === 0) return [];

    for (let i = 0; i < doseDayIndices.length; i++) {
      const startIdx = doseDayIndices[i];
      const nextDoseIdx = doseDayIndices[i + 1]; 
      const startDay = filteredData[startIdx];
      const doseMatch = startDay.notes?.match(/(\d+(?:\.\d+)?)\s*mg/i);
      const doseValue = doseMatch ? `${doseMatch[1]}mg` : "Unknown";

      let startWeight = filteredData[startIdx].weight || null;
      if (startWeight === null) {
        const limit = nextDoseIdx || filteredData.length;
        for (let j = startIdx; j < limit; j++) {
          if (filteredData[j].weight && filteredData[j].weight > 0) {
            startWeight = filteredData[j].weight!;
            break;
          }
        }
      }

      let endWeight = null;
      if (nextDoseIdx !== undefined) {
        endWeight = filteredData[nextDoseIdx].weight || null;
        if (endWeight === null) {
          for (let j = nextDoseIdx; j >= startIdx; j--) {
            if (filteredData[j].weight && filteredData[j].weight > 0) {
              endWeight = filteredData[j].weight!;
              break;
            }
          }
        }
      } else {
        for (let j = filteredData.length - 1; j >= startIdx; j--) {
          if (filteredData[j].weight && filteredData[j].weight > 0) {
            endWeight = filteredData[j].weight!;
            break;
          }
        }
      }

      let totalTss = 0;
      const tssLimit = nextDoseIdx !== undefined ? nextDoseIdx : filteredData.length;
      for (let j = startIdx; j < tssLimit; j++) totalTss += (filteredData[j].tss || 0);

      segments.push({
        dose: doseValue,
        startDate: filteredData[startIdx].date,
        endDate: nextDoseIdx !== undefined ? filteredData[nextDoseIdx].date : filteredData[filteredData.length - 1].date,
        startWeight,
        endWeight,
        weightLoss: (startWeight && endWeight) ? parseFloat((startWeight - endWeight).toFixed(1)) : 0,
        totalTss: Math.round(totalTss),
        days: tssLimit - startIdx
      });
    }
    return segments;
  }, [filteredData]);

  /**
   * Linear interpolation for a specific key in a dataset.
   * Fills null values by calculating values based on nearest known neighbors.
   */
  const interpolateData = (dataset: any[], key: string) => {
    const result = [...dataset];
    for (let i = 0; i < result.length; i++) {
      if (result[i][key] === null) {
        // Find previous non-null
        let prevIdx = -1;
        for (let j = i - 1; j >= 0; j--) {
          if (result[j][key] !== null) {
            prevIdx = j;
            break;
          }
        }
        // Find next non-null
        let nextIdx = -1;
        for (let j = i + 1; j < result.length; j++) {
          if (result[j][key] !== null) {
            nextIdx = j;
            break;
          }
        }

        if (prevIdx !== -1 && nextIdx !== -1) {
          const prevVal = result[prevIdx][key];
          const nextVal = result[nextIdx][key];
          const factor = (i - prevIdx) / (nextIdx - prevIdx);
          result[i][key] = parseFloat((prevVal + (nextVal - prevVal) * factor).toFixed(2));
        } else if (prevIdx !== -1) {
          result[i][key] = result[prevIdx][key];
        } else if (nextIdx !== -1) {
          result[i][key] = result[nextIdx][key];
        }
      }
    }
    return result;
  };

  const processedChartData = useMemo(() => {
    if (filteredData.length === 0) return [];
    const getWeekId = (dateStr: string) => {
      const date = new Date(dateStr);
      const year = date.getFullYear();
      const firstDayOfYear = new Date(year, 0, 1);
      const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
      return `${year}-W${Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7)}`;
    };

    if (chartViewMode === 'weekly') {
      const weeks: Record<string, { weekId: string, tss: number, weights: number[], hrvs: number[], pulses: number[] }> = {};
      filteredData.forEach(d => {
        const weekId = getWeekId(d.date);
        if (!weeks[weekId]) weeks[weekId] = { weekId, tss: 0, weights: [], hrvs: [], pulses: [] };
        weeks[weekId].tss += (d.tss || 0);
        if (d.weight && d.weight > 0) weeks[weekId].weights.push(d.weight);
        if (d.hrv && d.hrv > 0) weeks[weekId].hrvs.push(d.hrv);
        if (d.pulse && d.pulse > 0) weeks[weekId].pulses.push(d.pulse);
      });
      return Object.values(weeks).map(w => ({
        label: w.weekId,
        tss: Math.round(w.tss),
        weight: w.weights.length > 0 ? parseFloat((w.weights.reduce((a, b) => a + b, 0) / w.weights.length).toFixed(1)) : null,
        hrv: w.hrvs.length > 0 ? Math.round(w.hrvs.reduce((a, b) => a + b, 0) / w.hrvs.length) : null,
        pulse: w.pulses.length > 0 ? Math.round(w.pulses.reduce((a, b) => a + b, 0) / w.pulses.length) : null,
      }));
    } else {
      let rawDaily = filteredData.map(d => {
        return {
          label: d.date,
          weight: d.weight || null,
          hrv: d.hrv || null,
          pulse: d.pulse || null,
          tss: d.tss ? Math.round(d.tss) : null,
        };
      });

      // Apply interpolation for smoother trends in daily precision mode
      rawDaily = interpolateData(rawDaily, 'weight');
      rawDaily = interpolateData(rawDaily, 'hrv');
      rawDaily = interpolateData(rawDaily, 'pulse');
      
      return rawDaily;
    }
  }, [filteredData, chartViewMode]);

  const processFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setData(prev => parseTrainingPeaksCSV(text, prev));
    };
    reader.readAsText(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) Array.from(files).forEach(processFile);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files) Array.from(files).forEach(processFile);
  };

  const handleSendMessage = async () => {
    if (!userInput.trim()) return;
    const newHistory = [...chatHistory, { role: 'user' as const, text: userInput }];
    setChatHistory(newHistory);
    setUserInput('');
    setIsLoading(true);
    try {
      const response = await geminiService.analyzeData(filteredData, userInput);
      setChatHistory([...newHistory, { role: 'model' as const, text: response || 'No response.' }]);
    } catch (error: any) {
      console.error(error);
      const errorMessage = error.message || 'Analysis error. Check data connection.';
      setChatHistory([...newHistory, { role: 'model' as const, text: errorMessage }]);
      if (errorMessage.includes('API Key')) {
        setIsSettingsOpen(true);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveApiKey = () => {
    if (apiKeyInput.trim()) {
      localStorage.setItem('GEMINI_API_KEY', apiKeyInput.trim());
    } else {
      localStorage.removeItem('GEMINI_API_KEY');
    }
    setIsSettingsOpen(false);
  };

  if (data.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-slate-900"
           onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
           onDragLeave={() => setIsDragging(false)}
           onDrop={onDrop}>
        <div className={`max-w-2xl w-full bg-white p-12 rounded-3xl shadow-xl border transition-all ${isDragging ? 'border-cyan-500 bg-slate-50 scale-105' : 'border-slate-200'}`}>
          <div className="text-center">
            <div className="bg-gradient-to-br from-cyan-600 to-blue-700 w-24 h-24 rounded-3xl flex items-center justify-center text-white mx-auto mb-8 shadow-xl">
              <Upload size={48} />
            </div>
            <h1 className="text-4xl font-black mb-3 tracking-tighter uppercase">PhysioInsight <span className="text-cyan-600">Elite</span></h1>
            <p className="text-slate-500 text-lg mb-10 max-w-md mx-auto font-medium">Precision physiological analysis for elite performance.</p>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".csv" multiple className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} className="bg-cyan-600 hover:bg-cyan-500 text-white font-black py-5 px-12 rounded-xl transition-all shadow-lg active:scale-95 flex items-center gap-4 mx-auto uppercase tracking-wider text-sm">
              <FileText size={20} />
              Import Performance Data
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-40 bg-slate-50 text-slate-900 font-sans">
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-xl border-b border-slate-200 px-10 py-4 flex items-center justify-between">
        <div className="flex items-center gap-5">
          <div className="bg-cyan-600 p-2.5 rounded-xl text-white shadow-lg">
            <Activity size={22} />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tighter uppercase leading-none">PhysioInsight <span className="text-cyan-600">Elite</span></h1>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => setIsSettingsOpen(true)} className="p-2.5 hover:bg-slate-100 rounded-lg text-slate-400 transition-all" title="Settings">
            <Settings size={18} />
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-black uppercase tracking-widest border border-slate-200 transition-all shadow-sm">
            <Plus size={14} />
            Add Datasets
          </button>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".csv" multiple className="hidden" />
          <button onClick={() => setData([])} className="p-2.5 hover:bg-red-50 hover:text-red-600 rounded-lg text-slate-400 transition-all">
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-10 pt-10 space-y-8">
        {/* Performance Filters */}
        <section className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
           <div className="flex items-center gap-4 overflow-x-auto no-scrollbar scroll-smooth">
             <div className="flex items-center gap-2 text-slate-400 mr-2 shrink-0">
               <Filter size={16} />
               <span className="text-[10px] font-black uppercase tracking-widest">Training Modality</span>
             </div>
             {workoutTypes.map(type => {
               const isActive = selectedWorkoutType === type;
               // Map MTB to GRV and BIKE to RD/ZW for button display
               const displayLabel = type.toUpperCase() === 'MTB' ? 'GRV' : type.toUpperCase() === 'BIKE' ? 'RD/ZW' : type;
               return (
                 <button
                   key={type}
                   onClick={() => setSelectedWorkoutType(type)}
                   className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all shrink-0 flex items-center gap-2 border ${
                     isActive ? 'bg-cyan-600 border-cyan-500 text-white shadow-md' : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                   }`}
                 >
                   {type === 'All' && <Activity size={14} />}
                   {type.toUpperCase() === 'MTB' && <Bike size={14} className="-rotate-12" />}
                   {type.toUpperCase() === 'BIKE' && <Bike size={14} />}
                   {type.toLowerCase().includes('strength') && <Dumbbell size={14} />}
                   {displayLabel}
                 </button>
               );
             })}
           </div>
        </section>

        {/* Precision Stats */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          <StatCard 
            label="Mass Differential" 
            value={stats ? `${stats.weightLoss} kg (${stats.weightLossPercent}%)` : 0} 
            unit="" 
            color="rose" 
            icon={<TrendingDown size={18} />} 
            trend={`Curr: ${stats?.currentWeight}kg | Avg: ${stats?.avgWeeklyLoss}kg/wk`} 
          />
          <StatCard 
            label={`${selectedWorkoutType} Load`} 
            value={stats?.lastWeekTss || 0} 
            unit="TSS" 
            color="amber" 
            icon={<Zap size={18} />} 
            trend={`Weekly Avg: ${stats?.avgWeeklyTss} | Total: ${stats?.totalTss}`} 
          />
          <StatCard label="STRENGTH" value={stats?.strengthSessions || 0} unit="sesh" color="blue" icon={<Dumbbell size={18} />} trend={`Avg: ${stats?.avgWeeklyStrength}/wk`} />
          <StatCard 
            label="HR Variability" 
            value={stats?.avgHRV || 0} 
            unit="ms" 
            color="green" 
            icon={<Heart size={18} />} 
            trend={`7d Avg: ${stats?.lastWeekHRV} | Range: ${stats?.minHrv}-${stats?.maxHrv}`} 
          />
          <StatCard 
            label="Sleep Duration" 
            value={stats?.avgSleep || 0} 
            unit="hrs" 
            color="purple" 
            icon={<Moon size={18} />} 
            trend={`7d Avg: ${stats?.lastWeekSleep} hrs`} 
          />
          <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm flex flex-col justify-center">
             <div className="flex items-center gap-2 text-cyan-600 mb-1">
                <Target size={14} />
                <span className="text-[10px] font-black uppercase tracking-widest">Cycles</span>
             </div>
             <p className="text-xl font-black text-slate-900">{doseSegments.length} <span className="text-xs font-medium text-slate-400">Active</span></p>
             <p className="text-[9px] font-black uppercase tracking-widest opacity-30 mt-2 border-t border-slate-100 pt-2 text-slate-500">
               {Math.floor(data.length / 7)} Weeks Total
             </p>
          </div>
        </section>

        {/* Analytical Graph Block */}
        <div className="space-y-4">
          {/* Section 1: Workload & Mass */}
          <div className="bg-white p-8 pb-4 rounded-t-2xl border border-slate-200 shadow-sm relative overflow-hidden">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-6 relative z-10">
              <div>
                <h3 className="text-lg font-black text-slate-900 uppercase tracking-tighter flex items-center gap-2">
                  <BarChart3 size={20} className="text-cyan-600" />
                  Performance Load and Weight Response
                </h3>
                <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-1">Correlation of mechanical work vs somatic mass.</p>
              </div>
              <div className="flex bg-slate-50 p-1 rounded-lg border border-slate-200">
                <button onClick={() => setChartViewMode('daily')} className={`px-4 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${chartViewMode === 'daily' ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Daily Precision</button>
                <button onClick={() => setChartViewMode('weekly')} className={`px-4 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${chartViewMode === 'weekly' ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Weekly Aggregate</button>
              </div>
            </div>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={processedChartData} syncId="performanceSync">
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                  <XAxis dataKey="label" hide />
                  <YAxis yAxisId="left" domain={['dataMin - 0.5', 'dataMax + 0.5']} orientation="left" stroke="#f43f5e" axisLine={false} tickLine={false} tick={{fontSize: 9, fontWeight: 700}} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 'auto']} stroke="#0891b2" axisLine={false} tickLine={false} tick={{fontSize: 9, fontWeight: 700}} />
                  <Tooltip 
                    cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                    contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    itemStyle={{ fontSize: '10px', fontWeight: 'bold' }}
                    labelStyle={{ fontSize: '11px', fontWeight: 'black', color: '#0f172a', marginBottom: '4px' }}
                  />
                  <Legend verticalAlign="top" height={36} iconType="rect" align="right" wrapperStyle={{fontSize: '9px', fontWeight: 'black', textTransform: 'uppercase', letterSpacing: '0.05em'}} />
                  <Bar yAxisId="right" dataKey="tss" name="Load (TSS)" fill="#0891b2" opacity={0.15} radius={[2, 2, 0, 0]} barSize={chartViewMode === 'daily' ? 100 : undefined} />
                  <Area yAxisId="left" type="monotone" dataKey="weight" name="Mass (kg)" stroke="#f43f5e" strokeWidth={3} fill="rgba(244,63,94,0.05)" connectNulls={true} dot={chartViewMode === 'weekly' ? { r: 3, fill: '#f43f5e', strokeWidth: 0 } : false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Section 2: Cardiovascular Recovery */}
          <div className="bg-white p-8 pt-4 rounded-b-2xl border border-slate-200 shadow-sm relative overflow-hidden">
            <div className="mb-6">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-tighter flex items-center gap-2">
                <Waves size={16} className="text-rose-500" />
                Cardiovascular Response
              </h3>
              <p className="text-slate-400 text-[9px] font-bold uppercase tracking-widest mt-1">Autonomous nervous system (HRV) and Basal Heart Rate (RHR).</p>
            </div>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={processedChartData} syncId="performanceSync">
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 800, fill: '#64748b' }} height={30} interval={chartViewMode === 'daily' ? 6 : 0} />
                  <YAxis yAxisId="left" domain={['dataMin - 10', 'dataMax + 10']} orientation="left" stroke="#f43f5e" axisLine={false} tickLine={false} tick={{fontSize: 9, fontWeight: 700}} />
                  <YAxis yAxisId="right" orientation="right" domain={[50, 70]} stroke="#94a3b8" axisLine={false} tickLine={false} tick={{fontSize: 9, fontWeight: 700}} />
                  <Tooltip 
                    cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                    contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    itemStyle={{ fontSize: '10px', fontWeight: 'bold' }}
                    labelStyle={{ fontSize: '11px', fontWeight: 'black', color: '#0f172a', marginBottom: '4px' }}
                  />
                  <Legend verticalAlign="top" height={36} iconType="circle" align="right" wrapperStyle={{fontSize: '9px', fontWeight: 'black', textTransform: 'uppercase', letterSpacing: '0.05em'}} />
                  <Line yAxisId="left" type="monotone" dataKey="hrv" name="HRV (ms)" stroke="#f43f5e" strokeWidth={2.5} connectNulls={true} dot={chartViewMode === 'weekly' ? { r: 3, fill: '#f43f5e', strokeWidth: 0 } : false} />
                  <Line yAxisId="right" type="monotone" dataKey="pulse" name="RHR (bpm)" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 4" connectNulls={true} dot={chartViewMode === 'weekly' ? { r: 2, fill: '#94a3b8', strokeWidth: 0 } : false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Technical Dose Analysis */}
        <section className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-slate-50 border border-slate-200 text-cyan-600 rounded-lg">
              <Pill size={24} />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tighter">Metabolic Efficiency Matrix</h3>
              <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-0.5">Dose response analysis relative to training output.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 overflow-hidden">
              <table className="w-full text-left text-[11px] font-bold">
                <thead className="bg-slate-100 text-slate-500 uppercase tracking-widest border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-3">Cycle Protocol</th>
                    <th className="px-6 py-3 text-center">Start</th>
                    <th className="px-6 py-3 text-center">End</th>
                    <th className="px-6 py-3 text-center">Mass Δ</th>
                    <th className="px-6 py-3 text-center">Load (TSS)</th>
                    <th className="px-6 py-3 text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {doseSegments.map((seg, i) => (
                    <tr key={i} className="hover:bg-cyan-50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="text-slate-900 group-hover:text-cyan-600 transition-colors uppercase tracking-tight">{seg.dose} Protocol</div>
                        <div className="text-[9px] text-slate-400">{seg.startDate}</div>
                      </td>
                      <td className="px-6 py-4 text-center text-slate-600">
                        {seg.startWeight ? `${seg.startWeight.toFixed(1)}kg` : '—'}
                      </td>
                      <td className="px-6 py-4 text-center text-slate-600">
                        {seg.endWeight ? `${seg.endWeight.toFixed(1)}kg` : '—'}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-2 py-1 rounded ${seg.weightLoss > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                          {seg.weightLoss > 0 ? `-${seg.weightLoss}kg` : 'STABLE'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center text-amber-600 font-mono">{seg.totalTss}</td>
                      <td className="px-6 py-4 text-right text-slate-500 uppercase text-[9px]">{seg.days}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="h-[350px] bg-slate-50/50 rounded-xl p-4 border border-slate-200">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={doseSegments} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="dose" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 900, fill: '#64748b' }} />
                  <YAxis yAxisId="loss" orientation="left" stroke="#10b981" axisLine={false} tickLine={false} tick={{fontSize: 9}} />
                  <YAxis yAxisId="tss" orientation="right" stroke="#d97706" axisLine={false} tickLine={false} tick={{fontSize: 9}} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px' }} />
                  <Bar yAxisId="tss" dataKey="totalTss" name="Cumulative Load" fill="#d97706" radius={[2, 2, 0, 0]} opacity={0.1} />
                  <Line yAxisId="loss" type="monotone" dataKey="weightLoss" name="Mass Loss Efficiency" stroke="#10b981" strokeWidth={3} dot={{ r: 4, fill: '#10b981' }} />
                </ComposedChart>
              </ResponsiveContainer>
              <p className="text-center text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mt-2">Correlation Analysis: Mass Reduction vs Mechanical Work (TSS)</p>
            </div>
          </div>
        </section>

        {/* AI Performance Lab */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden flex flex-col h-[700px]">
          <div className="bg-slate-50 px-8 py-6 flex items-center justify-between border-b border-slate-200">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-cyan-600 flex items-center justify-center text-white shadow-lg">
                <Sparkles size={24} />
              </div>
              <div>
                <h3 className="text-slate-900 text-md font-black uppercase tracking-tighter">AI Performance Insights</h3>
                <p className="text-slate-500 text-[9px] font-black uppercase tracking-widest mt-0.5">LLM Driven Correlation & Trend Detection</p>
              </div>
            </div>
            {isLoading && (
              <div className="flex items-center gap-3 text-cyan-600 text-[9px] font-black tracking-[0.2em] animate-pulse">
                <RefreshCw size={14} className="animate-spin" />
                COMPUTING
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-slate-50/30 no-scrollbar">
            {chatHistory.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-6">
                  <Info size={24} className="text-cyan-600" />
                </div>
                <h4 className="text-xl font-black text-slate-900 uppercase tracking-tighter">Integrated Lab Diagnostics</h4>
                <p className="text-slate-500 text-xs font-medium mt-3 leading-relaxed">System ready. Current dataset covers metabolic efficiency and training load responses. Select a protocol query or input custom analysis parameters.</p>
                <div className="grid grid-cols-1 gap-2 mt-8 w-full">
                  {[
                    "Quantify HRV impact post high-intensity sessions",
                    "Analyze correlation: Weight loss vs Strength volume",
                    "Detect training stress plateaus",
                    "Evaluate dose-protocol efficiency"
                  ].map(q => (
                    <button key={q} onClick={() => setUserInput(q)} className="px-4 py-3 bg-white border border-slate-200 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-cyan-600 hover:border-cyan-500 transition-all text-left text-slate-500 hover:text-white shadow-sm">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {chatHistory.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] p-6 rounded-xl ${
                  msg.role === 'user' 
                    ? 'bg-cyan-600 text-white rounded-tr-none shadow-md' 
                    : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none shadow-sm'
                }`}>
                  <div className="text-base font-semibold leading-relaxed font-sans tracking-tight">
                    {msg.text.split('\n').map((line, idx) => (
                      <p key={idx} className={idx > 0 ? 'mt-3' : ''}>{line}</p>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="p-6 bg-white border-t border-slate-200 flex gap-4">
            <input 
              type="text" 
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Query performance model..."
              className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-6 py-4 text-xs focus:ring-2 focus:ring-cyan-500/20 outline-none transition-all font-bold text-slate-900 placeholder:text-slate-300 placeholder:uppercase"
            />
            <button onClick={handleSendMessage} disabled={isLoading || !userInput.trim()} className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-100 disabled:text-slate-400 text-white px-8 rounded-lg transition-all shadow-md active:scale-95 flex items-center gap-3 font-black text-xs uppercase tracking-widest">
              <Sparkles size={16} />
              Analyze
            </button>
          </div>
        </section>
      </main>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-cyan-50 text-cyan-600 rounded-lg">
                  <Key size={20} />
                </div>
                <h3 className="font-black uppercase tracking-tighter">API Configuration</h3>
              </div>
              <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-slate-600">
                <Plus size={20} className="rotate-45" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Gemini API Key</label>
                <input 
                  type="password" 
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="Enter your API key..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-cyan-500/20 outline-none transition-all font-mono"
                />
                <p className="mt-2 text-[10px] text-slate-400 leading-relaxed">
                  Your key is stored locally in your browser and never sent to our servers. 
                  You can get a free key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-cyan-600 hover:underline">AI Studio</a>.
                </p>
              </div>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="flex-1 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveApiKey}
                className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest shadow-md transition-all"
              >
                Save Configuration
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
