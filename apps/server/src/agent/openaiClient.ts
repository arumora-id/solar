import OpenAI from 'openai';
import type { AppConfig } from '../config.js';
import type { ResponsesStreamer } from './agent.js';

/**
 * The production model client: OpenAI Responses API via the official SDK.
 * Created lazily so SOLAR still starts (and shows a hint in the UI) when OPENAI_API_KEY is missing.
 */
export function createOpenAIStreamer(config: AppConfig): ResponsesStreamer {
  let client: OpenAI | null = null;
  return {
    stream(params, options) {
      if (!config.openai.apiKey) {
        throw new Error('OPENAI_API_KEY belum diisi: isi API key OpenAI di .env (lihat README) lalu restart SOLAR AI AGENT.');
      }
      client ??= new OpenAI({
        apiKey: config.openai.apiKey,
        baseURL: config.openai.baseUrl,
        organization: config.openai.organization ?? null,
        project: config.openai.project ?? null,
        maxRetries: 4,
        timeout: 15 * 60_000,
      });
      return client.responses.stream(params, options);
    },
  };
}
