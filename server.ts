import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';
const PORT = parseInt(process.env.PORT || '3000', 10);

function getGeminiClient(customApiKey?: string): GoogleGenAI | null {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey || !apiKey.trim()) {
    return null;
  }
  return new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const SYSTEM_INSTRUCTION = `
You are an expert physiological data analyst and elite sports coach. 
You are analyzing a user's combined Health Metrics and Workout Data (TSS - Training Stress Score).

Key contexts to correlate:
1. Training Load (TSS): How do high TSS days or high-intensity bike sessions affect next-day HRV?
2. Weight Training: Analyze the impact of Strength sessions on weight loss plateaus and recovery.
3. Medication & Travel: How do Mounjaro dose changes (5mg-15mg) interact with perceived training exertion and recovery?
4. Metabolic Health: Correlate weight loss with Intensity Factor (IF) or TSS efficiency.

Objective: Provide data-driven insights. If you see a dip in HRV after a big VO2Max session, point it out. If Strength training correlates with faster weight drops, highlight it.

Formatting: Use Markdown. Be concise but scientifically rigorous.
`;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Server-side Gemini analysis endpoint
  app.post('/api/gemini/analyze', async (req, res) => {
    try {
      const { data, prompt, apiKey: bodyApiKey } = req.body;
      const headerApiKey = req.headers['x-gemini-api-key'] as string | undefined;
      const clientApiKey = headerApiKey || bodyApiKey;

      const ai = getGeminiClient(clientApiKey);
      if (!ai) {
        return res.status(401).json({
          error: 'Gemini API Key is missing. Please provide your API key in Settings or attach GEMINI_API_KEY in the Settings > Secrets panel.',
        });
      }

      if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
      }

      const dataPayload = Array.isArray(data) ? data.slice(-180) : [];

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: [
          { text: `Dataset Overview: ${JSON.stringify(dataPayload)}` },
          { text: prompt },
        ],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
        },
      });

      res.json({ text: response.text || '' });
    } catch (err: any) {
      console.error('Gemini analyze error:', err);
      const isAuthError = err?.status === 401 || err?.message?.includes('API key') || err?.message?.includes('UNAUTHENTICATED') || err?.message?.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED');
      const userMessage = isAuthError
        ? 'Gemini API key is invalid or unauthorized. Please verify your API key in Settings or in the Settings > Secrets panel.'
        : (err?.message || 'Error generating insights from Gemini.');
      res.status(isAuthError ? 401 : 500).json({ error: userMessage });
    }
  });

  // Server-side Gemini streaming endpoint
  app.post('/api/gemini/stream', async (req, res) => {
    try {
      const { data, prompt, apiKey: bodyApiKey } = req.body;
      const headerApiKey = req.headers['x-gemini-api-key'] as string | undefined;
      const clientApiKey = headerApiKey || bodyApiKey;

      const ai = getGeminiClient(clientApiKey);
      if (!ai) {
        return res.status(401).json({
          error: 'Gemini API Key is missing. Please provide your API key in Settings or attach GEMINI_API_KEY in the Settings > Secrets panel.',
        });
      }

      if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const dataPayload = Array.isArray(data) ? data.slice(-180) : [];

      const stream = await ai.models.generateContentStream({
        model: 'gemini-3.8-flash',
        contents: [
          { text: `Dataset Overview: ${JSON.stringify(dataPayload)}` },
          { text: prompt },
        ],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
        },
      });

      for await (const chunk of stream) {
        if (chunk.text) {
          res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err: any) {
      console.error('Gemini stream error:', err);
      const isAuthError = err?.status === 401 || err?.message?.includes('API key') || err?.message?.includes('UNAUTHENTICATED') || err?.message?.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED');
      const userMessage = isAuthError
        ? 'Gemini API key is invalid or unauthorized. Please verify your API key in Settings or in the Settings > Secrets panel.'
        : (err?.message || 'Streaming failed.');

      if (!res.headersSent) {
        res.status(isAuthError ? 401 : 500).json({ error: userMessage });
      } else {
        res.write(`data: ${JSON.stringify({ error: userMessage })}\n\n`);
        res.end();
      }
    }
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT} (${isProduction ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
