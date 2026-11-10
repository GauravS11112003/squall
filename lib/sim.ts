import type { Api, ApiResult } from './api';
import type { Endpoint } from './types';

/**
 * OFFLINE SIMULATOR. Not Clocked.
 *
 * A keyword-rule stand-in that returns Clocked-shaped answers so the app and the
 * tests can run with no key and no network. Its numbers mean nothing: the UI
 * labels every simulated run, the evaluation script refuses to use it, and no
 * simulated number appears in the README.
 */

const NAMES = ['Dana Whitfield', 'Lena Kowalczyk', 'Priyanka Raman', 'Marcus Oyelaran', 'Yusuf Adeyemi', 'Tomasz Brandt'];
const TOPICS: [string, RegExp][] = [
  ['vpn', /harbor|vpn/i],
  ['sso', /keyring|sso|mfa/i],
  ['printer', /printer/i],
];

function topicOf(text: string): string | null {
  return TOPICS.find(([, re]) => re.test(text))?.[0] ?? null;
}

function faultOf(text: string): string | null {
  const topic = topicOf(text);
  if (topic === 'vpn') {
    if (/slow|install|crawl/i.test(text)) return null;
    return /809|not responding|no responde|connect|down|dead|ded|refuses|fails|gw2|backup gateway|no vpn|outage/i.test(text) ? 'vpn' : null;
  }
  if (topic === 'sso') {
    if (/new phone|move my/i.test(text)) return null;
    return /push|approval|prompt|request|broken/i.test(text) ? 'sso' : null;
  }
  if (topic === 'printer') return /offline|won't print/i.test(text) ? 'printer' : null;
  return null;
}

let tick = 0;
function cost(base: number): { modelMs: number; credits: number; costUsd: number } {
  const modelMs = base + ((tick++ * 37) % 60);
  const credits = Math.max(1, Math.ceil(modelMs / 25));
  return { modelMs, credits, costUsd: credits * 0.0004 };
}

function find(text: string, re: RegExp) {
  const m = re.exec(text);
  return m ? { value: m[0], start: m.index, end: m.index + m[0].length, confidence: 0.9 } : { value: null };
}

function pii(body: any) {
  const text: string = body.text;
  const entities: any[] = [];
  const add = (type: string, re: RegExp) => {
    for (const m of text.matchAll(re)) entities.push({ type, value: m[0], start: m.index, end: m.index! + m[0].length, confidence: 0.95, source: 'sim' });
  };
  add('person', new RegExp(NAMES.join('|'), 'g'));
  add('phone', /\b\d{3}-\d{3}-\d{4}\b/g);
  add('email', /[\w.]+@[\w.]+\.\w+/g);
  entities.sort((a, b) => a.start - b.start);
  let out = text;
  for (const e of [...entities].reverse()) out = out.slice(0, e.start) + `<${e.type.toUpperCase()}>` + out.slice(e.end);
  const counts: Record<string, number> = {};
  for (const e of entities) counts[e.type] = (counts[e.type] ?? 0) + 1;
  return { model: 'simulator', entities, counts, threshold: 0.5, instructions_used: 'sim', anonymized_text: out };
}

function injection(body: any) {
  const text: string = body.text;
  const m = /ignore all previous instructions[^.]*\.|SYSTEM NOTE[^:]*:/i.exec(text);
  const p = m ? 0.97 : 0.02;
  return {
    model: 'simulator',
    injection: p,
    verdict: m ? 'injection' : 'benign',
    threshold: body.threshold ?? 0.5,
    source: body.source ?? 'user',
    instructions_used: 'sim',
    category: m ? 'instruction_override' : 'benign',
    categories: { benign: 1 - p, instruction_override: p },
    severity: m ? 'high' : 'none',
    evidence: m ? [{ quote: m[0], start: m.index, end: m.index + m[0].length, confidence: 0.95 }] : [],
  };
}

