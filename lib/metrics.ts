import { FAULT_NAMES, MAJOR, PLANTED_PII, TRUTH } from '../data/truth';
import type { CallLog, Incident, RawTicket, TicketRecord } from './types';

export type FaultScore = {
  fault: string;
  name: string;
  major: boolean;
  reports: number;
  /** Reports Squall put in the incident that holds most of this fault. */
  found: number;
  incidentId: string | null;
  status: string | null;
  firstReportAt: number;
  /** Storm time the incident was declared or put in front of the manager. */
  flaggedAt: number | null;
  flaggedAs: 'declared' | 'review' | null;
  reportsWhenFlagged: number | null;
};

export type Score = {
  tickets: number;
  grouped: { precision: number | null; recall: number | null; f1: number | null; truePairs: number; wrongPairs: number; missedPairs: number };
  hostile: { planted: number; held: number; wronglyHeld: string[] };
  unscreened: number;
  pii: { planted: number; leaked: string[] };
  faults: FaultScore[];
  wronglyDeclared: string[];
};

function pairScore(ids: string[], group: (id: string) => string | null) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const ga = TRUTH[ids[i]]?.incident ?? null;
      const gb = TRUTH[ids[j]]?.incident ?? null;
      const gold = ga !== null && ga === gb;
      const pa = group(ids[i]);
      const pb = group(ids[j]);
      const pred = pa !== null && pa === pb;
      if (pred && gold) tp++;
      else if (pred) fp++;
      else if (gold) fn++;
    }
  }
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall ? (2 * precision * recall) / (precision + recall) : null;
  return { precision, recall, f1, truePairs: tp, wrongPairs: fp, missedPairs: fn };
}

