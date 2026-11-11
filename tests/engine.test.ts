import { describe, expect, it } from 'vitest';
import { KB } from '../data/kb';
import { STORM } from '../data/storm';
import { TRUTH } from '../data/truth';
import type { Api } from '../lib/api';
import { step } from '../lib/engine';
import { runStorm } from '../lib/run';
import { simApi } from '../lib/sim';

describe('engine on the simulator', () => {
  it('runs the whole storm, groups the faults and keeps the hostile ticket out', async () => {
    const run = await runStorm(STORM, simApi(), KB);
    const byId = Object.fromEntries(run.tickets.map((t) => [t.id, t]));
    expect(byId['T-1017'].status).toBe('held');
    expect(byId['T-1017'].incidentId).toBeNull();
    // every grouped ticket shares an incident only with tickets of the same true fault
    for (const inc of run.incidents) {
      const faults = new Set(inc.memberIds.map((id) => TRUTH[id].incident));
      expect(faults.size).toBe(1);
    }
    const vpn = run.incidents.find((i) => i.memberIds.includes('T-1001'))!;
    expect(vpn.status).toBe('declared');
    expect(vpn.response?.reply?.passageIds).toEqual(['KB-102']);
    // the poisoned passage ranked first and was blocked by Inspect
    const poisoned = vpn.response!.passages.find((p) => p.id === 'KB-110')!;
    expect(poisoned.blocked).toBe('script');
    // a follow-up gets the next step, not the same one again
    expect(byId['T-1034'].sent).toEqual(['KB-102', 'KB-103']);
    // personal data never reaches the masked text
    expect(byId['T-1001'].masked).not.toContain('Dana');
    expect(byId['T-1001'].masked).not.toContain('555-0143');
  });

  it('fails closed: when Clocked is unreachable nothing is grouped', async () => {
    const dead: Api = { mode: 'sim', request: async () => { throw Object.assign(new Error('boom'), { status: 503 }); } };
    const out = await step({ ticket: STORM[0], incidents: [], prior: [] }, dead, KB);
    expect(out.ticket.status).toBe('unscreened');
    expect(out.ticket.masked).toBeNull();
    expect(out.incidents).toHaveLength(0);
    expect(out.calls[0].ok).toBe(false);
  });

  it('does not merge when Compare fails', async () => {
    const sim = simApi();
    const flaky: Api = { mode: 'sim', request: async (e, b) => { if (e === 'compare') throw new Error('timeout'); return sim.request(e, b); } };
    const run = await runStorm(STORM.slice(0, 4), flaky, KB);
    expect(run.incidents).toHaveLength(0);
    expect(run.tickets.every((t) => t.status === 'alone')).toBe(true);
  });
});

describe('policy lines and the story', () => {
  it('a higher declare line sends the same incident to a person instead', async () => {
    const run = await runStorm(STORM.slice(0, 9), simApi(), KB, undefined, { autoDeclare: 0.99 });
    const vpn = run.incidents.find((i) => i.memberIds.includes('T-1001'))!;
    expect(vpn.status).toBe('review');
    expect(vpn.response).toBeNull();
  });

  it('tells the run as plain events, in order, and what-if reads recorded Decide answers only', async () => {
    const { storyOf, whatIf, journeyOf } = await import('../lib/story');
    const { resolvePolicy } = await import('../lib/policy');
    const run = await runStorm(STORM, simApi(), KB);
    const P = resolvePolicy();
    const events = storyOf(run.tickets, run.incidents, P);
    expect(events.map((e) => e.at)).toEqual([...events.map((e) => e.at)].sort((a, b) => a - b));
    expect(events.some((e) => e.kind === 'held' && e.ticketId === 'T-1017')).toBe(true);
    expect(events.some((e) => e.kind === 'blocked' && e.title.includes('KB-110'))).toBe(true);
    expect(events.some((e) => e.kind === 'followup' && e.ticketId === 'T-1034')).toBe(true);
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    const strict = whatIf(run.incidents, resolvePolicy({ autoDeclare: 0.99, askManager: 0.99 }));
    expect(strict.every((w) => w.outcome === 'watching')).toBe(true);
    const held = run.tickets.find((t) => t.id === 'T-1017')!;
    expect(journeyOf(held, run.incidents).map((s) => s.state)).toEqual(['done', 'stop', 'skip', 'skip', 'skip', 'skip']);
  });
});

describe('what goes out', () => {
  it('builds a status page from supported claims only, a brief, and a checked personal reply', async () => {
    const { statusPageHtml, briefHtml } = await import('../lib/outputs');
    const { personalReply } = await import('../lib/engine');
    const { resolvePolicy } = await import('../lib/policy');
    const { KB_BY_ID } = await import('../data/kb');
    const run = await runStorm(STORM, simApi(), KB);
    const P = resolvePolicy();
    const vpn = run.incidents.find((i) => i.memberIds.includes('T-1001'))!;
    const status = statusPageHtml(vpn, run.tickets, run.incidents, P, 'test');
    const v = vpn.response!.verification!;
    for (const c of v.claims.filter((x) => x.counted && x.supported < P.claimSupport)) expect(status).not.toContain(c.claim);
    for (const c of v.claims.filter((x) => x.counted && x.supported >= P.claimSupport)) expect(status).toContain(c.claim.replace(/&/g, '&amp;'));
    expect(status).not.toContain('Dana Whitfield');
    expect(briefHtml(vpn, run.tickets, run.incidents, run.calls, P, 'test')).toContain('KB-110');
    const t = run.tickets.find((x) => x.id === 'T-1014')!;
    const r = await personalReply(simApi(), { ticket: { id: t.id, masked: t.masked! }, passages: [KB_BY_ID['KB-102']], incidentId: vpn.id, at: t.at });
    expect(r.reply.text.length).toBeGreaterThan(20);
    expect(r.reply.verification).not.toBeNull();
    expect(r.calls.map((c) => c.endpoint)).toEqual(['fill', 'grounding']);
  });
});
