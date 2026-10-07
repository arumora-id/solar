/** OpenAI list prices (standard tier) in USD per 1M tokens. Used for cost *estimates* in the monitor only. */
export interface Price {
  input: number;
  cachedInput: number;
  output: number;
  /** Cache writes, where the model bills them (defaults to the input price). */
  cacheWrite?: number;
}

// Most specific patterns first. Override with SOLAR_PRICE_PER_MTOK when prices change.
const PRICES: Array<[RegExp, Price]> = [
  [/^gpt-6-astra/, { input: 10, cachedInput: 1, output: 50, cacheWrite: 12.5 }],
  [/^gpt-6\.1-sol/, { input: 2, cachedInput: 0.1, output: 10 }],
  [/^gpt-6-sol/, { input: 2, cachedInput: 0.2, output: 10 }],
  [/^gpt-6-luna/, { input: 0.1, cachedInput: 0.01, output: 0.5 }],
  [/^gpt-5\.6-sol/, { input: 4, cachedInput: 0.4, output: 20 }],
  [/^gpt-5\.5(?!-pro)/, { input: 5, cachedInput: 0.5, output: 30 }],
  [/^gpt-5\.2(?!-pro)/, { input: 1.75, cachedInput: 0.175, output: 14 }],
  [/^gpt-5(\.1)?-mini/, { input: 0.25, cachedInput: 0.025, output: 2 }],
  [/^gpt-5-nano/, { input: 0.05, cachedInput: 0.005, output: 0.4 }],
  [/^gpt-5(\.1)?(-\d{4}-\d{2}-\d{2})?$/, { input: 1.25, cachedInput: 0.125, output: 10 }],
  [/^gpt-4\.1-mini/, { input: 0.4, cachedInput: 0.1, output: 1.6 }],
  [/^gpt-4\.1-nano/, { input: 0.1, cachedInput: 0.025, output: 0.4 }],
  [/^gpt-4\.1/, { input: 2, cachedInput: 0.5, output: 8 }],
  [/^gpt-4o-mini/, { input: 0.15, cachedInput: 0.075, output: 0.6 }],
  [/^gpt-4o/, { input: 2.5, cachedInput: 1.25, output: 10 }],
  [/^o4-mini/, { input: 1.1, cachedInput: 0.275, output: 4.4 }],
  [/^o3(?!-)/, { input: 2, cachedInput: 0.5, output: 8 }],
];

/** Fallback for models missing from the table (same as the default model). */
const DEFAULT_PRICE: Price = { input: 2, cachedInput: 0.1, output: 10 };

/** GPT-6 family: prompts above 272K input tokens bill 2x input/cache and 1.5x output for the whole request. */
const LONG_CONTEXT_THRESHOLD = 272_000;

export function priceOf(model: string, override?: Price): Price {
  return override ?? PRICES.find(([re]) => re.test(model))?.[1] ?? DEFAULT_PRICE;
}

export interface TokenUsage {
  /** Uncached input tokens. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function estimateCostUsd(model: string, usage: TokenUsage, override?: Price): number {
  const price = priceOf(model, override);
  const totalInput = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const long = !override && /^gpt-6/.test(model) && totalInput > LONG_CONTEXT_THRESHOLD;
  const inMul = long ? 2 : 1;
  const outMul = long ? 1.5 : 1;
  return (
    (usage.inputTokens * price.input * inMul +
      usage.cacheReadTokens * price.cachedInput * inMul +
      usage.cacheWriteTokens * (price.cacheWrite ?? price.input) * inMul +
      usage.outputTokens * price.output * outMul) /
    1_000_000
  );
}

export interface ModelCapabilities {
  /** Reasoning model: accepts `reasoning: {effort, summary}` and returns encrypted reasoning items. */
  reasoning: boolean;
  /** Largest `max_output_tokens` the model accepts (reasoning tokens included). */
  maxOutputTokens: number;
}

export function capabilitiesOf(model: string): ModelCapabilities {
  const m = model.toLowerCase();
  // chat-latest aliases and the GPT-4 generation are not reasoning models
  const reasoning = !/chat-latest/.test(m) && /^(gpt-[5-9]|gpt-\d{2,}|o\d)/.test(m);
  let maxOutputTokens = 128_000;
  if (/^o\d/.test(m)) maxOutputTokens = 100_000;
  else if (/^gpt-4\.1/.test(m)) maxOutputTokens = 32_768;
  else if (/^gpt-4o|^gpt-4|^gpt-3|chat-latest/.test(m)) maxOutputTokens = 16_384;
  return { reasoning, maxOutputTokens };
}
