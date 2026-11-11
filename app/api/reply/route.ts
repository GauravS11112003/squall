import { NextResponse } from 'next/server';
import { KB_BY_ID } from '@/data/kb';
import { personalReply } from '@/lib/engine';
import { body, gate } from '@/lib/guard';
import type { PolicyOverrides } from '@/lib/policy';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Drafts and checks a reply to one reporter. */
export async function POST(req: Request) {
  const g = await gate(req);
  if ('error' in g) return g.error;
  const input = await body<{ ticket: { id: string; masked: string }; passageIds: string[]; incidentId: string; at: number; policy?: PolicyOverrides }>(req);
  if (!input?.ticket?.id || typeof input.ticket.masked !== 'string' || !input.ticket.masked.trim()) {
    return NextResponse.json({ error: 'A screened ticket is required.' }, { status: 400 });
  }
  const passages = (input.passageIds ?? []).map((id) => KB_BY_ID[id]).filter(Boolean);
  const out = await personalReply(g.api, { ticket: input.ticket, passages, incidentId: input.incidentId, at: input.at ?? 0, policy: input.policy });
  return NextResponse.json(out);
}
