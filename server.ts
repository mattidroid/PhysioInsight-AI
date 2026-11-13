import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';

function getCliArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && args[i + 1]) {
      return args[i + 1];
    }
    if (args[i].startsWith(`${flag}=`)) {
      return args[i].slice(flag.length + 1);
    }
  }
  return undefined;
}

function resolvePort(): number {
  const cliPort = getCliArg('--port');
  if (cliPort) {
    const parsed = parseInt(cliPort, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }

  const envPort = process.env.PORT;
  const nginxPort = process.env.NGINX_PORT;
  // In development behind nginx, Cloud Run's default PORT (e.g. 8080) may be bound by nginx.
  if (!isProduction && envPort && nginxPort && envPort === nginxPort) {
    return parseInt(process.env.DEFAULT_APP_PORT || '3000', 10);
  }

  return parseInt(envPort || process.env.DEFAULT_APP_PORT || '3000', 10);
}

const PORT = resolvePort();
const HOST = getCliArg('--host') || process.env.HOST || '0.0.0.0';

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
3. Medication & Travel: How do medication protocols and dose changes (e.g., Mounjaro/MJ, Retatrutide/RT, Tesamorelin/TE, or combinations noted in the substance abbreviation legend) interact with perceived training exertion, weight trends, and recovery?
4. Metabolic Health: Correlate weight loss with Intensity Factor (IF) or TSS efficiency.

Objective: Provide data-driven insights. If you see a dip in HRV after a big VO2Max session, point it out. If Strength training correlates with faster weight drops, highlight it.

Formatting: Use Markdown. Be concise but scientifically rigorous.
`;

// Valid models ordered by capability and fallback resilience
const MODELS_TO_TRY = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];

async function generateWithFallback(
  ai: GoogleGenAI,
  contents: any,
  systemInstruction: string
): Promise<string> {
  let lastError: any = null;

  for (const model of MODELS_TO_TRY) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction,
          },
        });
        if (response.text) {
          return response.text;
        }
      } catch (err: any) {
        lastError = err;
        const errorText = `${err?.message || ''} ${err?.status || ''}`;
        const isTransient =
          err?.status === 503 ||
          err?.status === 429 ||
          err?.status === 500 ||
          errorText.includes('high demand') ||
          errorText.includes('UNAVAILABLE') ||
          errorText.includes('RESOURCE_EXHAUSTED');

        if (!isTransient) {
          // Non-transient errors (such as 401 or invalid params) should not be retried
          throw err;
        }

        // Wait with backoff before next attempt or next model
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 800));
      }
    }
  }

  throw lastError;
}

async function streamWithFallback(
  ai: GoogleGenAI,
  contents: any,
  systemInstruction: string
) {
  let lastError: any = null;

  for (const model of MODELS_TO_TRY) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const stream = await ai.models.generateContentStream({
          model,
          contents,
          config: {
            systemInstruction,
          },
        });
        return stream;
      } catch (err: any) {
        lastError = err;
        const errorText = `${err?.message || ''} ${err?.status || ''}`;
        const isTransient =
          err?.status === 503 ||
          err?.status === 429 ||
          err?.status === 500 ||
          errorText.includes('high demand') ||
          errorText.includes('UNAVAILABLE') ||
          errorText.includes('RESOURCE_EXHAUSTED');

        if (!isTransient) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 800));
      }
    }
  }

  throw lastError;
}

function parseErrorMessage(err: any): { userMessage: string; statusCode: number } {
  let rawMsg = '';
  if (typeof err === 'string') {
    rawMsg = err;
  } else if (err?.message) {
    rawMsg = typeof err.message === 'string' ? err.message : JSON.stringify(err.message);
  } else if (err?.error?.message) {
    rawMsg = typeof err.error.message === 'string' ? err.error.message : JSON.stringify(err.error.message);
  } else {
    try {
      rawMsg = JSON.stringify(err);
    } catch {
      rawMsg = String(err);
    }
  }

  // Extract clean inner message if raw stringified Google API JSON error
  if (rawMsg.includes('{"error"') || (rawMsg.startsWith('{') && rawMsg.includes('"message"'))) {
    try {
      const jsonStart = rawMsg.indexOf('{');
      const jsonEnd = rawMsg.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        const parsed = JSON.parse(rawMsg.slice(jsonStart, jsonEnd + 1));
        if (parsed?.error?.message) {
          rawMsg = parsed.error.message;
        } else if (parsed?.message) {
          rawMsg = parsed.message;
        }
      }
    } catch {
      // keep rawMsg as is
    }
  }

  const lower = rawMsg.toLowerCase();
  const isHighDemand =
    err?.status === 503 ||
    err?.status === 429 ||
    lower.includes('high demand') ||
    lower.includes('unavailable') ||
    lower.includes('resource_exhausted') ||
    lower.includes('503') ||
    lower.includes('429');

  const isAuthError =
    err?.status === 401 ||
    lower.includes('api key') ||
    lower.includes('unauthenticated') ||
    lower.includes('access_token_type_unsupported');

  if (isHighDemand) {
    return {
      statusCode: 503,
      userMessage: 'The AI service is experiencing temporary high demand on Google servers. We automatically retried with fallback models, but traffic remains elevated. Please wait a moment and try your request again.',
    };
  }

  if (isAuthError) {
    return {
      statusCode: 401,
      userMessage: 'Gemini API key is invalid or unauthorized. Please verify your API key in Settings or in the Settings > Secrets panel.',
    };
  }

  return {
    statusCode: err?.status || 500,
    userMessage: rawMsg || 'Error generating insights from Gemini.',
  };
}

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
      const { data, prompt, substances, apiKey: bodyApiKey } = req.body;
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
      const contents: Array<{ text: string }> = [
        { text: `Dataset Overview: ${JSON.stringify(dataPayload)}` },
      ];
      if (substances && typeof substances === 'object' && Object.keys(substances).length > 0) {
        contents.push({ text: `Medication / Substance Abbreviation Legend: ${JSON.stringify(substances)}` });
      }
      contents.push({ text: prompt });

      const text = await generateWithFallback(ai, contents, SYSTEM_INSTRUCTION);
      res.json({ text });
    } catch (err: any) {
      console.error('Gemini analyze error:', err);
      const { statusCode, userMessage } = parseErrorMessage(err);
      res.status(statusCode).json({ error: userMessage });
    }
  });

  // Server-side Gemini streaming endpoint
  app.post('/api/gemini/stream', async (req, res) => {
    try {
      const { data, prompt, substances, apiKey: bodyApiKey } = req.body;
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
      const contents: Array<{ text: string }> = [
        { text: `Dataset Overview: ${JSON.stringify(dataPayload)}` },
      ];
      if (substances && typeof substances === 'object' && Object.keys(substances).length > 0) {
        contents.push({ text: `Medication / Substance Abbreviation Legend: ${JSON.stringify(substances)}` });
      }
      contents.push({ text: prompt });

      const stream = await streamWithFallback(ai, contents, SYSTEM_INSTRUCTION);

      for await (const chunk of stream) {
        if (chunk.text) {
          res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err: any) {
      console.error('Gemini stream error:', err);
      const { statusCode, userMessage } = parseErrorMessage(err);

      if (!res.headersSent) {
        res.status(statusCode).json({ error: userMessage });
      } else {
        res.write(`data: ${JSON.stringify({ error: userMessage })}\n\n`);
        res.end();
      }
    }
  });

  // Explicit fallback for API routes: guarantees all /api requests return JSON, never HTML
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });

  // Express error handler: ensures error responses on API calls are always JSON
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      return next(err);
    }
    console.error('Express server error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.use((_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT} (${isProduction ? 'production' : 'development'})`);
  });

  server.on('error', (err) => {
    console.error('Server listen error:', err);
    process.exit(1);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
