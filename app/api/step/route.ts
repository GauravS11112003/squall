import { NextResponse } from 'next/server';
import { KB } from '@/data/kb';
import { step } from '@/lib/engine';
import { body, gate } from '@/lib/guard';
import type { StepInput } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** One ticket through the engine. The browser owns the storm state and sends what the engine needs. */
export async function POST(req: Request) {
  const g = await gate(req);
  if ('error' in g) return g.error;
  const input = await body<StepInput>(req);
  if (!input?.ticket?.id || typeof input.ticket.text !== 'string' || !input.ticket.text.trim()) {
    return NextResponse.json({ error: 'A ticket with an id and some text is required.' }, { status: 400 });
  }
  if (input.ticket.text.length > 6000) {
    return NextResponse.json({ error: 'Tickets are limited to 6,000 characters here.' }, { status: 413 });
  }
  const out = await step({ ticket: input.ticket, incidents: input.incidents ?? [], prior: input.prior ?? [], policy: input.policy }, g.api, KB);
  return NextResponse.json({ ...out, mode: g.api.mode });
}