function extract(body: any) {
  const t: string = body.text;
  const rules: Record<string, RegExp> = {
    service: /Harbor VPN|Harbor|VPN|vpn|Keyring|SSO|printer|Excel|monitor|badge reader|laptop/,
    symptom: /gateway (is )?not responding|won't reconnect|fails with 809|refuses to connect|push approval|not arriving|offline|crashes|flickers|no responde/,
    error: /809/,
    site: /Austin|Denver|Chicago|Lisbon|austin/,
    started: /since Friday afternoon|about 8:40|roughly 8:40|around 8:43|this morning|hace unos minutos/,
    impact: /customer demo at 9:30|payroll cutoff is 11am|shipping labels today/,
  };
  const fields: Record<string, any> = {};
  for (const name of Object.keys(body.fields)) fields[name] = rules[name] ? find(t, rules[name]) : { value: null };
  return { model: 'simulator', fields };
}

function levels(action: string, reason: string | null, rel: number, withConv: boolean) {
  const rest = 1 - rel;
  const l: Record<string, number> = { answers: 0, elsewhere: 0, different_case: 0, unrelated: 0 };
  if (withConv) l.already_given = 0;
  if (action === 'use') Object.assign(l, { answers: rel, elsewhere: rest * 0.5, different_case: rest * 0.3, unrelated: rest * 0.2 });
  else if (action === 'expand') Object.assign(l, { answers: rel, elsewhere: 0.7, different_case: 0.1, unrelated: 0.2 - rel });
  else Object.assign(l, { answers: rel, [reason!]: 0.9 - rel, unrelated: reason === 'unrelated' ? 0.9 - rel : 0.1 });
  return l;
}

function rerank(body: any) {
  const q: string = body.query;
  const conv: string = (body.conversation ?? []).map((c: any) => c.content).join('\n');
  const qFault = faultOf(q) ?? faultOf(conv);
  const qTopic = topicOf(q) ?? topicOf(conv);
  const isKb = body.documents.some((d: any) => String(d.id ?? '').startsWith('KB-'));
  const results = body.documents.map((d: any, index: number) => {
    const text = `${d.title ?? ''} ${d.text ?? d}`;
    let action = 'skip';
    let reason: string | null = 'unrelated';
    let rel = 0.03;
    if (isKb) {
      const kb: Record<string, [string, string | null, number]> = {
        'KB-110': ['use', null, 0.9],
        'KB-102': ['use', null, 0.86],
        'KB-101': ['expand', null, 0.2],
        'KB-103': ['skip', 'different_case', 0.3],
        'KB-104': ['skip', 'different_case', 0.12],
        'KB-107': ['use', null, 0.88],
        'KB-109': ['use', null, 0.8],
      };
      const fitsFault = (qFault === 'vpn' && /KB-10[1-4]|KB-110/.test(d.id)) || (qFault === 'sso' && d.id === 'KB-107') || (qFault === 'printer' && d.id === 'KB-109');
      if (fitsFault && kb[d.id]) [action, reason, rel] = kb[d.id];
      else if (topicOf(text) === qTopic) [action, reason, rel] = ['skip', 'different_case', 0.08];
      if (conv && fitsFault) {
        if (conv.includes(String(d.text).slice(0, 40))) [action, reason, rel] = ['skip', 'already_given', 0.1];
        else if (d.id === 'KB-103') [action, reason, rel] = ['use', null, 0.84];
        else if (d.id === 'KB-110') [action, reason, rel] = ['skip', 'different_case', 0.2];
      }
    } else if (qFault && faultOf(text) === qFault) [action, reason, rel] = ['use', null, 0.9];
    else if (qTopic && topicOf(text) === qTopic) [action, reason, rel] = ['skip', 'different_case', 0.12];
    return { index, id: d.id, action, ...(action === 'skip' ? { reason } : {}), relevance_score: rel, document_score: Math.min(1, rel + 0.05), levels: levels(action, reason, rel, Boolean(conv)) };
  });
  results.sort((a: any, b: any) => b.relevance_score - a.relevance_score);
  return { model: 'simulator', results, usage: { input_tokens: 0 }, timing: { total_ms: 0, rerank_ms: 0, questions_ms: 0, model_ms: 0, engine: {} } };
}

