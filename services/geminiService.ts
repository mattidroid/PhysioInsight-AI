import { DaySummary } from "../types";

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

    const response = await fetch('/api/gemini/analyze', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data,
        prompt: userPrompt,
        apiKey: customKey ? customKey.trim() : undefined,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Server error (${response.status}) while analyzing data.`);
    }

    const result = await response.json();
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

    const response = await fetch('/api/gemini/stream', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data,
        prompt: userPrompt,
        apiKey: customKey ? customKey.trim() : undefined,
      }),
    });

    if (!response.ok || !response.body) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Streaming failed (${response.status}).`);
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
            if (parsed.error) throw new Error(parsed.error);
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
