/**
 * A small live probe: a handful of real Clocked calls on real storm tickets, with the
 * raw answers saved to probe/out.json. Run it once after adding your key to check the
 * integration before spending credits on a full storm. Costs roughly 100 credits.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { KB } from '../data/kb';
import { STORM } from '../data/storm';
import { hasKey, liveApi } from '../lib/api';
import { loadEnv } from '../lib/env';
import { COMPARE_INSTRUCTIONS, DECIDE_INSTRUCTIONS, DECIDE_QUESTIONS, GUARD_CONTEXT, MATCH_INSTRUCTIONS, PII_ENTITIES, EXTRACT_FIELDS } from '../lib/policy';
import { runStorm } from '../lib/run';

loadEnv();
if (!hasKey()) {
  console.error('No CLOCKED_API_KEY found. Copy .env.local.example to .env.local and add your key.');
  process.exit(1);
}
const api = await liveApi();
const t = (id: string) => STORM.find((x) => x.id === id)!;
const out: Record<string, unknown> = {};
async function probe(name: string, endpoint: Parameters<typeof api.request>[0], body: object) {
  const started = Date.now();
  try {
    const r = await api.request<unknown>(endpoint, body);
    out[name] = { ms: Date.now() - started, modelMs: r.modelMs, credits: r.credits, costUsd: r.costUsd, data: r.data };
    console.log(`ok   ${name}  ${Date.now() - started} ms  ${r.credits} credits`);
  } catch (e: any) {
    out[name] = { ms: Date.now() - started, error: { status: e?.status ?? null, message: e?.error ?? e?.message ?? String(e), body: e?.body ?? null } };
    console.log(`FAIL ${name}  ${e?.status ?? ''} ${e?.error ?? e?.message ?? e}`);
  }
}

await probe('screen_benign', 'pipeline', {
  text: t('T-1001').text,
  steps: [
    { pii: { entities: PII_ENTITIES, anonymize: 'replace' }, name: 'protect' },
    { injection: { source: 'user', instructions: GUARD_CONTEXT, threshold: 0.5, evidence: true }, name: 'guard' },
  ],
});
await probe('screen_hostile', 'pipeline', {
  text: t('T-1017').text,
  steps: [
    { pii: { entities: PII_ENTITIES, anonymize: 'replace' }, name: 'protect' },
    { injection: { source: 'user', instructions: GUARD_CONTEXT, threshold: 0.5, evidence: true }, name: 'guard' },
  ],
});
await probe('extract_and_match', 'pipeline', {
  text: t('T-1008').text,
  steps: [
    { extract: { fields: EXTRACT_FIELDS }, name: 'extract' },
    {
      rerank: {
        query: t('T-1008').text,
        documents: [
          { id: 'T-1003', text: t('T-1003').text },
          { id: 'T-1005', text: t('T-1005').text },
          { id: 'T-1007', text: t('T-1007').text },
          { id: 'T-1002', text: t('T-1002').text },
        ],
        instructions: MATCH_INSTRUCTIONS,
      },
      name: 'match',
    },
  ],
});
await probe('compare_custom_instructions', 'compare', {
  documents: ['T-1003', 'T-1004', 'T-1008', 'T-1011', 'T-1005', 'T-1012'].map((id) => ({ id, text: t(id).text })),
  instructions: COMPARE_INSTRUCTIONS,
  evidence: 'all',
});
await probe('compare_default_instructions', 'compare', {
  documents: ['T-1003', 'T-1008', 'T-1011', 'T-1005'].map((id) => ({ id, text: t(id).text })),
  evidence: 'all',
});
await probe('decide', 'decide', {
  state: {
    service: 'Harbor VPN',
    reports: 4,
    sites_named: ['Austin', 'Denver'],
    minutes_since_first_report: 1.3,
    reports_in_last_five_minutes: 4,
    sample_reports: ['T-1003', 'T-1004', 'T-1006'].map((id) => t(id).text),
  },
  questions: DECIDE_QUESTIONS,
  instructions: DECIDE_INSTRUCTIONS,
});

// The first six tickets through the real engine, end to end.
const run = await runStorm(STORM.slice(0, 6), api, KB);
out.engine_first_six = {
  tickets: run.tickets.map((x) => ({ id: x.id, status: x.status, incidentId: x.incidentId, outcome: x.outcome, masked: x.masked, facts: x.facts, candidates: x.candidates, pairs: x.pairs })),
  incidents: run.incidents,
  calls: run.calls,
};
for (const x of run.tickets) console.log(`     ${x.id}  ${x.status.padEnd(10)} ${x.outcome}`);

mkdirSync('probe', { recursive: true });
writeFileSync('probe/out.json', JSON.stringify(out, null, 2));
const credits = Object.values(out).reduce((a: number, v: any) => a + (v?.credits ?? 0), 0) + run.calls.reduce((a, c) => a + (c.credits ?? 0), 0);
console.log(`\nSaved probe/out.json. Credits used: about ${credits}.`);
