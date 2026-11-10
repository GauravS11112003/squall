import type { Endpoint } from './types';

export type ApiResult<T> = {
  data: T;
  modelMs: number | null;
  credits: number | null;
  costUsd: number | null;
};

/**
 * The one seam between Squall and Clocked. The live adapter wraps the official
 * SDK; the simulator (lib/sim.ts) implements the same call for offline
 * development and tests, and is always labelled as a simulator in the UI.
 */
export interface Api {
  mode: 'live' | 'sim';
  request<T>(endpoint: Endpoint, body: object): Promise<ApiResult<T>>;
}

export function hasKey(): boolean {
  return Boolean(process.env.CLOCKED_API_KEY && process.env.CLOCKED_API_KEY.trim());
}

let live: Api | null = null;

/** Server only. The key is read from the environment and never leaves this process. */
export async function liveApi(): Promise<Api> {
  if (live) return live;
  const { Clocked } = await import('clocked-sdk');
  const client = new Clocked({
    apiKey: process.env.CLOCKED_API_KEY,
    baseUrl: process.env.CLOCKED_BASE_URL || undefined,
    timeout: 45_000,
    maxAttempts: 3,
  });
  live = {
    mode: 'live',
    async request<T>(endpoint: Endpoint, body: object) {
      const r = await client.request<T>(endpoint, body);
      return { data: r.data, modelMs: r.modelMs, credits: r.credits, costUsd: r.costUsd };
    },
  };
  return live;
}

/** Picks the live API when a key is configured, the simulator when SQUALL_SIM=1, otherwise null. */
export async function pickApi(): Promise<Api | null> {
  if (hasKey()) return liveApi();
  if (process.env.SQUALL_SIM === '1') {
    const { simApi } = await import('./sim');
    return simApi();
  }
  return null;
}