/** Scores a finished (or partial) run against the storm's ground truth. Only tickets with truth labels count. */
export function score(tickets: TicketRecord[], incidents: Incident[]): Score {
  const known = tickets.filter((t) => TRUTH[t.id]);
  const screened = known.filter((t) => t.status === 'alone' || t.status === 'joined');
  const byId = new Map(known.map((t) => [t.id, t]));
  const grouped = pairScore(screened.map((t) => t.id), (id) => byId.get(id)?.incidentId ?? null);
  const hostileIds = known.filter((t) => TRUTH[t.id].hostile).map((t) => t.id);
  const held = known.filter((t) => t.status === 'held');
  const leaked = PLANTED_PII.filter((s) => known.some((t) => t.masked !== null && t.text.includes(s) && t.masked.includes(s)));
  const planted = PLANTED_PII.filter((s) => known.some((t) => t.masked !== null && t.text.includes(s))).length;

  const faults: FaultScore[] = Object.keys(FAULT_NAMES).map((fault) => {
    const reports = screened.filter((t) => TRUTH[t.id].incident === fault);
    const counts = new Map<string, number>();
    for (const t of reports) if (t.incidentId) counts.set(t.incidentId, (counts.get(t.incidentId) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const inc = top ? incidents.find((i) => i.id === top[0]) ?? null : null;
    let flaggedAt: number | null = null;
    let flaggedAs: FaultScore['flaggedAs'] = null;
    let reportsWhenFlagged: number | null = null;
    if (inc) {
      const firstAsk = inc.decisions.find((d) => d.pMajor >= 0.5);
      if (inc.declaredAt !== null && inc.declaredBy === 'policy') {
        flaggedAt = inc.declaredAt;
        flaggedAs = 'declared';
        reportsWhenFlagged = inc.decisions.find((d) => d.at === inc.declaredAt)?.size ?? null;
      } else if (firstAsk) {
        flaggedAt = firstAsk.at;
        flaggedAs = 'review';
        reportsWhenFlagged = firstAsk.size;
      }
    }
    return {
      fault,
      name: FAULT_NAMES[fault],
      major: MAJOR[fault],
      reports: reports.length,
      found: top ? top[1] : 0,
      incidentId: inc?.id ?? null,
      status: inc?.status ?? null,
      firstReportAt: reports.length ? Math.min(...reports.map((t) => t.at)) : 0,
      flaggedAt,
      flaggedAs,
      reportsWhenFlagged,
    };
  });
  const wronglyDeclared = incidents
    .filter((i) => i.status === 'declared' && i.declaredBy === 'policy')
    .filter((i) => {
      const f = faults.find((x) => x.incidentId === i.id);
      return !f || !f.major;
    })
    .map((i) => i.id);
  return {
    tickets: known.length,
    grouped,
    hostile: { planted: hostileIds.length, held: hostileIds.filter((id) => byId.get(id)?.status === 'held').length, wronglyHeld: held.filter((t) => !TRUTH[t.id].hostile).map((t) => t.id) },
    unscreened: known.filter((t) => t.status === 'unscreened').length,
    pii: { planted, leaked },
    faults,
    wronglyDeclared,
  };
}

const KEYWORDS: [string, RegExp][] = [
  ['vpn', /vpn|harbor/i],
  ['sso', /keyring|sso|mfa/i],
  ['printer', /printer/i],
];

/**
 * The rule many desks run today: bucket tickets by keyword and raise an incident when
 * five land in one bucket within ten minutes. No model. It reads every ticket,
 * including the hostile one, because it has no way to tell.
 */
export function baseline(storm: RawTicket[]) {
  const bucket = (t: RawTicket) => KEYWORDS.find(([, re]) => re.test(t.text))?.[0] ?? null;
  const ids = storm.filter((t) => TRUTH[t.id]).map((t) => t.id);
  const byId = new Map(storm.map((t) => [t.id, t]));
  const grouped = pairScore(ids, (id) => bucket(byId.get(id)!));
  const faults = Object.keys(FAULT_NAMES).map((fault) => {
    const hits = storm.filter((t) => bucket(t) === fault);
    let flaggedAt: number | null = null;
    let wrongAtFlag = 0;
    for (let i = 4; i < hits.length; i++) {
      if (hits[i].at - hits[i - 4].at <= 600) {
        flaggedAt = hits[i].at;
        wrongAtFlag = hits.slice(0, i + 1).filter((t) => TRUTH[t.id]?.incident !== fault || TRUTH[t.id]?.hostile).length;
        break;
      }
    }
    return { fault, name: FAULT_NAMES[fault], inBucket: hits.length, wrongInBucket: hits.filter((t) => TRUTH[t.id]?.incident !== fault).length, flaggedAt, wrongAtFlag };
  });
  return { grouped, faults, hostileCounted: storm.filter((t) => TRUTH[t.id]?.hostile && bucket(t)).length };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Cost and latency of a run, straight from the X-Clocked-* headers logged on each call. */
export function costOf(calls: CallLog[]) {
  const ok = calls.filter((c) => c.ok);
  const by: Record<string, { calls: number; credits: number; modelMs: number[]; ms: number[] }> = {};
  for (const c of ok) {
    const key = c.endpoint === 'pipeline' ? `pipeline (${(c.steps ?? []).join(' + ')})` : c.endpoint;
    const b = (by[key] ??= { calls: 0, credits: 0, modelMs: [], ms: [] });
    b.calls++;
    b.credits += c.credits ?? 0;
    if (c.modelMs !== null) b.modelMs.push(c.modelMs);
    b.ms.push(c.ms);
  }
  return {
    calls: calls.length,
    failed: calls.length - ok.length,
    credits: ok.reduce((a, c) => a + (c.credits ?? 0), 0),
    costUsd: ok.reduce((a, c) => a + (c.costUsd ?? 0), 0),
    medianModelMs: median(ok.map((c) => c.modelMs).filter((x): x is number => x !== null)),
    medianRoundTripMs: median(ok.map((c) => c.ms)),
    byEndpoint: Object.fromEntries(
      Object.entries(by).map(([k, b]) => [k, { calls: b.calls, credits: b.credits, medianModelMs: median(b.modelMs), medianRoundTripMs: median(b.ms) }]),
    ),
  };
}
