export const MAX_GET_ATTEMPTS = 6;
export const RETRY_BASE_DELAY_MS = 250;
export const DEFAULT_RETRY_AFTER_MS = 1_000;
export const MAX_RETRY_AFTER_MS = 5_000;

/** Days past the reference date a detector's "right now" window extends — S08. */
export const HORIZON_DAYS = 30;

/** Only non-ambiguous watch findings are capped; criticals and review questions stay visible. */
export const MAX_WATCH_PER_MESSAGE = 3;

/** An opportunity below this probability is not worth staffing against yet — S12. */
export const MIN_PROBABILITY = 70;

export type RunTrigger = 'manual' | 'cron';

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
