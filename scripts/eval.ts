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
import { declareByManager } from '../lib/engine';
import { loadEnv } from '../lib/env';
import { baseline, costOf, score } from '../lib/metrics';
import { priorOf, runStorm } from '../lib/run';
import type { Recording } from '../lib/types';

loadEnv();
if (!hasKey()) {
  console.error('No CLOCKED_API_KEY found. The evaluation only runs against the live Clocked API.');
  process.exit(1);
}
const api = await liveApi();
const started = Date.now();
const run = await runStorm(STORM, api, KB, (out) => {
  const t = out.ticket;
  const credits = out.calls.reduce((a, c) => a + (c.credits ?? 0), 0);
  console.log(`${t.id}  ${t.status.padEnd(10)} ${String(credits).padStart(4)} cr  ${t.outcome}`);
});

// Incidents the policy left for a person: record what happens when the manager declares them,
// so the recorded demo can show that path too.
const actions: Recording['actions'] = [];
for (const inc of run.incidents.filter((i) => i.status === 'review')) {
  const members = priorOf(run).filter((p) => p.incidentId === inc.id);
  const r = await declareByManager(api, { incident: inc, members, kb: KB, at: STORM[STORM.length - 1].at });
  actions.push({ incidentId: inc.id, incident: r.incident, calls: r.calls });
  console.log(`${inc.id}  manager declare recorded (${r.calls.reduce((a, c) => a + (c.credits ?? 0), 0)} cr)`);
}

const allCalls = [...run.calls, ...actions.flatMap((a) => a.calls)];
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
};
writeFileSync('public/recordings/latest.json', JSON.stringify(recording));
console.log('\n' + JSON.stringify({ squall: results.squall, baseline: results.baseline, cost: { credits: results.cost.credits, medianModelMs: results.cost.medianModelMs } }, null, 2));
console.log('\nSaved eval/results.json and public/recordings/latest.json');
