import type { Policy } from './policy';
import type { Incident, TicketRecord } from './types';
import { clip, incidentName, pct } from './format';
import type { Tone } from './format';

/**
 * The plain-language layer. Everything here is derived from the engine's state by
 * string-building and counting: no model is asked what happened. The same events
 * feed the caption, the moment banners, the Activity tab and the exported report.
 */
export type StoryEvent = {
  id: string;
  at: number;
  rank: number;
  kind: 'held' | 'unread' | 'alone' | 'joined' | 'followup' | 'formed' | 'conflict' | 'review' | 'declared' | 'blocked' | 'sent' | 'checked';
  tone: Tone;
  title: string;
  detail: string;
  target: { kind: 'incident' | 'ticket'; id: string };
  ticketId: string | null;
  incidentId: string | null;
  /** Worth interrupting for: shown as a banner over the stage. */
  moment: boolean;
};

const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function storyOf(tickets: TicketRecord[], incidents: Incident[], P: Policy): StoryEvent[] {
  const out: StoryEvent[] = [];
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const incById = new Map(incidents.map((i) => [i.id, i]));
  // Ids must not depend on wording: an incident's name can change as reports come in.
  const push = (e: Omit<StoryEvent, 'id'>, extra = '') => out.push({ ...e, id: `${e.kind}:${e.ticketId ?? ''}:${e.kind === 'joined' || e.kind === 'alone' ? '' : e.incidentId ?? ''}:${extra}` });

  for (const t of tickets) {
    const base = { at: t.at, ticketId: t.id, incidentId: t.incidentId, target: { kind: 'ticket' as const, id: t.id } };
    if (t.status === 'held') {
      push({ ...base, rank: 0, kind: 'held', tone: 'red', moment: true, title: `${t.id} was held: it tried to steer the system`, detail: `Guard put prompt injection at ${pct(t.guard?.injection)}. The ticket is kept out of every incident and waits for a person.` });
    } else if (t.status === 'unscreened') {
      push({ ...base, rank: 0, kind: 'unread', tone: 'red', moment: true, title: `${t.id} could not be screened, so it was not read`, detail: t.outcome });
    } else if (t.status === 'alone') {
      push({ ...base, rank: 0, kind: 'alone', tone: 'slate', moment: false, title: `${t.id} stands on its own`, detail: sentence(t.outcome.replace(/^On its own\.\s*/, '').replace(/^First of its kind:\s*/, '')) });
    } else {
      const name = incidentName(incById.get(t.incidentId ?? ''));
      push({ ...base, rank: 0, kind: 'joined', tone: 'blue', moment: false, title: `${t.id} joined ${name}`, detail: sentence(t.outcome.replace(/^Joined INC-\d+:\s*/, '').replace(/^Grouped with (T-\d+): Compare read them as the same fault\./, 'Compare read it as the same fault as $1.').replace(/\s*Follow-up:.*$/, '')) });
    }
    if (t.followUp) {
      const given = t.followUp.filter((p) => p.reason === 'already_given').map((p) => p.id);
      const next = t.followUp.find((p) => p.selected)?.id;
      push({
        ...base,
        rank: 1,
        kind: 'followup',
        tone: next ? 'green' : 'amber',
        moment: true,
        title: next ? `${t.id} already had the fix, so it got the next step` : `${t.id} already had the fix, and there is nothing new to send`,
        detail: `Rerank read the whole thread${given.length ? `: ${given.join(', ')} was already given` : ''}${next ? `, so ${next} goes out and the same advice is not repeated.` : '. A person should reply.'}`,
      });
    }
  }

  for (const inc of incidents) {
    const name = incidentName(inc);
    const members = inc.memberIds.map((id) => byId.get(id)).filter(Boolean) as TicketRecord[];
    const first = members.length ? Math.min(...members.map((m) => m.at)) : inc.createdAt;
    const base = { ticketId: null, incidentId: inc.id, target: { kind: 'incident' as const, id: inc.id } };
    push({ ...base, at: inc.createdAt, rank: 3, kind: 'formed', tone: 'blue', moment: true, title: `A storm is forming: ${name}`, detail: 'Two tickets describe the same fault in different words, so they became one incident.' });
    for (const c of inc.conflicts) {
      const at = Math.max(byId.get(c.a)?.at ?? inc.createdAt, byId.get(c.b)?.at ?? inc.createdAt);
      push({ ...base, at, rank: 2, kind: 'conflict', tone: 'orange', moment: true, title: `Two reports of ${name} disagree`, detail: `${c.a} says “${clip(c.aQuote, 46)}”, ${c.b} says “${clip(c.bQuote, 46)}”.` }, `${c.a}-${c.b}`);
    }
    const asked = inc.decisions.find((d) => d.pMajor >= P.askManager && (inc.declaredAt === null || d.at < inc.declaredAt));
    if (asked && (inc.status === 'review' || inc.declaredBy === 'manager' || inc.declaredAt !== null)) {
      push({ ...base, at: asked.at, rank: 4, kind: 'review', tone: 'amber', moment: true, title: `${name} needs your call`, detail: `Decide put a major incident at ${pct(asked.pMajor)} with ${asked.size} reports: enough to ask you, not enough to declare alone.` });
    }
    if (inc.status === 'declared' && inc.declaredAt !== null) {
      const at = inc.declaredAt;
      const size = inc.decisions.find((d) => d.at === at)?.size ?? members.filter((m) => m.at <= at).length;
      push({
        ...base,
        at,
        rank: 5,
        kind: 'declared',
        tone: 'red',
        moment: true,
        title: `Major incident: ${name}`,
        detail: `Declared ${inc.declaredBy === 'manager' ? 'by you' : 'automatically'} ${Math.max(0, Math.round(at - first))} seconds after the first report, with ${size} reports in.`,
      });
    }
    const res = inc.response;
    if (res) {
      for (const p of res.passages.filter((x) => x.blocked)) {
        push({
          ...base,
          at: res.at,
          rank: 6,
          kind: 'blocked',
          tone: 'red',
          moment: true,
          title: `Blocked a dangerous fix: ${p.id}`,
          detail:
            p.blocked === 'script'
              ? `Rerank scored it ${pct(p.relevance)} relevant, but Inspect read its script as ${pct(p.script?.malicious)} malicious. It never reached a laptop.`
              : p.blocked === 'injection'
                ? `Guard read the passage as ${pct(p.guard?.injection)} likely to carry an injected instruction. It was not sent.`
                : 'Its safety check did not answer, so it was not sent.',
        }, p.id);
      }
      if (res.reply) {
        push({ ...base, at: res.at, rank: 7, kind: 'sent', tone: 'green', moment: false, title: `Checked workaround sent: ${res.reply.passageIds.join(', ')}`, detail: `It went to the ${members.filter((m) => m.at <= res.at).length} people in ${name}, after Guard and Inspect cleared it.` });
      }
      const v = res.verification;
      if (v && v.claims.length) {
        const counted = v.claims.filter((c) => c.counted);
        const ok = counted.filter((c) => c.supported >= P.claimSupport).length;
        push({
          ...base,
          at: res.at,
          rank: 8,
          kind: 'checked',
          tone: v.sendable ? 'green' : 'amber',
          moment: !v.sendable,
          title: v.sendable ? `Company update drafted and every claim checked` : `Company update drafted, but held back`,
          detail: v.sendable ? `All ${counted.length} claims are supported by the reports. It is ready for you to send.` : `${counted.length - ok} of ${counted.length} claims ${counted.length - ok === 1 ? 'is' : 'are'} not supported by the reports, so it cannot be sent as written.`,
        });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at || a.rank - b.rank);
}

export type JourneyStep = {
  key: string;
  /** What the step does, in a word. */
  verb: string;
  /** The Clocked endpoint that does it. */
  endpoint: string;
  /** done: ran and passed on. end: ran, and the ticket's journey ends here normally. stop: ran, and the ticket was stopped. */
  state: 'done' | 'end' | 'stop' | 'skip' | 'fail' | 'wait';
  note: string;
};

const STEPS: [string, string, string][] = [
  ['mask', 'Mask', 'Protect'],
  ['screen', 'Screen', 'Guard'],
  ['read', 'Read', 'Extract'],
  ['shortlist', 'Shortlist', 'Rerank'],
  ['match', 'Match', 'Compare'],
  ['size', 'Size up', 'Decide'],
];

/** The six steps every ticket can take, and how far this one got. */
export function journeyOf(t: TicketRecord | null, incidents: Incident[]): JourneyStep[] {
  const mk = (i: number, state: JourneyStep['state'], note: string): JourneyStep => ({ key: STEPS[i][0], verb: STEPS[i][1], endpoint: STEPS[i][2], state, note });
  if (!t) return STEPS.map((_, i) => mk(i, 'wait', 'Waiting for a ticket'));
  const n = Object.values(t.piiCounts).reduce((a, b) => a + b, 0) || t.pii.length;
  const facts = Object.values(t.facts).filter(Boolean).length;
  const held = t.status === 'held';
  const past = t.status === 'alone' || t.status === 'joined';
  const best = t.candidates.find((c) => c.action !== 'skip');
  const pair = t.pairs.find((p) => p.relation === 'same' || p.relation === 'conflicting');
  const inc = incidents.find((i) => i.id === t.incidentId);
  const decision = inc?.decisions.find((d) => d.at === t.at);
  return [
    t.masked === null ? mk(0, 'fail', 'Protect did not answer') : mk(0, 'done', n ? `${n} piece${n === 1 ? '' : 's'} of personal data hidden` : 'No personal data found'),
    !t.guard ? mk(1, t.masked === null ? 'skip' : 'fail', t.masked === null ? 'Not reached' : 'Guard did not answer') : held ? mk(1, 'stop', `${pct(t.guard.injection)} injection: held`) : mk(1, 'done', `${pct(t.guard.injection)} injection: safe to read`),
    !past ? mk(2, 'skip', 'Not reached') : mk(2, 'done', facts ? `${facts} facts quoted from the ticket` : 'No facts quoted'),
    !past ? mk(3, 'skip', 'Not reached') : t.candidates.length ? mk(3, best ? 'done' : 'end', best ? `${best.id} could be the same fault (${pct(best.relevance)})` : 'Nothing open is the same case') : mk(3, 'skip', t.thread && t.incidentId ? 'A reply in a thread: no search needed' : 'Nothing open to search'),
    t.pairs.length ? mk(4, pair && t.status === 'joined' ? 'done' : 'end', pair && t.status === 'joined' ? `Same fault as ${pair.with}` : 'Not the same fault') : mk(4, 'skip', 'Nothing to compare'),
    decision ? mk(5, 'done', `${pct(decision.pMajor)} major at ${decision.size} reports`) : mk(5, 'skip', inc ? 'Not sized up on this ticket' : 'Not in an incident'),
  ];
}

export type WhatIf = { incidentId: string; name: string; outcome: 'declared' | 'asked' | 'watching'; at: number | null; size: number | null; p: number | null };

/**
 * What a pair of policy lines would have done with the Decide readings already taken.
 * It only reads recorded probabilities: once an incident is declared Decide is not
 * asked again, so there may be no later readings to judge a higher line against.
 */
export function whatIf(incidents: Incident[], P: Policy): WhatIf[] {
  return incidents
    .filter((i) => i.decisions.length > 0)
    .map((i) => {
      const hit = i.decisions.find((d) => d.pMajor >= P.autoDeclare) ?? null;
      const ask = i.decisions.find((d) => d.pMajor >= P.askManager) ?? null;
      const conflicted = i.conflicts.length > 0;
      const d = hit && !conflicted ? hit : ask;
      return { incidentId: i.id, name: incidentName(i), outcome: hit && !conflicted ? 'declared' : ask ? 'asked' : 'watching', at: d?.at ?? null, size: d?.size ?? null, p: d?.pMajor ?? Math.max(...i.decisions.map((x) => x.pMajor)) };
    });
}
