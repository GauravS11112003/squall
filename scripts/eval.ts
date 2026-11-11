/**
 * Runs the whole synthetic storm through the live engine, scores it against ground
 * truth, compares it with a keyword-count baseline, and saves:
 *   eval/results.json               the numbers quoted in the README
 *   public/recordings/latest.json   the recorded run the public demo replays
 * Costs a few thousand credits. Refuses to run on the simulator.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { KB } from '../data/kb';
import { STORM } from '../data/storm';
import { hasKey, liveApi } from '../lib/api';
import { declareByManager, personalReply, step } from '../lib/engine';
import { KB_BY_ID } from '../data/kb';
import { loadEnv } from '../lib/env';
import { replyPassageIds } from '../lib/format';
import { baseline, costOf, score } from '../lib/metrics';
import { applyStep, priorOf, type StormState } from '../lib/run';
import type { Recording, StepOutput } from '../lib/types';

loadEnv();
if (!hasKey()) {
  console.error('No CLOCKED_API_KEY found. The evaluation only runs against the live Clocked API.');
  process.exit(1);
}
const api = await liveApi();
const started = Date.now();
// The storm, one ticket at a time. When Squall asks the incident manager, the recorded manager says yes
// straight away, so the rest of the run shows what a declared incident does: the checked workaround
// goes out and follow-ups get the next step.
let state: StormState = { tickets: [], incidents: [], calls: [] };
const steps: StepOutput[] = [];
const actions: Recording['actions'] = [];
for (const [index, ticket] of STORM.entries()) {
  const out = await step({ ticket, incidents: state.incidents, prior: priorOf(state) }, api, KB);
  state = applyStep(state, out);
  steps.push(out);
  const t = out.ticket;
  const credits = out.calls.reduce((a, c) => a + (c.credits ?? 0), 0);
  console.log(`${t.id}  ${t.status.padEnd(10)} ${String(credits).padStart(4)} cr  ${t.outcome}`);
  for (const inc of state.incidents.filter((i) => i.status === 'review')) {
    const members = priorOf(state).filter((p) => p.incidentId === inc.id);
    const r = await declareByManager(api, { incident: inc, members, kb: KB, at: ticket.at });
    actions.push({ incidentId: inc.id, incident: r.incident, calls: r.calls, afterStep: index });
    const reply = r.incident.response?.reply?.passageIds;
    state = {
      tickets: reply ? state.tickets.map((x) => (x.incidentId === inc.id && !x.sent.length ? { ...x, sent: reply } : x)) : state.tickets,
      incidents: state.incidents.map((i) => (i.id === inc.id ? r.incident : i)),
      calls: [...state.calls, ...r.calls],
    };
    console.log(`${inc.id}  the manager was asked and declared it (${r.calls.reduce((a, c) => a + (c.credits ?? 0), 0)} cr)`);
  }
}
const run = { ...state, steps };

// Personal replies for the reporters who mentioned a deadline, so the recorded demo can show them.
const replies: NonNullable<Recording['replies']> = {};
const finalIncidents = run.incidents;
for (const inc of finalIncidents.filter((i) => i.status === 'declared' && i.response?.reply)) {
  const due = run.tickets.filter((t) => t.incidentId === inc.id && t.masked && t.facts.impact?.value).slice(0, 4);
  for (const t of due) {
    const ids = replyPassageIds(t, inc.response!.reply!.passageIds);
    const r = await personalReply(api, { ticket: { id: t.id, masked: t.masked! }, passages: ids.map((id) => KB_BY_ID[id]).filter(Boolean), incidentId: inc.id, at: t.at });
    replies[t.id] = r;
    console.log(`${t.id}  personal reply ${r.reply.verification?.sendable ? 'checked' : 'held back'}: ${r.reply.text.slice(0, 90)}`);
  }
}

const allCalls = [...run.calls, ...Object.values(replies).flatMap((r) => r.calls)];
const results = {
  ranAt: new Date().toISOString(),
  wallSeconds: Math.round((Date.now() - started) / 1000),
  storm: { tickets: STORM.length, spanSeconds: STORM[STORM.length - 1].at },
  squall: score(run.tickets, run.incidents),
  baseline: baseline(STORM),
  cost: costOf(allCalls),
  stormCost: costOf(run.calls),
};
mkdirSync('eval', { recursive: true });
mkdirSync('public/recordings', { recursive: true });
writeFileSync('eval/results.json', JSON.stringify(results, null, 2));
const recording: Recording = {
  meta: { mode: 'live', recordedAt: results.ranAt, sdk: 'clocked-sdk 0.7.0', note: 'Every probability, span, timing and credit count in this file is an unedited Clocked API response.' },
  steps: run.steps,
  actions,
  replies,
};
writeFileSync('public/recordings/latest.json', JSON.stringify(recording));
console.log('\n' + JSON.stringify({ squall: results.squall, baseline: results.baseline, cost: { credits: results.cost.credits, medianModelMs: results.cost.medianModelMs } }, null, 2));
console.log('\nSaved eval/results.json and public/recordings/latest.json');