function compare(body: any) {
  const docs: { id: string; text: string }[] = body.documents.map((d: any, i: number) => (typeof d === 'string' ? { id: `doc${i + 1}`, text: d } : d));
  const pairs: any[] = [];
  const passage = (d: { id: string; text: string }, re: RegExp) => {
    const m = re.exec(d.text) ?? /\S.{0,40}/.exec(d.text)!;
    return { document: d.id, quote: m[0], start: m.index, end: m.index + m[0].length, confidence: 0.9 };
  };
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const [a, b] = [docs[i], docs[j]];
      const fa = faultOf(a.text);
      const same = fa && fa === faultOf(b.text);
      const friday = /Friday/.test(a.text) !== /Friday/.test(b.text) && /8:40|this morning|minutos/.test(a.text + b.text);
      const sameTopic = topicOf(a.text) && topicOf(a.text) === topicOf(b.text);
      const relation = same ? (friday ? 'conflicting' : 'same') : sameTopic ? 'overlapping' : 'unrelated';
      const probabilities = { same: 0.02, overlapping: 0.03, conflicting: 0.02, unrelated: 0.02, [relation]: 0.93 } as Record<string, number>;
      const key = /809|not responding|no responde|push|approval|offline|connect/i;
      const when = /since Friday afternoon|about 8:40|roughly 8:40|this morning|hace unos minutos/;
      pairs.push({
        a: a.id,
        b: b.id,
        relation,
        related: relation === 'unrelated' ? 0.07 : 0.95,
        probabilities,
        duplicate: same ? { kind: 'same_fault', kinds: { same_fault: 0.9 }, confidence: 0.9, a: passage(a, key), b: passage(b, key) } : null,
        conflict: same && friday ? { kind: 'date', kinds: { date: 0.9 }, confidence: 0.88, a: passage(a, when), b: passage(b, when) } : null,
      });
    }
  }
  const idx = (r: string) => pairs.map((p, i) => (p.relation === r ? i : -1)).filter((i) => i >= 0);
  return { model: 'simulator', verdict: 'sim', threshold: 0.5, instructions_used: 'sim', evidence: 'all', documents: [], pairs, duplicates: idx('same'), overlaps: idx('overlapping'), conflicts: idx('conflicting') };
}

