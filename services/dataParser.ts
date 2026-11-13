
import { DaySummary } from '../types';

export type SubstanceMap = Record<string, string>;

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
  return result;
}

/**
 * Checks whether a CSV file is a substance abbreviation lookup table ("Short","Full").
 */
export function isSubstanceCSV(csvContent: string): boolean {
  const lines = csvContent.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) return false;
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());
  return headers.includes('short') && headers.includes('full');
}

/**
 * Parses a substance abbreviation CSV ("Short","Full") into a normalized lookup map.
 */
export function parseSubstancesCSV(csvContent: string, existingMap: SubstanceMap = {}): SubstanceMap {
  const lines = csvContent.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) return existingMap;

  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());
  const shortIdx = headers.indexOf('short');
  const fullIdx = headers.indexOf('full');

  if (shortIdx === -1 || fullIdx === -1) return existingMap;

  const updated: SubstanceMap = { ...existingMap };
  for (const line of lines.slice(1)) {
    const cols = parseCSVLine(line);
    if (cols.length <= Math.max(shortIdx, fullIdx)) continue;
    const shortCode = cols[shortIdx]?.trim().toUpperCase();
    const fullName = cols[fullIdx]?.trim();
    if (shortCode && fullName) {
      updated[shortCode] = fullName;
    }
  }

  return updated;
}

/**
 * Resolves a substance abbreviation and full name from a day's notes string
 * (e.g. "MJ/RT 5.0mg/1.0mg" -> { shortCode: "MJ/RT", fullName: "Mounjaro/Retatrutide" }).
 */
export function resolveSubstanceFromNotes(
  notes: string | undefined,
  substanceMap: SubstanceMap
): { shortCode?: string; fullName?: string } {
  if (!notes) return {};

  // Extract token(s) immediately preceding the dosage (e.g. "MJ/RT" in "MJ/RT 5.0mg/1.0mg")
  const doseMatch = notes.match(/([\d.]+(?:mg\/[\d.]+)?|[\d.]+(?:\/[\d.]+)?)\s*mg/i);
  const prefixText = doseMatch && doseMatch.index !== undefined
    ? notes.slice(0, doseMatch.index).trim()
    : notes.trim();

  // Grab last segment if notes has multiple pipe-separated entries
  const segment = prefixText.split('|').pop()?.trim() || '';
  const candidateTokens = segment.split(/\s+/).filter(Boolean);
  const rawShort = candidateTokens.length > 0 ? candidateTokens[candidateTokens.length - 1] : '';
  const upperShort = rawShort.replace(/[^a-zA-Z0-9/+_-]/g, '').toUpperCase();

  // 1. Direct exact match against dictionary keys
  if (upperShort && substanceMap[upperShort]) {
    return { shortCode: upperShort, fullName: substanceMap[upperShort] };
  }

  // 2. Composite abbreviations like "MJ/TE" when individual parts exist in dictionary
  if (upperShort && upperShort.includes('/')) {
    const parts = upperShort.split('/').filter(Boolean);
    const resolvedParts = parts.map(p => substanceMap[p]);
    if (parts.length > 1 && resolvedParts.every(Boolean)) {
      return { shortCode: upperShort, fullName: resolvedParts.join('/') };
    }
  }

  // 3. Fallback: search notes for any known dictionary key (longest first so MJ/RT beats MJ)
  const sortedKeys = Object.keys(substanceMap).sort((a, b) => b.length - a.length);
  const upperNotes = notes.toUpperCase();
  for (const key of sortedKeys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|[^A-Z0-9])${escaped}(?:$|[^A-Z0-9])`);
    if (regex.test(upperNotes)) {
      return { shortCode: key, fullName: substanceMap[key] };
    }
  }

  // 4. Return short code even if not yet mapped in dictionary
  if (upperShort && /^[A-Z][A-Z0-9/+-]*$/.test(upperShort)) {
    return { shortCode: upperShort };
  }

  return {};
}

/**
 * Robust CSV parser that handles quoted fields and identifies file types.
 */
export function parseTrainingPeaksCSV(csvContent: string, existingData: DaySummary[] = []): DaySummary[] {
  if (isSubstanceCSV(csvContent)) return existingData;

  const lines = csvContent.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) return existingData;

  const headerLine = lines[0].toLowerCase();
  const dailyMap: Map<string, DaySummary> = new Map();
  
  // Rehydrate existing data
  existingData.forEach(d => dailyMap.set(d.date, d));

  const isWorkoutFile = headerLine.includes('tss') || headerLine.includes('workoutday');
  const isMetricsFile = headerLine.includes('type') && headerLine.includes('value');

  // Find header indices for Workout file
  const rawHeaders = parseCSVLine(lines[0]).map(h => h.toLowerCase());
  const dateIdx = rawHeaders.indexOf('workoutday');
  const typeIdx = rawHeaders.indexOf('workouttype');
  const tssIdx = rawHeaders.indexOf('tss');
  const hoursIdx = rawHeaders.indexOf('timetotalinhours');
  const energyIdx = rawHeaders.indexOf('energy');

  lines.slice(1).forEach(line => {
    const matches = parseCSVLine(line);

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

