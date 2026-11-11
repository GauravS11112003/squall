/**
 * Re-drafts the personal replies of the recorded run, live, without re-running the storm.
 * Reads public/recordings/latest.json, replaces its `replies`, and updates the cost totals
 * in eval/results.json. Nothing about grouping, declaring or the broadcast is touched.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { KB_BY_ID } from '../data/kb';
import { hasKey, liveApi } from '../lib/api';
import { personalReply } from '../lib/engine';
import { loadEnv } from '../lib/env';
import { replyPassageIds } from '../lib/format';
import { costOf } from '../lib/metrics';
import type { Recording } from '../lib/types';

loadEnv();

async function main() {
  if (!hasKey()) {
    console.error('No CLOCKED_API_KEY found. Replies are only recorded against the live Clocked API.');
    process.exit(1);
  }
  const api = await liveApi();
  const recording = JSON.parse(readFileSync('public/recordings/latest.json', 'utf8')) as Recording;
  if (recording.meta.mode !== 'live') throw new Error('The recording is not a live run.');
  const last = recording.steps[recording.steps.length - 1];
  const tickets = new Map(recording.steps.map((s) => [s.ticket.id, { ...s.ticket }]));
  // Fold in what later steps and the manager's declare changed for earlier tickets.
  for (const s of recording.steps) for (const m of s.moved) Object.assign(tickets.get(m.id) ?? {}, { incidentId: m.incidentId, sent: m.sent });
  const replies: NonNullable<Recording['replies']> = {};
  for (const inc of last.incidents.filter((i) => i.status === 'declared' && i.response?.reply)) {
    const due = inc.memberIds.map((id) => tickets.get(id)!).filter((t) => t?.masked && t.facts.impact?.value).slice(0, 4);
    for (const t of due) {
      const ids = replyPassageIds(t, inc.response!.reply!.passageIds);
      const r = await personalReply(api, { ticket: { id: t.id, masked: t.masked! }, passages: ids.map((id) => KB_BY_ID[id]).filter(Boolean), incidentId: inc.id, at: t.at });
      replies[t.id] = r;
      console.log(`${t.id}  ${r.reply.verification?.sendable ? 'checked   ' : 'held back '} ${r.reply.text}`);
      for (const c of r.reply.verification?.claims ?? []) console.log(`        ${c.verdict.padEnd(12)} ${Math.round(c.supported * 100)}%  ${c.claim}`);
    }
  }
  recording.replies = replies;
  writeFileSync('public/recordings/latest.json', JSON.stringify(recording));
  const results = JSON.parse(readFileSync('eval/results.json', 'utf8'));
  const stormCalls = recording.steps.flatMap((s) => s.calls).concat(recording.actions.flatMap((a) => a.calls));
  results.cost = costOf([...stormCalls, ...Object.values(replies).flatMap((r) => r.calls)]);
  writeFileSync('eval/results.json', JSON.stringify(results, null, 2));
  console.log(`\nSaved ${Object.keys(replies).length} replies. Total for the recorded run: ${results.cost.credits} credits.`);
}
main();
