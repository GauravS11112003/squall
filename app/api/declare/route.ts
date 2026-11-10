import { NextResponse } from 'next/server';
import { KB } from '@/data/kb';
import { declareByManager } from '@/lib/engine';
import { body, gate } from '@/lib/guard';
import type { Incident, PriorTicket } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** The incident manager pressed Declare: find, check and draft the response. */
export async function POST(req: Request) {
  const g = await gate(req);
  if ('error' in g) return g.error;
  const input = await body<{ incident: Incident; members: PriorTicket[]; at: number }>(req);
  if (!input?.incident?.id || !Array.isArray(input.members) || !input.members.length) {
    return NextResponse.json({ error: 'An incident and its member tickets are required.' }, { status: 400 });
  }
  const out = await declareByManager(g.api, { incident: input.incident, members: input.members, kb: KB, at: input.at ?? 0 });
  return NextResponse.json(out);
}
