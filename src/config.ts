export const MAX_GET_ATTEMPTS = 6;
export const RETRY_BASE_DELAY_MS = 250;
export const DEFAULT_RETRY_AFTER_MS = 1_000;
export const MAX_RETRY_AFTER_MS = 5_000;

/** Days past the reference date a detector's "right now" window extends — S08. */
export const HORIZON_DAYS = 30;

/**
 * Capped per section, not per message. One cap over a flat list drops by array position, which
 * silently made every question and every model-linked finding unreachable behind seven risks.
 *
 * A critical finding is never dropped — it is by definition the thing worth interrupting someone
 * for, and hiding one behind "2 more not shown" cost a 284% overrun its place in the message.
 * These caps bound the watch and question sections only.
 * ponytail: unbounded criticals are fine at 8 clients; at 500 projects this needs real ranking
 * (imminence x magnitude), not a bigger number.
 */
export const MAX_WATCH_PER_MESSAGE = 3;
export const MAX_QUESTIONS_PER_MESSAGE = 3;

/**
 * Deliberately smaller than the message cap. A model given five slots fills five slots: at that
 * width it started reporting bare vacations as risks and crowded out deterministic findings.
 * Three forces it to choose.
 */
/** An opportunity below this probability is not worth staffing against yet — S12. */
export const MIN_PROBABILITY = 70;

export type RuntimeConfig = {
  mockApiBaseUrl: string;
  openAiApiKey: string | null;
  openAiModel: string;
  slackWebhookUrl: string | null;
};

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** Loaded only by /run: liveness must work before deployment secrets are configured. */
export function runtimeConfig(): RuntimeConfig {
  return {
    mockApiBaseUrl: required('MOCK_API_BASE_URL'),
    openAiApiKey: Deno.env.get('OPENAI_API_KEY')?.trim() || null,
    openAiModel: Deno.env.get('OPENAI_MODEL')?.trim() || 'gpt-5.6-luna',
    slackWebhookUrl: Deno.env.get('SLACK_WEBHOOK_URL')?.trim() || null,
  };
}
