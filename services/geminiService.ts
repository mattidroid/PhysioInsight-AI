
import { GoogleGenAI } from "@google/genai";
import { DaySummary } from "../types";

export class GeminiService {
  /**
   * Analyzes physiological and training data using Gemini 3 Pro.
   * Creates a new GoogleGenAI instance on each call to ensure latest API key usage.
   */
  async analyzeData(data: DaySummary[], userPrompt: string) {
    // Always use the named parameter for API key and create a fresh instance
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    const systemInstruction = `
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

    // Use gemini-3-pro-preview for complex reasoning tasks
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: {
        parts: [
          { text: `Dataset Overview: ${JSON.stringify(data)}` },
          { text: userPrompt }
        ]
      },
      config: {
        systemInstruction,
        // Pro models support a thinking budget for deeper analysis
        thinkingConfig: { thinkingBudget: 32768 }
      },
    });

    // Directly access the .text property from the response (not a method call)
    return response.text;
  }
}

export const geminiService = new GeminiService();
