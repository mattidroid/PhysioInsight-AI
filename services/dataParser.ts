
import { DaySummary } from '../types';

/**
 * Robust CSV parser that handles quoted fields and identifies file types.
 */
export function parseTrainingPeaksCSV(csvContent: string, existingData: DaySummary[] = []): DaySummary[] {
  const lines = csvContent.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) return existingData;

  const headerLine = lines[0].toLowerCase();
  const dailyMap: Map<string, DaySummary> = new Map();
  
  // Rehydrate existing data
  existingData.forEach(d => dailyMap.set(d.date, d));

  const isWorkoutFile = headerLine.includes('tss') || headerLine.includes('workoutday');
  const isMetricsFile = headerLine.includes('type') && headerLine.includes('value');

  // Find header indices for Workout file
  const rawHeaders = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
  const dateIdx = rawHeaders.indexOf('workoutday');
  const typeIdx = rawHeaders.indexOf('workouttype');
  const tssIdx = rawHeaders.indexOf('tss');
  const hoursIdx = rawHeaders.indexOf('timetotalinhours');
  const energyIdx = rawHeaders.indexOf('energy');

  lines.slice(1).forEach(line => {
    // Regex to handle quoted CSV fields with commas inside
    const matches = [];
    let match;
    const regex = /(?:"([^"]*(?:""[^"]*)*)"|([^",\s]+))/g;
    
    while ((match = regex.exec(line)) !== null) {
      matches.push(match[1] || match[2] || "");
    }

    if (isMetricsFile && matches.length >= 3) {
      const date = matches[0].split(' ')[0];
      const type = matches[1].toLowerCase();
      const value = matches[2];
      const numVal = parseFloat(value);

      if (!dailyMap.has(date)) dailyMap.set(date, { date });
      const day = dailyMap.get(date)!;

      if (type.includes('pulse')) day.pulse = numVal;
      else if (type.includes('steps')) day.steps = (day.steps || 0) + (isNaN(numVal) ? 0 : numVal);
      else if (type.includes('hrv')) day.hrv = numVal;
      else if (type.includes('weight')) day.weight = numVal;
      else if (type.includes('bmi')) day.bmi = numVal;
      else if (type.includes('sleep') || type.includes('slp') || type.includes('hours slept')) {
        // Specifically looking for the primary "Sleep Hours" metric
        if (type === 'sleep hours' || type === 'hours slept' || type === 'sleep') {
          day.sleepHours = numVal;
        }
      }
      else if (type.includes('notes')) day.notes = (day.notes ? day.notes + ' | ' : '') + value;
    } 
    else if (isWorkoutFile && dateIdx !== -1) {
      const date = matches[dateIdx];
      if (!date) return;

      if (!dailyMap.has(date)) dailyMap.set(date, { date });
      const day = dailyMap.get(date)!;

      const tss = parseFloat(matches[tssIdx]) || 0;
      const hours = parseFloat(matches[hoursIdx]) || 0;
      const type = matches[typeIdx] || '';
      const energy = parseFloat(matches[energyIdx]) || 0;

      day.tss = (day.tss || 0) + tss;
      day.totalTrainingHours = (day.totalTrainingHours || 0) + hours;
      day.energyExpended = (day.energyExpended || 0) + energy;
      day.workoutTypes = Array.from(new Set([...(day.workoutTypes || []), type]));
      day.totalWorkouts = (day.totalWorkouts || 0) + 1;
      if (type.toLowerCase().includes('strength')) {
        day.isStrengthDay = true;
      }
    }
  });

  return Array.from(dailyMap.values())
    .sort((a, b) => a.date.localeCompare(b.date));
}
