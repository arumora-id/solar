/** Public list prices in USD per million tokens (5-minute cache writes = 1.25x input). */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const PRICES: Array<[RegExp, Price]> = [
  [/^claude-fable-5/, { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 }],
  [/^claude-opus-5-5/, { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }],
  [/^claude-opus-(5|4-[5-8])/, { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  [/^claude-sonnet-5-5/, { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }],
  [/^claude-sonnet-5/, { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }],
  [/^claude-sonnet-4/, { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  [/^claude-haiku-4-5/, { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }],
];

const DEFAULT_PRICE: Price = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

export function estimateCostUsd(
  model: string,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number },
): number {
  const price = PRICES.find(([re]) => re.test(model))?.[1] ?? DEFAULT_PRICE;
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheWriteTokens * price.cacheWrite) /
    1_000_000
  );
}

export interface ModelCapabilities {
  /** `thinking: {type: "adaptive"}` + `output_config.effort` (Claude 4.6+ generation). */
  adaptiveThinking: boolean;
  /** Server-side refusal fallback with `fallbacks: "default"`. */
  serverFallback: boolean;
}

export function capabilitiesOf(model: string): ModelCapabilities {
  const legacy = /^claude-(haiku-4-5|sonnet-4-5|opus-4-5|opus-4-1|opus-4-0|sonnet-4-0|3)/.test(model);
  return {
    adaptiveThinking: !legacy,
    serverFallback: /^claude-(opus-5|fable-5-1|sonnet-5-5)/.test(model),
  };
}