function decide(body: any) {
  const s = body.state ?? {};
  const reports = Number(s.reports ?? 1);
  const sites = (s.sites_named ?? []).length;
  const small = /printer|monitor/i.test(String(s.service));
  const p = Math.max(0.03, Math.min(0.98, (small ? 0.05 : 0.5) + 0.09 * reports + (sites > 1 ? 0.12 : 0)));
  const scope = sites > 1 ? 'several_sites' : reports > 4 ? 'one_site' : 'one_team';
  const level = small ? 1 : Math.min(3, 1 + Math.floor(reports / 3));
  const legend = Object.fromEntries((body.questions.severity?.criteria ?? []).map((c: string, i: number) => [String(i), c]));
  return {
    model: 'simulator',
    answers: {
      major: { type: 'noul', noul: p },
      scope: { type: 'choice', choice: scope, probabilities: { one_person: 0.02, one_team: 0.08, one_site: 0.1, several_sites: 0.1, [scope]: 0.7 }, confidence: 0.7 },
      severity: { type: 'score', score: level, legend, probabilities: { '0': 0.05, '1': 0.1, '2': 0.15, '3': 0.1, [String(level)]: 0.6 }, confidence: 0.6 },
    },
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

function script(body: any) {
  const code: string = body.script;
  const bad = [...code.matchAll(/^.*(DisableRealtimeMonitoring|Invoke-WebRequest|ExecutionPolicy Bypass|CurrentVersion\\Run).*$/gm)];
  const p = bad.length ? 0.97 : 0.02;
  return {
    model: 'simulator',
    malicious: p,
    suspicious: bad.length ? 0.99 : 0.05,
    verdict: bad.length ? 'malicious' : 'benign',
    threshold: body.threshold ?? 0.5,
    instructions_used: 'sim',
    category: bad.length ? 'defense_evasion' : 'benign',
    categories: { benign: 1 - p, defense_evasion: p },
    severity: bad.length ? 'critical' : 'none',
    evidence: bad.map((m) => ({ line: m[0], start: m.index, end: m.index! + m[0].length, confidence: 0.94 })),
  };
}

function fill(body: any) {
  const t: string = body.text;
  const vpn = /Harbor/.test(t);
  const fields: Record<string, any> = {
    service: find(t, /Harbor VPN|Keyring|printer/),
    error: find(t, /809/),
    started: find(t, /8:4\d/),
    who: { value: vpn ? 'remote employees in Austin and Denver' : 'employees in the Chicago office', source: 'generated' },
    action: {
      value: vpn
        ? 'Open Harbor, choose Settings, then Gateway, select gw2 (Backup) and press Connect.'
        : "Choose 'Use a code instead' on the sign-in page and type the 6-digit code from the Keyring app.",
      source: 'generated',
    },
  };
  return { model: 'simulator', fields: Object.fromEntries(Object.keys(body.fields).map((k) => [k, fields[k] ?? { value: null }])) };
}

function grounding(body: any) {
  const docs: { id: string; text: string }[] = body.documents.map((d: any, i: number) => (typeof d === 'string' ? { id: `doc${i + 1}`, text: d } : d));
  const all = docs.map((d) => d.text).join('\n').toLowerCase();
  const sentences: string[] = String(body.answer).split(/(?<=[.!?])\s+/).filter((s: string) => s.trim());
  const claims = sentences.map((claim) => {
    const tokens = claim.toLowerCase().match(/[a-z0-9:]{4,}/g) ?? [];
    const hit = tokens.filter((w) => all.includes(w)).length / Math.max(1, tokens.length);
    const supported = Math.min(0.98, hit);
    const src = docs.find((d) => tokens.some((w) => w.length > 5 && d.text.toLowerCase().includes(w)));
    return {
      claim,
      kind: 'fact',
      counted: true,
      weight: claim.length,
      supported,
      contradicted: 0.01,
      not_stated: 1 - supported - 0.01,
      not_a_claim: 0,
      verdict: supported >= (body.threshold ?? 0.5) + 0.25 ? 'supported' : 'not_stated',
      source: src?.id ?? null,
      evidence: src ? { document: src.id, quote: src.text.slice(0, 80), start: 0, end: 80, confidence: 0.8 } : undefined,
    };
  });
  for (const c of claims) if (c.verdict !== 'supported') c.supported = Math.min(c.supported, 0.3);
  const grounded = claims.reduce((a, c) => a + c.supported * c.weight, 0) / Math.max(1, claims.reduce((a, c) => a + c.weight, 0));
  return { model: 'simulator', grounded, ungrounded: 1 - grounded, verdict: claims.every((c) => c.verdict === 'supported') ? 'grounded' : 'ungrounded', threshold: body.threshold ?? 0.5, instructions_used: 'sim', documents: [], claims, answers_question: 0.9 };
}

const HANDLERS: Record<string, (body: any) => any> = { pii, injection, extract, rerank, compare, decide, script, fill, grounding };
const BASE_MS: Record<string, number> = { pii: 420, injection: 150, extract: 190, rerank: 160, compare: 260, decide: 180, script: 210, fill: 380, grounding: 240 };

function pipeline(body: any) {
  let modelMs = 0;
  const steps = body.steps.map((s: any, step: number) => {
    const endpoint = Object.keys(s).find((k) => k !== 'name' && k !== 'stop')!;
    const req = { ...(s[endpoint] ?? {}) };
    const textKey = endpoint === 'decide' ? 'state' : endpoint === 'script' ? 'script' : 'text';
    if (!['grounding', 'compare', 'rerank'].includes(endpoint) && req[textKey] === undefined) req[textKey] = body.text;
    const ms = BASE_MS[endpoint];
    modelMs += ms;
    return { step, endpoint, name: s.name, status: 200, ms, result: HANDLERS[endpoint](req) };
  });
  return { data: { model: 'simulator', steps, stopped: null, timing: { total_ms: modelMs, model_ms: modelMs } }, modelMs };
}

export function simApi(): Api {
  return {
    mode: 'sim',
    async request<T>(endpoint: Endpoint, body: object): Promise<ApiResult<T>> {
      // A short pause so the simulated storm animates like a real one.
      await new Promise((r) => setTimeout(r, process.env.VITEST ? 0 : 90));
      if (endpoint === 'pipeline') {
        const p = pipeline(body);
        const credits = Math.max(1, Math.ceil(p.modelMs / 25));
        return { data: p.data as T, modelMs: p.modelMs, credits, costUsd: credits * 0.0004 };
      }
      return { data: HANDLERS[endpoint](body) as T, ...cost(BASE_MS[endpoint]) };
    },
  };
}
