
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  Area, ScatterChart, Scatter, Legend, ComposedChart, Bar, Line,
  ReferenceArea, Label
} from 'recharts';
import { 
  Activity, Moon, Scale, Zap, TrendingDown, MessageSquare, Sparkles,
  Heart, Upload, FileText, RefreshCw, Dumbbell, Bike, Plus, Pill, Calendar, Clock, Filter, 
  Target, BarChart3, Info, Waves, Mountain, Settings, Key, Printer, Maximize2, MoveVertical
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
  const [showPrintHint, setShowPrintHint] = useState(false);
  const [splitRatio, setSplitRatio] = useState(50);
  const [totalChartHeight, setTotalChartHeight] = useState(850);
  const [apiKeyInput, setApiKeyInput] = useState(localStorage.getItem('GEMINI_API_KEY') || '');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [targetWeight, setTargetWeight] = useState<number | null>(null);
  const [projectionDays, setProjectionDays] = useState<number>(30);
  const [showProjection, setShowProjection] = useState(false);
  const [showTss, setShowTss] = useState(true);
  const [showSleep, setShowSleep] = useState(true);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const isResizingSplit = useRef(false);
  const isResizingTotal = useRef(false);

  const handleMouseDownSplit = (e: React.MouseEvent) => {
    isResizingSplit.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const handleMouseDownTotal = (e: React.MouseEvent) => {
    isResizingTotal.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!chartContainerRef.current) return;
    const rect = chartContainerRef.current.getBoundingClientRect();

    if (isResizingSplit.current) {
      const newRatio = ((e.clientY - rect.top) / rect.height) * 100;
      if (newRatio > 20 && newRatio < 80) {
        setSplitRatio(newRatio);
      }
    } else if (isResizingTotal.current) {
      const newHeight = e.clientY - rect.top;
      if (newHeight > 500 && newHeight < 2000) {
        setTotalChartHeight(newHeight);
      }
    }
  };

  const handleMouseUp = () => {
    isResizingSplit.current = false;
    isResizingTotal.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'default';
    document.body.style.userSelect = 'auto';
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  useEffect(() => {
    if (data && data.length > 0) {
      const dates = data.filter(d => d && d.date).map(d => d.date).sort();
      if (dates.length > 0) {
        const firstDate = dates[0];
        const lastDate = dates[dates.length - 1];
        if (!startDate && firstDate) setStartDate(firstDate);
        if (!endDate && lastDate) setEndDate(lastDate);
      }
    }
  }, [data, startDate, endDate]);

  const workoutFilteredData = useMemo(() => {
    if (!data) return [];
    if (selectedWorkoutType === 'All') return data;
    return data.map(d => {
      if (!d) return d;
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

  const filteredData = useMemo(() => {
    let result = workoutFilteredData || [];
    if (startDate) {
      result = result.filter(d => d && d.date && d.date >= startDate);
    }
    if (endDate) {
      result = result.filter(d => d && d.date && d.date <= endDate);
    }
    return result;
  }, [workoutFilteredData, startDate, endDate]);

  const workoutTypes = useMemo(() => {
    const types = new Set<string>();
    if (data) {
      data.forEach(d => {
        if (d && d.workoutTypes) {
          d.workoutTypes.forEach(t => {
            if (t && t.trim() !== '') types.add(t);
          });
        }
      });
    }
    return ['All', ...Array.from(types).sort()];
  }, [data]);

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
    const totalSpanDays = filteredData.length;

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
    if (workoutFilteredData.length === 0) return [];
    const segments: DoseSegment[] = [];
    const doseDayIndices: number[] = [];
    workoutFilteredData.forEach((day, idx) => {
      if (day.notes?.match(/(\d+(?:\.\d+)?)\s*mg/i)) doseDayIndices.push(idx);
    });
    if (doseDayIndices.length === 0) return [];

    for (let i = 0; i < doseDayIndices.length; i++) {
      const startIdx = doseDayIndices[i];
      const nextDoseIdx = doseDayIndices[i + 1]; 
      const startDay = workoutFilteredData[startIdx];
      const doseMatch = startDay.notes?.match(/(\d+(?:\.\d+)?)\s*mg/i);
      const doseValue = doseMatch ? `${doseMatch[1]}mg` : "Unknown";

      let startWeight = workoutFilteredData[startIdx].weight || null;
      if (startWeight === null) {
        const limit = nextDoseIdx || workoutFilteredData.length;
        for (let j = startIdx; j < limit; j++) {
          if (workoutFilteredData[j].weight && workoutFilteredData[j].weight > 0) {
            startWeight = workoutFilteredData[j].weight!;
            break;
          }
        }
      }

      let endWeight = null;
      if (nextDoseIdx !== undefined) {
        endWeight = workoutFilteredData[nextDoseIdx].weight || null;
        if (endWeight === null) {
          for (let j = nextDoseIdx; j >= startIdx; j--) {
            if (workoutFilteredData[j].weight && workoutFilteredData[j].weight > 0) {
              endWeight = workoutFilteredData[j].weight!;
              break;
            }
          }
        }
      } else {
        for (let j = workoutFilteredData.length - 1; j >= startIdx; j--) {
          if (workoutFilteredData[j].weight && workoutFilteredData[j].weight > 0) {
            endWeight = workoutFilteredData[j].weight!;
            break;
          }
        }
      }

      let totalTss = 0;
      const tssLimit = nextDoseIdx !== undefined ? nextDoseIdx : workoutFilteredData.length;
      for (let j = startIdx; j < tssLimit; j++) totalTss += (workoutFilteredData[j].tss || 0);

      segments.push({
        dose: doseValue,
        startDate: workoutFilteredData[startIdx]?.date || "Unknown",
        endDate: nextDoseIdx !== undefined 
          ? (workoutFilteredData[nextDoseIdx]?.date || "Unknown") 
          : (workoutFilteredData[workoutFilteredData.length - 1]?.date || "Unknown"),
        startWeight,
        endWeight,
        weightLoss: (startWeight && endWeight) ? parseFloat((startWeight - endWeight).toFixed(1)) : 0,
        totalTss: Math.round(totalTss),
        days: tssLimit - startIdx
      });
    }
    return segments;
  }, [workoutFilteredData]);

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

  const weightProjectionStats = useMemo(() => {
    const weightEntries = filteredData.filter(d => d && d.weight && d.weight > 0);
    if (!showProjection || !targetWeight || weightEntries.length < 2) {
      return {
        hasData: weightEntries.length >= 2,
        dailyRate: 0,
        isHeadingToTarget: false,
        projectedDate: null,
        daysToTarget: null,
        currentWeight: weightEntries.length > 0 ? weightEntries[weightEntries.length - 1].weight : null,
      };
    }

    const lastDays = weightEntries.slice(-14);
    const first = lastDays[0];
    const last = lastDays[lastDays.length - 1];
    const dayDiff = (new Date(last.date).getTime() - new Date(first.date).getTime()) / (1000 * 60 * 60 * 24);
    const weightDiff = last.weight - first.weight;

    if (dayDiff <= 0) {
      return {
        hasData: true,
        dailyRate: 0,
        isHeadingToTarget: false,
        projectedDate: null,
        daysToTarget: null,
        currentWeight: last.weight,
      };
    }

    const dailyRate = weightDiff / dayDiff;
    const currentWeight = last.weight;
    const isHeadingToTarget = (dailyRate < 0 && currentWeight > targetWeight) || (dailyRate > 0 && currentWeight < targetWeight);
    
    let projectedDate: string | null = null;
    let daysToTarget: number | null = null;

    if (isHeadingToTarget && dailyRate !== 0) {
      daysToTarget = Math.ceil((targetWeight - currentWeight) / dailyRate);
      const targetDateObj = new Date(last.date);
      targetDateObj.setDate(targetDateObj.getDate() + daysToTarget);
      projectedDate = targetDateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    return {
      hasData: true,
      dailyRate,
      isHeadingToTarget,
      projectedDate,
      daysToTarget,
      currentWeight,
    };
  }, [filteredData, showProjection, targetWeight]);

  const processedChartData = useMemo(() => {
    if (filteredData.length === 0) return [];
    const getWeekId = (dateStr: string) => {
      const date = new Date(dateStr);
      // Adjust to Monday of the current week
      const day = date.getDay(); 
      const diff = date.getDate() - (day === 0 ? 6 : day - 1);
      const monday = new Date(date.getFullYear(), date.getMonth(), diff);
      return monday.toISOString().split('T')[0];
    };

    if (chartViewMode === 'weekly') {
      const weeks: Record<string, { weekId: string, firstDate: string, tss: number, weights: number[], hrvs: number[], pulses: number[], sleepHours: number[] }> = {};
      filteredData.forEach(d => {
        if (!d || !d.date) return;
        const weekId = getWeekId(d.date);
        if (!weeks[weekId]) weeks[weekId] = { weekId, firstDate: weekId, tss: 0, weights: [], hrvs: [], pulses: [], sleepHours: [] };
        weeks[weekId].tss += (d.tss || 0);
        if (d.weight && d.weight > 0) weeks[weekId].weights.push(d.weight);
        if (d.hrv && d.hrv > 0) weeks[weekId].hrvs.push(d.hrv);
        if (d.pulse && d.pulse > 0) weeks[weekId].pulses.push(d.pulse);
        if (d.sleepHours && d.sleepHours > 0) weeks[weekId].sleepHours.push(d.sleepHours);
      });
      
      const weeklyDataList = Object.values(weeks).map(w => {
        const weight = w.weights.length > 0 ? parseFloat((w.weights.reduce((a, b) => a + b, 0) / w.weights.length).toFixed(1)) : null;
        const hrv = w.hrvs.length > 0 ? Math.round(w.hrvs.reduce((a, b) => a + b, 0) / w.hrvs.length) : null;
        const pulse = w.pulses.length > 0 ? Math.round(w.pulses.reduce((a, b) => a + b, 0) / w.pulses.length) : null;
        const sleepHours = w.sleepHours.length > 0 ? parseFloat(w.sleepHours.reduce((a, b) => a + b, 0).toFixed(1)) : null;
        const sleepHoursAvg = w.sleepHours.length > 0 ? parseFloat((w.sleepHours.reduce((a, b) => a + b, 0) / w.sleepHours.length).toFixed(1)) : null;
        return {
          label: w.firstDate,
          weekId: w.weekId,
          tss: Math.round(w.tss),
          weight,
          hrv,
          pulse,
          sleepHours,
          sleepHoursAvg,
          weightTrend: weight,
          hrvTrend: hrv,
          pulseTrend: pulse,
          weightProjection: null as number | null,
          isProjected: false
        };
      });

      // Weekly Projection Logic
      if (showProjection && targetWeight && weightProjectionStats.isHeadingToTarget && weightProjectionStats.dailyRate !== 0 && weeklyDataList.length > 0) {
        const lastWeekEntry = weeklyDataList[weeklyDataList.length - 1];
        lastWeekEntry.weightProjection = lastWeekEntry.weight || weightProjectionStats.currentWeight;
        
        const lastWeekDate = new Date(lastWeekEntry.label);
        let projectedWeight = lastWeekEntry.weight || weightProjectionStats.currentWeight || targetWeight;
        const weeksToProject = Math.min(Math.ceil(projectionDays / 7), Math.ceil((weightProjectionStats.daysToTarget || projectionDays) / 7));

        for (let i = 1; i <= weeksToProject; i++) {
          projectedWeight += weightProjectionStats.dailyRate * 7;
          
          const nextDate = new Date(lastWeekDate);
          nextDate.setDate(lastWeekDate.getDate() + (i * 7));
          const dateStr = nextDate.toISOString().split('T')[0];
          
          weeklyDataList.push({
            label: dateStr,
            weekId: dateStr,
            tss: 0,
            weight: null,
            hrv: null,
            pulse: null,
            sleepHours: null,
            sleepHoursAvg: null,
            weightTrend: null,
            weightProjection: parseFloat(projectedWeight.toFixed(1)),
            hrvTrend: null,
            pulseTrend: null,
            isProjected: true
          });

          // Stop if reached target
          if ((weightProjectionStats.dailyRate < 0 && projectedWeight <= targetWeight) || (weightProjectionStats.dailyRate > 0 && projectedWeight >= targetWeight)) {
            break;
          }
        }
      }

      return weeklyDataList;
    } else {
      let rawDaily = filteredData.filter(d => d && d.date).map(d => {
        return {
          label: d.date,
          weight: d.weight || null,
          hrv: d.hrv || null,
          pulse: d.pulse || null,
          tss: (typeof d.tss === 'number') ? Math.round(d.tss) : 0,
          sleepHours: d.sleepHours || null,
        };
      });

      // Apply interpolation for smoother trends in daily precision mode
      rawDaily = interpolateData(rawDaily, 'weight');
      rawDaily = interpolateData(rawDaily, 'hrv');
      rawDaily = interpolateData(rawDaily, 'pulse');

      const calculateMA = (arr: any[], key: string, window: number) => {
        return arr.map((_, idx) => {
          const start = Math.max(0, idx - window + 1);
          const subset = arr.slice(start, idx + 1).map(d => d[key]).filter(v => v !== null);
          if (subset.length === 0) return null;
          return parseFloat((subset.reduce((a, b) => a + b, 0) / subset.length).toFixed(2));
        });
      };

      const weightTrends = calculateMA(rawDaily, 'weight', 7);
      const hrvTrends = calculateMA(rawDaily, 'hrv', 7);
      const pulseTrends = calculateMA(rawDaily, 'pulse', 7);

      let finalData = rawDaily.map((d, i) => ({
        ...d,
        weightTrend: weightTrends[i],
        hrvTrend: hrvTrends[i],
        pulseTrend: pulseTrends[i],
        weightProjection: null as number | null,
        isProjected: false
      }));

      // Weight Projection Logic
      if (showProjection && targetWeight && weightProjectionStats.isHeadingToTarget && weightProjectionStats.dailyRate !== 0 && finalData.length > 0) {
        const lastEntry = finalData[finalData.length - 1];
        lastEntry.weightProjection = lastEntry.weight || weightProjectionStats.currentWeight;
        
        const lastDate = new Date(lastEntry.label);
        let projectedWeight = lastEntry.weight || weightProjectionStats.currentWeight || targetWeight;
        const daysToProject = Math.min(projectionDays, weightProjectionStats.daysToTarget || projectionDays);

        for (let i = 1; i <= daysToProject; i++) {
          projectedWeight += weightProjectionStats.dailyRate;
          
          const nextDate = new Date(lastDate);
          nextDate.setDate(lastDate.getDate() + i);
          const dateStr = nextDate.toISOString().split('T')[0];
          
          finalData.push({
            label: dateStr,
            weight: null,
            hrv: null,
            pulse: null,
            tss: 0,
            sleepHours: null,
            weightTrend: null,
            weightProjection: parseFloat(projectedWeight.toFixed(2)),
            hrvTrend: null,
            pulseTrend: null,
            isProjected: true
          } as any);

          // Stop if reached target
          if ((weightProjectionStats.dailyRate < 0 && projectedWeight <= targetWeight) || (weightProjectionStats.dailyRate > 0 && projectedWeight >= targetWeight)) {
            break;
          }
        }
      }

      return finalData;
    }
  }, [filteredData, chartViewMode, showProjection, targetWeight, projectionDays, weightProjectionStats]);

  const chartDoseSegments = useMemo(() => {
    if (doseSegments.length === 0 || processedChartData.length === 0) return [];
    
    return doseSegments.map(seg => {
      const findClosest = (targetDate: string) => {
        let closest = processedChartData[0].label;
        let minDiff = Math.abs(new Date(targetDate).getTime() - new Date(closest).getTime());
        
        processedChartData.forEach(d => {
          const diff = Math.abs(new Date(targetDate).getTime() - new Date(d.label).getTime());
          if (diff < minDiff) {
            minDiff = diff;
            closest = d.label;
          }
        });
        return closest;
      };

      return {
        ...seg,
        chartStart: findClosest(seg.startDate),
        chartEnd: findClosest(seg.endDate)
      };
    });
  }, [doseSegments, processedChartData]);

  const formatXAxis = (tickItem: string) => {
    try {
      const date = new Date(tickItem);
      if (isNaN(date.getTime())) return tickItem;
      
      // ISO Week calculation
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
      const year = d.getUTCFullYear().toString().slice(-2);
      
      return `${week}.${year}`;
    } catch (e) {
      return tickItem;
    }
  };

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

  const handlePrint = () => {
    if (window.self !== window.top) {
      setShowPrintHint(true);
      setTimeout(() => setShowPrintHint(false), 5000);
      return;
    }
    window.print();
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
        <div className="flex items-center gap-4 relative">
          {showPrintHint && (
            <div className="absolute top-full mt-2 right-0 w-64 bg-slate-900 text-white p-3 rounded-lg text-[10px] font-bold leading-relaxed shadow-xl z-[60] animate-in fade-in slide-in-from-top-1">
              <div className="flex gap-2">
                <Info size={14} className="text-cyan-400 shrink-0" />
                <p>Browser security blocks printing inside iframes. Please <span className="text-cyan-400">open the app in a new tab</span> using the icon above to print your report.</p>
              </div>
              <div className="absolute -top-1 right-24 w-2 h-2 bg-slate-900 rotate-45"></div>
            </div>
          )}
          <button onClick={handlePrint} className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-black uppercase tracking-widest transition-all shadow-md" title="Print Report">
            <Printer size={14} />
            Print Report
          </button>
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
        <section className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
           <div className="flex items-center gap-4 overflow-x-auto no-scrollbar scroll-smooth w-full lg:w-auto">
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

           <div className="flex items-center gap-4 bg-slate-50 p-2 rounded-lg border border-slate-200 w-full lg:w-auto">
             <div className="flex items-center gap-2 text-slate-400 px-2 border-r border-slate-200">
               <Calendar size={14} />
               <span className="text-[9px] font-black uppercase tracking-widest">Date Range</span>
             </div>
             <div className="flex items-center gap-2 flex-1 lg:flex-none">
               <input 
                 type="date" 
                 value={startDate}
                 onChange={(e) => setStartDate(e.target.value)}
                 className="bg-transparent text-[10px] font-bold text-slate-600 outline-none cursor-pointer hover:text-cyan-600 transition-colors"
               />
               <span className="text-slate-300">—</span>
               <input 
                 type="date" 
                 value={endDate}
                 onChange={(e) => setEndDate(e.target.value)}
                 className="bg-transparent text-[10px] font-bold text-slate-600 outline-none cursor-pointer hover:text-cyan-600 transition-colors"
               />
             </div>
             <button 
               onClick={() => {
                 if (data && data.length > 0) {
                   const dates = data.filter(d => d && d.date).map(d => d.date).sort();
                   if (dates.length > 0) {
                     setStartDate(dates[0]);
                     setEndDate(dates[dates.length - 1]);
                   }
                 }
               }}
               className="p-1.5 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-600 transition-all"
               title="Reset Date Range"
             >
               <RefreshCw size={12} />
             </button>
           </div>
        </section>

        {/* Goals & Projections */}
        <section className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center gap-6">
           <div className="flex items-center gap-2 text-cyan-600 shrink-0">
             <Target size={18} />
             <span className="text-xs font-black uppercase tracking-widest text-slate-900">Goals & Projections</span>
           </div>
           
           <div className="flex items-center gap-4 bg-slate-50 p-2 rounded-lg border border-slate-200">
             <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-2 border-r border-slate-200">Weight Trend Projection</span>
             <div className="flex items-center gap-3">
               <button 
                 onClick={() => setShowProjection(!showProjection)}
                 className={`px-4 py-1.5 rounded-md text-[10px] font-black uppercase tracking-widest transition-all ${showProjection ? 'bg-cyan-600 text-white shadow-md' : 'bg-white text-slate-400 border border-slate-200'}`}
               >
                 {showProjection ? 'Active' : 'Disabled'}
               </button>
               
               {showProjection && (
                 <div className="flex items-center gap-4 animate-in fade-in slide-in-from-left-2 duration-300">
                   <div className="flex items-center gap-2">
                     <label className="text-[9px] font-black uppercase tracking-widest text-slate-500">Target Weight</label>
                     <div className="relative">
                       <input 
                         type="number" 
                         value={targetWeight || ''} 
                         onChange={(e) => setTargetWeight(parseFloat(e.target.value) || null)}
                         placeholder="0.0"
                         className="w-20 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-black outline-none focus:border-cyan-500 transition-all"
                       />
                       <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-300 uppercase">kg</span>
                     </div>
                   </div>
                   
                   <div className="flex items-center gap-2">
                     <label className="text-[9px] font-black uppercase tracking-widest text-slate-500">Max Projection</label>
                     <div className="relative">
                       <input 
                         type="number" 
                         value={projectionDays} 
                         onChange={(e) => setProjectionDays(parseInt(e.target.value) || 0)}
                         className="w-16 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-black outline-none focus:border-cyan-500 transition-all"
                       />
                       <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-300 uppercase">Days</span>
                     </div>
                   </div>
                 </div>
               )}
             </div>
           </div>
           
           {showProjection && targetWeight && (
             <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 ml-auto bg-slate-50 border border-slate-200 rounded-xl p-1.5 px-3 min-w-0">
               <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${
                 !weightProjectionStats.hasData 
                   ? 'bg-amber-50 border-amber-200 text-amber-700' 
                   : weightProjectionStats.isHeadingToTarget 
                   ? 'bg-cyan-50 border-cyan-100 text-cyan-700' 
                   : 'bg-rose-50 border-rose-100 text-rose-700'
               }`}>
                 {!weightProjectionStats.hasData ? (
                   <>
                     <Info size={14} className="animate-pulse" />
                     <span className="text-[10px] font-black uppercase tracking-widest">
                       Insufficient weight data to project trend (needs at least 2 days with logs)
                     </span>
                   </>
                 ) : weightProjectionStats.isHeadingToTarget ? (
                   <>
                     <Sparkles size={14} className="text-cyan-600 animate-pulse" />
                     <span className="text-[10px] font-black uppercase tracking-widest">
                       Projected to reach <strong className="font-extrabold text-cyan-800">{targetWeight}kg</strong> on <strong className="font-extrabold text-cyan-800">{weightProjectionStats.projectedDate}</strong> ({weightProjectionStats.daysToTarget} days at {Math.abs(weightProjectionStats.dailyRate * 1000).toFixed(0)}g/day)
                     </span>
                   </>
                 ) : (
                   <>
                     <TrendingDown size={14} className="rotate-180" />
                     <span className="text-[10px] font-black uppercase tracking-widest text-rose-700">
                       Current trend ({weightProjectionStats.dailyRate > 0 ? '+' : ''}{(weightProjectionStats.dailyRate * 1000).toFixed(0)}g/day) is moving away from {targetWeight}kg
                     </span>
                   </>
                 )}
               </div>
             </div>
           )}
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
        <div ref={chartContainerRef} style={{ height: `${totalChartHeight}px` }} className="flex flex-col gap-0 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Section 1: Workload & Mass */}
          <div 
            style={{ height: `${splitRatio}%` }}
            className="p-8 pb-4 border-b border-slate-200 relative flex flex-col min-h-[200px]"
          >
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6 gap-4 relative z-10">
              <div>
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-tighter flex items-center gap-2">
                  <BarChart3 size={18} className="text-cyan-600" />
                  Performance Load and Weight Response
                </h3>
                <p className="text-slate-400 text-[9px] font-bold uppercase tracking-widest mt-1">Correlation of mechanical work vs somatic mass.</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3 bg-slate-50 p-1 px-3 rounded-lg border border-slate-200 shrink-0">
                  <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">Height</span>
                  <input 
                    type="range" 
                    min="600" 
                    max="1500" 
                    step="50"
                    value={totalChartHeight}
                    onChange={(e) => setTotalChartHeight(parseInt(e.target.value))}
                    className="w-24 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-cyan-600"
                  />
                </div>
                <div className="flex bg-slate-50 p-1 rounded-lg border border-slate-200 shrink-0">
                  <button onClick={() => setChartViewMode('daily')} className={`px-3 py-1 rounded-md text-[8px] font-black uppercase tracking-widest transition-all ${chartViewMode === 'daily' ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Daily</button>
                  <button onClick={() => setChartViewMode('weekly')} className={`px-3 py-1 rounded-md text-[8px] font-black uppercase tracking-widest transition-all ${chartViewMode === 'weekly' ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Weekly</button>
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={processedChartData} syncId="performanceSync">
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                  <XAxis 
                    dataKey="label" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 8, fontWeight: 800, fill: '#64748b' }} 
                    height={30} 
                    tickFormatter={formatXAxis}
                  />
                  <YAxis yAxisId="left" domain={['dataMin - 0.5', 'dataMax + 0.5']} orientation="left" stroke="#f43f5e" axisLine={false} tickLine={false} tick={{fontSize: 8, fontWeight: 700}} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 'auto']} stroke="#0891b2" axisLine={false} tickLine={false} tick={{fontSize: 8, fontWeight: 700}} hide={!showTss} />
                  <Tooltip 
                    cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                    contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    itemStyle={{ fontSize: '10px', fontWeight: 'bold' }}
                    labelStyle={{ fontSize: '11px', fontWeight: 'black', color: '#0f172a', marginBottom: '4px' }}
                    labelFormatter={(label, payload) => {
                      if (chartViewMode === 'weekly' && payload && payload[0]) {
                        return payload[0].payload.weekId || label;
                      }
                      return new Date(label).toLocaleDateString();
                    }}
                  />
                  <Legend 
                    verticalAlign="top" 
                    height={36} 
                    iconType="rect" 
                    align="right" 
                    wrapperStyle={{fontSize: '8px', fontWeight: 'black', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer'}} 
                    onClick={(e) => {
                      if (e.dataKey === 'tss') setShowTss(!showTss);
                    }}
                  />
                  
                  {chartDoseSegments.map((seg, idx) => (
                    <React.Fragment key={`perf-dose-${idx}`}>
                      <ReferenceArea
                        {...({
                          x1: seg.chartStart,
                          x2: seg.chartEnd,
                          yAxisId: "left",
                          fill: idx % 2 === 0 ? "rgba(8, 145, 178, 0.04)" : "transparent",
                          strokeOpacity: 0
                        } as any)}
                      >
                        <Label 
                          value={seg.dose} 
                          position="insideTopLeft" 
                          fontSize={8} 
                          fontWeight="900" 
                          fill="#0891b2" 
                          offset={5}
                          className="uppercase tracking-tighter opacity-50"
                        />
                      </ReferenceArea>
                    </React.Fragment>
                  ))}

                  <Bar yAxisId="right" dataKey="tss" name="Load (TSS)" fill="#0891b2" opacity={0.15} radius={[2, 2, 0, 0]} hide={!showTss} />
                  <Area yAxisId="left" type="monotone" dataKey="weight" name="Mass (kg)" stroke="#f43f5e" strokeWidth={1} fill="rgba(244,63,94,0.05)" connectNulls={true} dot={false} />
                  <Line yAxisId="left" type="monotone" dataKey="weightTrend" name="Weight Trend (7d)" stroke="#f43f5e" strokeWidth={3} dot={false} connectNulls={true} legendType="none" />
                  <Line yAxisId="left" type="monotone" dataKey="weightProjection" name="Projection" stroke="#f43f5e" strokeWidth={3} strokeDasharray="5 5" dot={false} connectNulls={true} legendType="none" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Resize Handle (Split) */}
          <div 
            onMouseDown={handleMouseDownSplit}
            className="h-2 bg-slate-50 hover:bg-cyan-100 cursor-row-resize flex items-center justify-center transition-colors border-y border-slate-200 group z-20"
          >
            <div className="w-12 h-1 bg-slate-200 group-hover:bg-cyan-300 rounded-full"></div>
          </div>

          {/* Section 2: Cardiovascular Recovery */}
          <div 
            style={{ height: `${100 - splitRatio}%` }}
            className="p-8 pt-4 relative flex flex-col min-h-[200px]"
          >
            <div className="mb-4">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-tighter flex items-center gap-2">
                <Waves size={16} className="text-rose-500" />
                Cardiovascular Response
              </h3>
              <p className="text-slate-400 text-[9px] font-bold uppercase tracking-widest mt-1">Autonomous nervous system (HRV) and Basal Heart Rate (RHR).</p>
            </div>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={processedChartData} syncId="performanceSync">
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                  <XAxis 
                    dataKey="label" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 8, fontWeight: 800, fill: '#64748b' }} 
                    height={30} 
                    tickFormatter={formatXAxis}
                  />
                  <YAxis yAxisId="left" domain={['dataMin - 10', 'dataMax + 10']} orientation="left" stroke="#f43f5e" axisLine={false} tickLine={false} tick={{fontSize: 8, fontWeight: 700}} />
                  <YAxis yAxisId="right" orientation="right" domain={['dataMin - 5', 'dataMax + 5']} stroke="#94a3b8" axisLine={false} tickLine={false} tick={{fontSize: 8, fontWeight: 700}} />
                  <YAxis yAxisId="sleep" orientation="right" domain={[0, 'auto']} stroke="#8b5cf6" axisLine={false} tickLine={false} tick={{fontSize: 8, fontWeight: 700}} hide={true} />
                  <Tooltip 
                    cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                    contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    itemStyle={{ fontSize: '10px', fontWeight: 'bold' }}
                    labelStyle={{ fontSize: '11px', fontWeight: 'black', color: '#0f172a', marginBottom: '4px' }}
                    labelFormatter={(label, payload) => {
                      if (chartViewMode === 'weekly' && payload && payload[0]) {
                        return payload[0].payload.weekId || label;
                      }
                      return new Date(label).toLocaleDateString();
                    }}
                    formatter={(value: any, name: string, props: any) => {
                      if (name === 'Sleep' && chartViewMode === 'weekly' && props?.payload?.sleepHoursAvg !== undefined && props?.payload?.sleepHoursAvg !== null) {
                        return [`${value} hrs (Avg: ${props.payload.sleepHoursAvg} hrs/day)`, name];
                      }
                      if (name === 'Sleep') {
                        return [`${value} hrs`, name];
                      }
                      return [value, name];
                    }}
                  />
                  <Legend 
                    verticalAlign="top" 
                    height={36} 
                    iconType="circle" 
                    align="right" 
                    wrapperStyle={{fontSize: '8px', fontWeight: 'black', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer'}} 
                    onClick={(e) => {
                      if (e.dataKey === 'sleepHours') setShowSleep(!showSleep);
                    }}
                  />
                  
                  {chartDoseSegments.map((seg, idx) => (
                    <React.Fragment key={`cardio-dose-${idx}`}>
                      <ReferenceArea
                        {...({
                          x1: seg.chartStart,
                          x2: seg.chartEnd,
                          yAxisId: "left",
                          fill: idx % 2 === 0 ? "rgba(244, 63, 94, 0.03)" : "transparent",
                          strokeOpacity: 0
                        } as any)}
                      >
                        <Label 
                          value={seg.dose} 
                          position="insideTopLeft" 
                          fontSize={8} 
                          fontWeight="900" 
                          fill="#f43f5e" 
                          offset={5}
                          className="uppercase tracking-tighter opacity-40"
                        />
                      </ReferenceArea>
                    </React.Fragment>
                  ))}

                  <Bar yAxisId="sleep" dataKey="sleepHours" name="Sleep" fill="#8b5cf6" opacity={0.12} radius={[2, 2, 0, 0]} hide={!showSleep} />
                  <Line yAxisId="left" type="monotone" dataKey="hrv" name="HRV" stroke="#f43f5e" strokeWidth={1} opacity={0.4} connectNulls={true} dot={false} />
                  <Line yAxisId="left" type="monotone" dataKey="hrvTrend" name="HRV Trend (7d)" stroke="#f43f5e" strokeWidth={3} connectNulls={true} dot={chartViewMode === 'weekly' ? { r: 3, fill: '#f43f5e', strokeWidth: 0 } : false} legendType="none" />
                  <Line yAxisId="right" type="monotone" dataKey="pulse" name="RHR" stroke="#94a3b8" strokeWidth={1} opacity={0.4} connectNulls={true} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="pulseTrend" name="RHR Trend (7d)" stroke="#94a3b8" strokeWidth={3} connectNulls={true} dot={chartViewMode === 'weekly' ? { r: 3, fill: '#94a3b8', strokeWidth: 0 } : false} legendType="none" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          
          {/* Resize Handle (Total Height) */}
          <div 
            onMouseDown={handleMouseDownTotal}
            className="h-4 bg-slate-50 hover:bg-slate-100 cursor-ns-resize flex items-center justify-center transition-colors border-t border-slate-200 group z-20"
          >
            <div className="flex gap-1">
              <div className="w-1 h-1 bg-slate-300 group-hover:bg-cyan-400 rounded-full"></div>
              <div className="w-1 h-1 bg-slate-300 group-hover:bg-cyan-400 rounded-full"></div>
              <div className="w-1 h-1 bg-slate-300 group-hover:bg-cyan-400 rounded-full"></div>
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
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 overflow-hidden flex flex-col h-full">
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
            <div className="bg-slate-50/50 rounded-xl p-6 border border-slate-200 flex flex-col h-full min-h-[400px]">
              <div className="mb-6">
                <h4 className="text-center text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Correlation Analysis: Mass Reduction vs Mechanical Work (TSS)</h4>
              </div>
              <div className="flex-1 min-h-0">
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
              </div>
            </div>
          </div>
        </section>

        {/* AI Performance Lab */}
        <section id="ai-chat-window" className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden flex flex-col h-[700px]">
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
