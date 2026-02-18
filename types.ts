
export enum MetricType {
  PULSE = "Pulse",
  STEPS = "Steps",
  HRV = "HRV",
  WOKEN = "Number Times Woken",
  DEEP_SLEEP = "Time In Deep Sleep",
  LIGHT_SLEEP = "Time In Light Sleep",
  REM_SLEEP = "Time In REM Sleep",
  AWAKE_TIME = "Time Awake",
  SLEEP_HOURS = "Sleep Hours",
  WEIGHT = "Weight Kilograms",
  BMI = "BMI",
  BLOOD_PRESSURE = "Blood Pressure",
  NOTES = "Notes",
  MUSCLE_MASS = "Muscle Mass Kilograms",
  PERCENT_FAT = "Percent Fat"
}

export interface DaySummary {
  date: string;
  // Metrics
  pulse?: number;
  steps?: number;
  hrv?: number;
  weight?: number;
  bmi?: number;
  sleepHours?: number;
  deepSleep?: number;
  remSleep?: number;
  notes?: string;
  fatPercent?: number;
  muscleMass?: number;
  systolic?: number;
  diastolic?: number;
  // Workouts
  tss?: number;
  totalTrainingHours?: number;
  workoutTypes?: string[];
  isStrengthDay?: boolean;
  totalWorkouts?: number;
  energyExpended?: number;
}

export interface RawDataRow {
  timestamp: string;
  type: string;
  value: string;
}
