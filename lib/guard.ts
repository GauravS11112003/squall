import { NextResponse } from 'next/server';
import { pickApi } from './api';
import type { Api } from './api';

/**
 * Live endpoints spend Clocked credits. On a public deployment set
 * SQUALL_ACCESS_CODE and only requests carrying it may make live calls;
 * everyone else watches the recorded run.
 */
export async function gate(req: Request): Promise<{ api: Api } | { error: NextResponse }> {
  const code = process.env.SQUALL_ACCESS_CODE?.trim();
  if (code && req.headers.get('x-squall-code') !== code) {
    return { error: NextResponse.json({ error: 'Live mode on this deployment needs an access code.' }, { status: 401 }) };
  }
  const api = await pickApi();
  if (!api) {
    return {
      error: NextResponse.json(
        { error: 'No Clocked API key is configured. Add CLOCKED_API_KEY to .env.local and restart the server.' },
        { status: 503 },
      ),
    };
  }
  return { api };
}

export async function body<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
