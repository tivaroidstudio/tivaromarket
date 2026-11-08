/** Thin, dependency-free clients for the supported model APIs. */
import { fetchJson } from '@tivaro/data';

export interface LlmRequest {
  model: string;
  system: string;
  user: string;
  maxOutputTokens?: number;
  temperature?: number;
  /** Let the model search the web itself for fresh news (provider-native tool). */
  webSearch?: boolean;
}

export interface LlmResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

export type Env = Record<string, string | undefined>;

export interface LlmProvider {
  id: string;
  label: string;
  requires: string[];
  defaultModel: string;
  supportsWebSearch: boolean;
  complete(req: LlmRequest, env: Env): Promise<LlmResponse>;
}

const TIMEOUT = 180_000;

export const anthropic: LlmProvider = {
  id: 'anthropic',
  label: 'Claude (Anthropic API)',
  requires: ['ANTHROPIC_API_KEY'],
  defaultModel: 'claude-sonnet-5-5',
  supportsWebSearch: true,
  async complete(req, env) {
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxOutputTokens ?? 4000,
      temperature: req.temperature ?? 0.2,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    };
    if (req.webSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
    const r = await fetchJson<{ content: { type: string; text?: string }[]; usage?: { input_tokens: number; output_tokens: number } }>(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        timeoutMs: TIMEOUT,
        retries: 1,
        headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
      },
    );
    return {
      text: r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'),
      inputTokens: r.usage?.input_tokens,
      outputTokens: r.usage?.output_tokens,
    };
  },
};

export const openai: LlmProvider = {
  id: 'openai',
  label: 'OpenAI / Codex models (Responses API)',
  requires: ['OPENAI_API_KEY'],
  defaultModel: 'gpt-5',
  supportsWebSearch: true,
  async complete(req, env) {
    const body: Record<string, unknown> = {
      model: req.model,
      instructions: req.system,
      input: req.user,
      max_output_tokens: req.maxOutputTokens ?? 4000,
    };
    if (req.webSearch) body.tools = [{ type: 'web_search' }];
    const r = await fetchJson<{ output?: { type: string; content?: { type: string; text?: string }[] }[]; output_text?: string; usage?: { input_tokens: number; output_tokens: number } }>(
      'https://api.openai.com/v1/responses',
      { method: 'POST', timeoutMs: TIMEOUT, retries: 1, headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: JSON.stringify(body) },
    );
    const text =
      r.output_text ??
      (r.output ?? [])
        .filter((o) => o.type === 'message')
        .flatMap((o) => o.content ?? [])
        .filter((c) => c.type === 'output_text')
        .map((c) => c.text)
        .join('\n');
    return { text, inputTokens: r.usage?.input_tokens, outputTokens: r.usage?.output_tokens };
  },
};

export const gemini: LlmProvider = {
  id: 'gemini',
  label: 'Gemini (Google AI Studio)',
  requires: ['GEMINI_API_KEY'],
  defaultModel: 'gemini-2.5-pro',
  supportsWebSearch: true,
  async complete(req, env) {
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig: { maxOutputTokens: req.maxOutputTokens ?? 4000, temperature: req.temperature ?? 0.2 },
    };
    if (req.webSearch) body.tools = [{ google_search: {} }];
    const r = await fetchJson<{ candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number } }>(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`,
      { method: 'POST', timeoutMs: TIMEOUT, retries: 1, headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY! }, body: JSON.stringify(body) },
    );
    return {
      text: (r.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('\n'),
      inputTokens: r.usageMetadata?.promptTokenCount,
      outputTokens: r.usageMetadata?.candidatesTokenCount,
    };
  },
};

export const openrouter: LlmProvider = {
  id: 'openrouter',
  label: 'OpenRouter (any model: DeepSeek, Grok, Qwen, Llama…)',
  requires: ['OPENROUTER_API_KEY'],
  defaultModel: 'deepseek/deepseek-chat',
  supportsWebSearch: true,
  async complete(req, env) {
    // OpenRouter enables web search with the ":online" model suffix.
    const model = req.webSearch && !req.model.endsWith(':online') ? `${req.model}:online` : req.model;
    const r = await fetchJson<{ choices: { message: { content: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number } }>(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        timeoutMs: TIMEOUT,
        retries: 1,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'x-title': 'TivaroMarket' },
        body: JSON.stringify({
          model,
          max_tokens: req.maxOutputTokens ?? 4000,
          temperature: req.temperature ?? 0.2,
          messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
        }),
      },
    );
    return { text: r.choices[0]?.message.content ?? '', inputTokens: r.usage?.prompt_tokens, outputTokens: r.usage?.completion_tokens };
  },
};

export const LLM_PROVIDERS: Record<string, LlmProvider> = { anthropic, openai, gemini, openrouter };
