import { DaySummary } from "../types";

/**
 * Normalizes and formats error messages from Gemini / Google APIs and network proxies
 * so that raw JSON error payloads or HTML warmup pages are converted into clear, human-friendly guidance.
 */
export function cleanGeminiErrorMessage(raw: any): string {
  if (!raw) return 'Unable to analyze physiological data. Please try again.';

  let msg = typeof raw === 'string' ? raw.trim() : (raw.message || String(raw));

  // Extract clean inner message if raw stringified Google API JSON error
  if (msg.includes('{"error"') || (msg.startsWith('{') && msg.includes('"message"'))) {
    try {
      const jsonStart = msg.indexOf('{');
      const jsonEnd = msg.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        const parsed = JSON.parse(msg.slice(jsonStart, jsonEnd + 1));
        if (parsed?.error?.message) {
          msg = parsed.error.message;
        } else if (parsed?.message) {
          msg = parsed.message;
        }
      }
    } catch {
      // keep msg as is
    }
  }

  const lower = msg.toLowerCase();

  // Upstream HTML / warmup / proxy timeout / non-JSON errors
  if (
    lower.includes('unexpected token') ||
    lower.includes('<!doctype') ||
    lower.includes('is not valid json') ||
    lower.includes('warmup') ||
    lower.includes('bad gateway') ||
    lower.includes('gateway timeout') ||
    lower.includes('502') ||
    lower.includes('504')
  ) {
    return 'The AI service is briefly warming up or reconnecting. Please wait a moment and try your request again.';
  }

  // Model high demand / rate limits
  if (
    lower.includes('high demand') ||
    lower.includes('unavailable') ||
    lower.includes('code":503') ||
    lower.includes('status":503') ||
    lower.includes('status 503') ||
    lower.includes('resource_exhausted') ||
    lower.includes('rate limit') ||
    lower.includes('quota') ||
    lower.includes('429')
  ) {
    return 'The AI service is experiencing a temporary surge in traffic on Google servers. The system automatically retried with fallback models, but capacity remains tight. Please wait a moment and try your request again.';
  }

  // Auth / API key
  if (
    lower.includes('api key') ||
    lower.includes('unauthenticated') ||
    lower.includes('access_token_type_unsupported') ||
    lower.includes('code":401')
  ) {
    return 'Gemini API key is invalid or missing. Please click Settings (gear icon) to configure a valid API key.';
  }

  return msg;
}

/**
 * Extracts only relevant physiological metrics from up to the last 180 days to keep
 * payloads compact and prevent Node.js event-loop bottlenecks.
 */
function slimData(data: DaySummary[]): any[] {
  if (!Array.isArray(data)) return [];
  const recent = data.slice(-180);
  return recent.map((d) => ({
    date: d.date,
    weight: d.weight ?? null,
    hrv: d.hrv ?? null,
    pulse: d.pulse ?? null,
    tss: d.tss ? Math.round(d.tss) : 0,
    sleepHours: d.sleepHours ?? null,
    workoutTypes: d.workoutTypes?.length ? d.workoutTypes : undefined,
    isStrengthDay: d.isStrengthDay || undefined,
    notes: d.notes ? d.notes.slice(0, 100) : undefined,
  }));
}

export class GeminiService {
  /**
   * Analyzes physiological and training data via the server-side Gemini API route.
   */
  async analyzeData(data: DaySummary[], userPrompt: string): Promise<string> {
    const customKey = typeof window !== 'undefined' ? localStorage.getItem('GEMINI_API_KEY') : null;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (customKey && customKey.trim()) {
      headers['x-gemini-api-key'] = customKey.trim();
    }

    const payload = {
      data: slimData(data),
      prompt: userPrompt,
      apiKey: customKey ? customKey.trim() : undefined,
    };

    const response = await fetch('/api/gemini/analyze', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text();

    if (!response.ok) {
      let errorMsg = `Server error (${response.status}) while analyzing data.`;
      if (contentType.includes('application/json')) {
        try {
          const parsed = JSON.parse(rawText);
          errorMsg = parsed.error || errorMsg;
        } catch {
          // fallback
        }
      } else if (rawText.includes('warmup') || rawText.includes('<!doctype') || rawText.includes('<html')) {
        errorMsg = 'The AI service is briefly warming up. Please wait a moment and try your request again.';
      }
      throw new Error(cleanGeminiErrorMessage(errorMsg));
    }

    // Guard against 200 responses that are actually HTML warmup pages
    if (!contentType.includes('application/json') || rawText.trim().startsWith('<')) {
      if (rawText.includes('warmup') || rawText.includes('<!doctype') || rawText.includes('<html')) {
        throw new Error('The AI service is briefly warming up. Please wait a moment and try your request again.');
      }
      throw new Error('Server returned an unexpected non-JSON response. Please try again.');
    }

    let result: { text?: string };
    try {
      result = JSON.parse(rawText);
    } catch {
      throw new Error('Server returned an unreadable response format. Please try again.');
    }

    return result.text || 'No response generated.';
  }

  /**
   * Streams physiological analysis from the server-side Gemini streaming route.
   */
  async *streamAnalysis(data: DaySummary[], userPrompt: string): AsyncGenerator<string, void, unknown> {
    const customKey = typeof window !== 'undefined' ? localStorage.getItem('GEMINI_API_KEY') : null;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (customKey && customKey.trim()) {
      headers['x-gemini-api-key'] = customKey.trim();
    }

    const payload = {
      data: slimData(data),
      prompt: userPrompt,
      apiKey: customKey ? customKey.trim() : undefined,
    };

    const response = await fetch('/api/gemini/stream', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const contentType = response.headers.get('content-type') || '';

    if (!response.ok || !response.body) {
      const rawText = await response.text().catch(() => '');
      if (rawText.includes('warmup') || rawText.includes('<!doctype') || rawText.includes('<html')) {
        throw new Error('The AI service is briefly warming up. Please wait a moment and try your request again.');
      }
      let errorMsg = `Streaming failed (${response.status}).`;
      if (contentType.includes('application/json')) {
        try {
          const parsed = JSON.parse(rawText);
          errorMsg = parsed.error || errorMsg;
        } catch {}
      }
      throw new Error(cleanGeminiErrorMessage(errorMsg));
    }

    // Check if intercepted by HTML warmup
    if (contentType.includes('text/html')) {
      throw new Error('The AI service is briefly warming up. Please wait a moment and try your request again.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const payloadStr = trimmed.slice(6);
          if (payloadStr === '[DONE]') return;
          try {
            const parsed = JSON.parse(payloadStr);
            if (parsed.error) {
              throw new Error(cleanGeminiErrorMessage(parsed.error));
            }
            if (parsed.text) yield parsed.text;
          } catch (e: any) {
            if (e.message && !e.message.includes('JSON')) throw e;
          }
        }
      }
    }
  }
}

export const geminiService = new GeminiService();


