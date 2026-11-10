import { NextResponse } from 'next/server';
import { KB_BY_ID } from '@/data/kb';
import { verifyDraft } from '@/lib/engine';
import { body, gate } from '@/lib/guard';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Re-checks an edited broadcast, claim by claim, against the incident's reports and its workaround passage. */
export async function POST(req: Request) {
  const g = await gate(req);
  if ('error' in g) return g.error;
  const input = await body<{ draft: string; members: { id: string; masked: string }[]; passageIds: string[]; incidentId: string; at: number }>(req);
  if (!input?.draft?.trim() || !Array.isArray(input.members)) {
    return NextResponse.json({ error: 'A draft and the incident\'s tickets are required.' }, { status: 400 });
  }
  const passages = (input.passageIds ?? []).map((id) => KB_BY_ID[id]).filter(Boolean);
  const out = await verifyDraft(g.api, { draft: input.draft, members: input.members, passages, incidentId: input.incidentId, at: input.at ?? 0 });
  if (!out.verification) {
    return NextResponse.json({ error: out.calls[0]?.error ?? 'Verify did not answer. The draft is unchecked.', calls: out.calls }, { status: 502 });
  }
  return NextResponse.json(out);
}
