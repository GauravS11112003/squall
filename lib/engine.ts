import type {
  CompareResponse,
  DecideResponse,
  ExtractResponse,
  FillResponse,
  GroundingResponse,
  InjectionResponse,
  PiiResponse,
  PipelineResponse,
  RerankResponse,
  ScriptResponse,
} from 'clocked-sdk';
import type { Api } from './api';
import {
  COMPARE_INSTRUCTIONS,
  DECIDE_INSTRUCTIONS,
  DECIDE_QUESTIONS,
  DRAFT_FIELDS,
  EXTRACT_FIELDS,
  GUARD_CONTEXT,
  KB_INSTRUCTIONS,
  MATCH_INSTRUCTIONS,
  PII_ENTITIES,
  POLICY,
  REPLY_FIELDS,
  REPLY_INSTRUCTIONS,
  VERIFY_QUESTION,
  resolvePolicy,
} from './policy';
import type { Policy, PolicyOverrides } from './policy';
import type {
  CallLog,
  Candidate,
  Claim,
  Decision,
  DraftField,
  Endpoint,
  Fact,
  Incident,
  IncidentResponse,
  KbPassage,
  PairResult,
  PassageChoice,
  PassageQuote,
  PersonalReply,
  PriorTicket,
  StepInput,
  StepOutput,
  TicketRecord,
  Verification,
} from './types';

type Ctx = { api: Api; calls: CallLog[]; at: number; seq: number; ticketId: string | null; P: Policy };

type Update = StepOutput['moved'][number];

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const pct = (p: number) => `${Math.round(p * 100)}%`;

function errorText(e: unknown): string {
  const any = e as { name?: string; status?: number | null; error?: string; message?: string };
  if (any?.status === 401) return 'Clocked rejected the API key (401). Check CLOCKED_API_KEY.';
  if (any?.status === 402) return 'The Clocked account is out of credits (402).';
  if (any?.status === 429) return 'Clocked is at this plan\'s concurrency limit (429). Slow the storm down.';
  const head = any?.status ? `Clocked answered ${any.status}` : 'Clocked could not be reached';
  const tail = any?.error || any?.message || String(e);
  return `${head}: ${clip(String(tail), 180)}`;
}

/** One Clocked call, logged with its timing and cost. Returns null when the call failed. */
async function call<T>(
  ctx: Ctx,
  endpoint: Endpoint,
  label: string,
  body: object,
  extra: { incidentId?: string | null; steps?: string[] } = {},
): Promise<T | null> {
  const started = Date.now();
  const log: CallLog = {
    id: `${ctx.ticketId ?? 'x'}-${ctx.seq++}-${endpoint}`,
    at: ctx.at,
    endpoint,
    steps: extra.steps,
    label,
    ticketId: ctx.ticketId,
    incidentId: extra.incidentId ?? null,
    ok: true,
    error: null,
    ms: 0,
    modelMs: null,
    credits: null,
    costUsd: null,
  };
  try {
    const r = await ctx.api.request<T>(endpoint, body);
    log.ms = Date.now() - started;
    log.modelMs = r.modelMs;
    log.credits = r.credits;
    log.costUsd = r.costUsd;
    ctx.calls.push(log);
    return r.data;
  } catch (e) {
    log.ms = Date.now() - started;
    log.ok = false;
    log.error = errorText(e);
    ctx.calls.push(log);
    return null;
  }
}

/** A pipeline step's result, or null when that step failed or was skipped. */
function stepResult<T>(p: PipelineResponse | null, index: number): T | null {
  const s = p?.steps?.[index] as { result?: unknown } | undefined;
  return (s?.result as T) ?? null;
}

function maskFromSpans(text: string, spans: { type: string; start: number; end: number }[]): string {
  let out = text;
  for (const s of [...spans].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, s.start) + `[${s.type}]` + out.slice(s.end);
  }
  return out;
}

function relationOf(raw: string): 'same' | 'overlapping' | 'conflicting' | 'unrelated' {
  const r = (raw || '').toLowerCase();
  if (r.startsWith('same') || r.startsWith('dup')) return 'same';
  if (r.startsWith('conflict')) return 'conflicting';
  if (r.startsWith('overlap')) return 'overlapping';
  return 'unrelated';
}

/**
 * How sure Compare is that two tickets belong together. Measured on the live API:
 * Compare keeps "same" for near-identical text, so two differently worded reports of
 * one fault come back "overlapping" (or "conflicting" when they disagree on a fact),
 * with `related` near 1. A how-to question next to an outage comes back "unrelated",
 * with `related` near 0. So `related` is the merge signal.
 */
function joinProbability(p: { related: number; probabilities?: Record<string, number> }): number {
  if (typeof p.related === 'number') return p.related;
  const pr = p.probabilities;
  return pr && pr.unrelated !== undefined ? 1 - pr.unrelated : 0;
}

function quote(p: { quote: string; start: number; end: number; confidence: number } | undefined): PassageQuote {
  return { quote: p?.quote ?? '', start: p?.start ?? 0, end: p?.end ?? 0, confidence: p?.confidence ?? 0 };
}

function toPrior(t: TicketRecord): PriorTicket {
  return {
    id: t.id,
    at: t.at,
    masked: t.masked ?? '',
    status: t.status,
    incidentId: t.incidentId,
    sent: t.sent,
    facts: t.facts,
  };
}

function tally(values: (string | undefined | null)[]): string[] {
  const seen = new Map<string, { label: string; n: number }>();
  for (const v of values) {
    if (!v) continue;
    const key = v.trim().toLowerCase();
    if (!key) continue;
    const hit = seen.get(key);
    if (hit) hit.n++;
    else seen.set(key, { label: v.trim(), n: 1 });
  }
  return [...seen.values()].sort((a, b) => b.n - a.n).map((x) => x.label);
}

/** Pools members' verbatim Extract values into the incident's summary. Plain counting, no model. */
function refreshIncident(inc: Incident, members: PriorTicket[]) {
  inc.services = tally(members.map((m) => m.facts.service?.value)).slice(0, 3);
  inc.sites = tally(members.map((m) => m.facts.site?.value)).slice(0, 6);
  inc.errors = tally(members.map((m) => m.facts.error?.value)).slice(0, 3);
  if (inc.status !== 'declared') {
    const symptom = members.map((m) => m.facts.symptom?.value).find(Boolean);
    const service = inc.services[0];
    inc.title = service
      ? symptom
        ? `${service}: ${clip(symptom, 56)}`
        : service
      : symptom
        ? clip(symptom, 64)
        : 'Unnamed fault';
  }
}

function representatives(inc: Incident, byId: Map<string, PriorTicket>): PriorTicket[] {
  const ids = inc.memberIds;
  const picks = [ids[0], ids[ids.length - 1], ids[Math.floor(ids.length / 2)]];
  const out: PriorTicket[] = [];
  for (const id of picks) {
    const t = byId.get(id);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= POLICY.representatives) break;
  }
  return out;
}

function kbDocs(kb: KbPassage[]) {
  return kb.map((k) => ({ id: k.id, title: k.title, text: k.text, metadata: { article: k.article, part: k.part } }));
}

function codeIn(text: string): string | null {
  const m = text.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  return m ? m[1].trim() : null;
}

/** Guard reads the passage as retrieved content; Inspect reads any script in it. One pipeline call. */
async function checkPassage(ctx: Ctx, p: PassageChoice, k: KbPassage, incidentId: string) {
  const code = codeIn(k.text);
  const steps: object[] = [
    { injection: { source: 'content', threshold: ctx.P.guardHold, evidence: false }, name: 'guard' },
  ];
  if (code) {
    steps.push({
      script: {
        script: code,
        instructions:
          'This script would be sent to employee laptops as a self-service fix. Restarting a network adapter and flushing DNS are approved. Disabling security tools, downloading and running code, and adding startup entries are not.',
        threshold: ctx.P.scriptBlock,
        evidence: true,
      },
      name: 'inspect',
    });
  }
  const res = await call<PipelineResponse>(
    ctx,
    'pipeline',
    code ? `Check ${k.id} and inspect its script before sending` : `Check ${k.id} before sending`,
    { text: k.text, steps },
    { incidentId, steps: code ? ['injection', 'script'] : ['injection'] },
  );
  const g = stepResult<InjectionResponse>(res, 0);
  const s = code ? stepResult<ScriptResponse>(res, 1) : null;
  p.guard = g ? { injection: g.injection, verdict: g.verdict } : null;
  p.script = s
    ? {
        malicious: s.malicious,
        suspicious: s.suspicious,
        verdict: s.verdict,
        category: s.category,
        severity: s.severity ?? null,
        evidence: (s.evidence ?? []).map((e) => ({ line: e.line, start: e.start, end: e.end, confidence: e.confidence })),
      }
    : null;
  if (!g || (code && !s)) p.blocked = 'unchecked';
  else if (g.injection >= ctx.P.guardHold) p.blocked = 'injection';
  else if (s && s.malicious >= ctx.P.scriptBlock) p.blocked = 'script';
  else p.blocked = null;
}

function toChoices(rr: RerankResponse, kb: KbPassage[]): PassageChoice[] {
  const byId = new Map(kb.map((k) => [k.id, k]));
  return rr.results.map((r) => {
    const k = (r.id && byId.get(r.id)) || kb[r.index];
    return {
      id: k.id,
      title: k.title,
      action: r.action,
      reason: r.action === 'skip' ? r.reason : null,
      relevance: r.relevance_score,
      levels: r.levels as unknown as Record<string, number>,
      selected: false,
    };
  });
}

function toVerification(draft: string, g: GroundingResponse, claimSupport: number): Verification {
  const claims: Claim[] = g.claims.map((c) => {
    const derived =
      c.supported >= c.contradicted && c.supported >= c.not_stated
        ? 'supported'
        : c.contradicted >= c.not_stated
          ? 'contradicted'
          : 'not_stated';
    return {
      claim: c.claim,
      verdict: (c.verdict || derived).toLowerCase(),
      supported: c.supported,
      contradicted: c.contradicted,
      notStated: c.not_stated,
      counted: c.counted,
      source: c.source ?? c.evidence?.document ?? null,
      quote: c.evidence?.quote ?? null,
    };
  });
  const counted = claims.filter((c) => c.counted);
  const sendable = counted.length > 0 && counted.every((c) => c.supported >= claimSupport);
  return {
    draft,
    grounded: g.grounded,
    verdict: g.verdict,
    threshold: g.threshold,
    answersQuestion: g.answers_question ?? null,
    claims,
    sendable,
  };
}

/** Verify: check a broadcast draft claim by claim against the reports and the passage it cites. */
export async function verifyDraft(
  api: Api,
  args: { draft: string; members: { id: string; masked: string }[]; passages: KbPassage[]; incidentId: string; at: number; policy?: PolicyOverrides },
): Promise<{ verification: Verification | null; calls: CallLog[] }> {
  const ctx: Ctx = { api, calls: [], at: args.at, seq: 0, ticketId: null, P: resolvePolicy(args.policy) };
  const verification = await verifyWith(ctx, args);
  return { verification, calls: ctx.calls };
}

async function verifyWith(
  ctx: Ctx,
  args: { draft: string; members: { id: string; masked: string }[]; passages: KbPassage[]; incidentId: string },
): Promise<Verification | null> {
  const documents = [
    ...args.members.slice(0, 16).map((m) => ({ id: m.id, text: m.masked })),
    ...args.passages.map((k) => ({ id: k.id, text: `${k.title}\n${k.text}` })),
  ];
  const g = await call<GroundingResponse>(
    ctx,
    'grounding',
    'Check the broadcast claim by claim against the reports',
    {
      documents,
      answer: clip(args.draft, 4000),
      question: VERIFY_QUESTION,
      evidence: 'all',
      threshold: ctx.P.claimSupport,
    },
    { incidentId: args.incidentId },
  );
  return g ? toVerification(args.draft, g, ctx.P.claimSupport) : null;
}

function composeDraft(f: Record<string, DraftField>, inc: Incident): string {
  const service = f.service?.value || inc.services[0] || 'A shared service';
  const error = f.error?.value;
  const who = f.who?.value;
  const started = f.started?.value;
  const action = f.action?.value;
  const parts = [
    `${service} is failing${error ? ` with error ${error}` : ''}${who ? ` for ${who.replace(/[.\s]+$/, '')}` : ''}.`,
    started ? `Reports began around ${started.replace(/^(about|around|roughly)\s+/i, '')}.` : '',
    action ? action.trim() : '',
  ];
  return parts.filter(Boolean).join(' ');
}

/**
 * What happens the moment an incident is declared: find the workaround (Rerank),
 * check it is safe to send (Guard + Inspect), draft the broadcast (Fill) and
 * check the draft against the reports (Verify).
 */
async function respond(ctx: Ctx, inc: Incident, members: PriorTicket[], kb: KbPassage[]): Promise<IncidentResponse> {
  const response: IncidentResponse = { at: ctx.at, passages: [], reply: null, draftFields: {}, verification: null, error: null };
  const kbById = new Map(kb.map((k) => [k.id, k]));
  const query = clip(
    `${inc.title}. ${members.length} employees report it${inc.sites.length ? ` from ${inc.sites.slice(0, 4).join(', ')}` : ''}. One report: "${members[0]?.masked ?? ''}"`,
    3800,
  );
  const rr = await call<RerankResponse>(
    ctx,
    'rerank',
    'Find the workaround in the knowledge base',
    {
      query,
      documents: kbDocs(kb),
      instructions: KB_INSTRUCTIONS,
      context: { service: inc.services[0] ?? null, sites: inc.sites, reports: members.length },
    },
    { incidentId: inc.id },
  );
  if (!rr) {
    response.error = 'Rerank did not answer, so no workaround was chosen. Nothing was sent.';
    return response;
  }
  response.passages = toChoices(rr, kb);

  // Queue: passages Rerank says to use, plus the neighbour of any "expand" passage.
  const queue: PassageChoice[] = [];
  for (const p of response.passages) {
    if (queue.length >= 3) break;
    if (p.action === 'use') queue.push(p);
    else if (p.action === 'expand') {
      const k = kbById.get(p.id)!;
      const neighbour = kb.find((x) => x.article === k.article && x.part === k.part + 1) ?? kb.find((x) => x.article === k.article && x.part === k.part - 1);
      const n = neighbour && response.passages.find((x) => x.id === neighbour.id);
      if (n && !queue.includes(n)) {
        n.expandedFrom = p.id;
        queue.push(n);
      }
    }
  }
  const chosen: PassageChoice[] = [];
  for (const p of queue) {
    await checkPassage(ctx, p, kbById.get(p.id)!, inc.id);
    if (!p.blocked && chosen.length < 2) {
      p.selected = true;
      chosen.push(p);
    }
  }
  if (!chosen.length) {
    response.error = queue.length
      ? 'Every candidate workaround failed its safety check. Nothing was sent; write the reply by hand.'
      : 'No knowledge base passage answers this fault. Nothing was sent; write the reply by hand.';
    return response;
  }
  const passages = chosen.map((p) => kbById.get(p.id)!);
  response.reply = { passageIds: passages.map((k) => k.id), text: passages.map((k) => k.text).join('\n\n') };

  const digest = [
    'REPORTS FROM EMPLOYEES',
    ...members.slice(0, 12).map((m) => `- ${m.masked}`),
    '',
    'KNOWLEDGE BASE PASSAGE',
    ...passages.map((k) => k.text),
  ].join('\n');
  const fill = await call<FillResponse>(
    ctx,
    'fill',
    'Draft the broadcast as one typed record',
    {
      text: clip(digest, 12000),
      fields: DRAFT_FIELDS,
      instructions:
        'You are filling a status notice for employees about one IT fault. Use only what the reports and the knowledge base passage say.',
    },
    { incidentId: inc.id },
  );
  if (!fill) {
    response.error = 'Fill did not answer, so there is no draft. The workaround above is checked and can still be sent.';
    return response;
  }
  for (const [name, f] of Object.entries(fill.fields)) {
    response.draftFields[name] = {
      value: f.value === null || f.value === undefined ? null : String(f.value),
      source: f.source ?? (f.start !== undefined ? 'extracted' : null),
      probabilities: f.probabilities,
    };
  }
  const draft = composeDraft(response.draftFields, inc);
  response.verification = await verifyWith(ctx, { draft, members, passages, incidentId: inc.id });
  if (!response.verification) {
    response.verification = { draft, grounded: 0, verdict: 'unchecked', threshold: ctx.P.claimSupport, answersQuestion: null, claims: [], sendable: false };
    response.error = 'Verify did not answer, so the draft is unchecked and cannot be sent as it is.';
  }
  return response;
}

/**
 * A reply to one reporter. Fill writes two sentences from that person's own ticket and
 * the checked workaround; Verify then checks the reply against the same two sources,
 * and it is only sendable when every claim is supported.
 */
export async function personalReply(
  api: Api,
  args: { ticket: { id: string; masked: string }; passages: KbPassage[]; incidentId: string; at: number; policy?: PolicyOverrides },
): Promise<{ reply: PersonalReply; calls: CallLog[] }> {
  const ctx: Ctx = { api, calls: [], at: args.at, seq: 0, ticketId: args.ticket.id, P: resolvePolicy(args.policy) };
  const reply: PersonalReply = { ticketId: args.ticket.id, text: '', passageIds: args.passages.map((k) => k.id), verification: null, error: null };
  if (!args.passages.length) {
    reply.error = 'There is no checked workaround for this incident yet, so there is nothing to reply with.';
    return { reply, calls: ctx.calls };
  }
  const text = ["THIS EMPLOYEE'S TICKET", args.ticket.masked, '', 'KNOWLEDGE BASE PASSAGE', ...args.passages.map((k) => k.text)].join('\n');
  const fill = await call<FillResponse>(ctx, 'fill', `Draft a personal reply to ${args.ticket.id}`, { text: clip(text, 12000), fields: REPLY_FIELDS, instructions: REPLY_INSTRUCTIONS }, { incidentId: args.incidentId });
  const part = (name: string) => {
    const v = fill?.fields?.[name]?.value;
    return v === null || v === undefined ? '' : String(v).trim();
  };
  reply.text = [part('acknowledgement'), part('step')].filter(Boolean).join(' ');
  if (!fill || !reply.text) {
    reply.error = 'Fill did not return a draft, so there is no reply. Write this one by hand.';
    return { reply, calls: ctx.calls };
  }
  const g = await call<GroundingResponse>(
    ctx,
    'grounding',
    `Check the reply to ${args.ticket.id} against their ticket and the workaround`,
    {
      documents: [{ id: args.ticket.id, text: args.ticket.masked }, ...args.passages.map((k) => ({ id: k.id, text: `${k.title}\n${k.text}` }))],
      answer: clip(reply.text, 4000),
      evidence: 'all',
      threshold: ctx.P.claimSupport,
    },
    { incidentId: args.incidentId },
  );
  if (g) reply.verification = toVerification(reply.text, g, ctx.P.claimSupport);
  else reply.error = 'Verify did not answer, so this reply is unchecked and cannot be sent as it is.';
  return { reply, calls: ctx.calls };
}

/** Declares an incident by hand (the manager pressed Declare) and prepares the response. */
export async function declareByManager(
  api: Api,
  args: { incident: Incident; members: PriorTicket[]; kb: KbPassage[]; at: number; policy?: PolicyOverrides },
): Promise<{ incident: Incident; calls: CallLog[] }> {
  const ctx: Ctx = { api, calls: [], at: args.at, seq: 0, ticketId: null, P: resolvePolicy(args.policy) };
  const inc: Incident = structuredClone(args.incident);
  inc.status = 'declared';
  inc.declaredAt = args.at;
  inc.declaredBy = 'manager';
  inc.reason = 'Declared by the incident manager.';
  inc.response = await respond(ctx, inc, args.members, args.kb);
  return { incident: inc, calls: ctx.calls };
}

/** Sizes an incident up with Decide and applies the declare policy. Returns true when it was just declared. */
async function sizeUp(ctx: Ctx, inc: Incident, members: PriorTicket[]): Promise<boolean> {
  const first = Math.min(...members.map((m) => m.at));
  const state = {
    service: inc.services[0] ?? 'unknown',
    reports: members.length,
    sites_named: inc.sites,
    minutes_since_first_report: Math.round(((ctx.at - first) / 60) * 10) / 10,
    reports_in_last_five_minutes: members.filter((m) => ctx.at - m.at <= 300).length,
    sample_reports: members.slice(-4).map((m) => clip(m.masked, 320)),
  };
  const d = await call<DecideResponse>(
    ctx,
    'decide',
    `Size up ${inc.id} at ${members.length} reports`,
    { state, questions: DECIDE_QUESTIONS, instructions: DECIDE_INSTRUCTIONS },
    { incidentId: inc.id },
  );
  if (!d) {
    inc.status = 'review';
    inc.reason = 'Decide did not answer, so Squall cannot size this up. An incident manager should look.';
    return false;
  }
  const a = d.answers as Record<string, any>;
  const decision: Decision = {
    at: ctx.at,
    size: members.length,
    pMajor: a.major?.noul ?? 0,
    scope: a.scope ? { choice: a.scope.choice, probabilities: a.scope.probabilities ?? {} } : null,
    severity: a.severity ? { score: a.severity.score, probabilities: a.severity.probabilities ?? {}, legend: a.severity.legend ?? {} } : null,
  };
  inc.decisions.push(decision);
  const p = decision.pMajor;
  if (p >= ctx.P.autoDeclare && inc.conflicts.length === 0) {
    inc.status = 'declared';
    inc.declaredAt = ctx.at;
    inc.declaredBy = 'policy';
    inc.reason = `Declared automatically: Decide put a major incident at ${pct(p)}, at or above the ${pct(ctx.P.autoDeclare)} line.`;
    return true;
  }
  if (p >= ctx.P.autoDeclare) {
    inc.status = 'review';
    inc.reason = `Decide put a major incident at ${pct(p)}, but reports disagree on a fact, so a person decides.`;
  } else if (p >= ctx.P.askManager) {
    inc.status = 'review';
    inc.reason = `Decide put a major incident at ${pct(p)}: above ${pct(ctx.P.askManager)}, below the ${pct(ctx.P.autoDeclare)} line for declaring without a person.`;
  } else {
    inc.status = 'watching';
    inc.reason = `Decide put a major incident at ${pct(p)}, below ${pct(ctx.P.askManager)}. Squall keeps watching.`;
  }
  return false;
}

/**
 * One ticket through the whole engine. Pure with respect to its input: the caller
 * owns the state and passes in what earlier tickets and incidents look like.
 */
export async function step(input: StepInput, api: Api, kb: KbPassage[]): Promise<StepOutput> {
  const raw = input.ticket;
  const ctx: Ctx = { api, calls: [], at: raw.at, seq: 0, ticketId: raw.id, P: resolvePolicy(input.policy) };
  const incidents: Incident[] = structuredClone(input.incidents);
  const prior: PriorTicket[] = structuredClone(input.prior);
  const byId = new Map(prior.map((p) => [p.id, p]));
  const moved: Update[] = [];
  const t: TicketRecord = {
    ...raw,
    status: 'unscreened',
    masked: null,
    pii: [],
    piiCounts: {},
    guard: null,
    facts: {},
    candidates: [],
    pairs: [],
    incidentId: null,
    outcome: '',
    sent: [],
    followUp: null,
  };
  const done = (): StepOutput => ({ ticket: t, incidents, moved, calls: ctx.calls });

  // 1. Protect, then Guard: one pipeline call, one debit. Nothing else reads the ticket first.
  const screen = await call<PipelineResponse>(
    ctx,
    'pipeline',
    'Mask personal data and screen for injection',
    {
      text: clip(raw.text, 20000),
      steps: [
        { pii: { entities: PII_ENTITIES, anonymize: 'replace' }, name: 'protect' },
        { injection: { source: 'user', instructions: GUARD_CONTEXT, threshold: ctx.P.guardHold, evidence: true }, name: 'guard' },
      ],
    },
    { steps: ['pii', 'injection'] },
  );
  const pii = stepResult<PiiResponse>(screen, 0);
  const guard = stepResult<InjectionResponse>(screen, 1);
  if (!pii || !guard) {
    t.outcome = `${!pii ? 'Protect' : 'Guard'} did not answer, so this ticket was not read any further and was not grouped. Triage it by hand.`;
    return done();
  }
  t.pii = pii.entities.map((e) => ({ type: e.type, start: e.start, end: e.end, confidence: e.confidence }));
  t.piiCounts = pii.counts ?? {};
  t.masked = pii.anonymized_text ?? (pii.entities.length ? maskFromSpans(raw.text, pii.entities) : raw.text);
  t.guard = {
    injection: guard.injection,
    verdict: guard.verdict,
    threshold: guard.threshold,
    category: guard.category,
    severity: guard.severity ?? null,
    evidence: (guard.evidence ?? []).map((e) => ({ quote: e.quote, start: e.start, end: e.end, confidence: e.confidence })),
  };
  if (guard.injection >= ctx.P.guardHold) {
    t.status = 'held';
    t.outcome = `Held: Guard put prompt injection at ${pct(guard.injection)}. The ticket was not grouped and cannot move an incident. A person should read it.`;
    return done();
  }
  t.status = 'alone';
  const masked = clip(t.masked, 3800);

  // 2. Extract the facts, and in the same request ask Rerank which open incident or lone ticket this could belong to.
  // A reply in a thread belongs to that thread's incident. That is bookkeeping, so no model is asked.
  const origin = raw.thread ? byId.get(raw.thread) : undefined;
  const threadInc = origin?.incidentId ? incidents.find((i) => i.id === origin.incidentId && i.status !== 'dismissed') : undefined;
  const open = incidents.filter((i) => i.status !== 'dismissed');
  const lone = prior.filter((p) => p.status === 'alone').slice(-POLICY.loneWindow);
  const docs = threadInc ? [] : [
    ...open.map((i) => ({
      id: i.id,
      title: i.title,
      text: representatives(i, byId)
        .map((r, n) => `Report ${n + 1}: ${clip(r.masked, 600)}`)
        .join('\n'),
      metadata: { reports: i.memberIds.length, sites: i.sites.slice(0, 4).join(', ') || 'not stated' },
    })),
    ...lone.map((p) => ({ id: p.id, text: clip(p.masked, 800) })),
  ];
  const steps: object[] = [{ extract: { fields: EXTRACT_FIELDS }, name: 'extract' }];
  if (docs.length) steps.push({ rerank: { query: masked, documents: docs, instructions: MATCH_INSTRUCTIONS }, name: 'match' });
  const read = await call<PipelineResponse>(
    ctx,
    'pipeline',
    docs.length ? 'Extract the facts and shortlist matching incidents' : 'Extract the facts',
    { text: masked, steps },
    { steps: docs.length ? ['extract', 'rerank'] : ['extract'] },
  );
  const ex = stepResult<ExtractResponse>(read, 0);
  if (ex) {
    for (const [name, f] of Object.entries(ex.fields)) {
      const value = Array.isArray(f.value) ? f.value[0] : f.value;
      t.facts[name] = value ? ({ value, start: f.start ?? -1, end: f.end ?? -1, confidence: f.confidence ?? null } as Fact) : null;
    }
  }
  const rr = docs.length ? stepResult<RerankResponse>(read, 1) : null;
  if (docs.length && !rr) {
    t.outcome = 'Rerank did not answer, so Squall could not look for a matching incident. The ticket stays on its own and was not merged.';
    return done();
  }
  if (rr) {
    t.candidates = rr.results.map((r): Candidate => {
      const id = r.id ?? docs[r.index].id;
      return {
        id,
        kind: id.startsWith('INC-') ? 'incident' : 'ticket',
        action: r.action,
        reason: r.action === 'skip' ? r.reason : null,
        relevance: r.relevance_score,
        levels: r.levels as unknown as Record<string, number>,
      };
    });
  }
  const findIncident = async (): Promise<{ inc: Incident; why: string } | null> => {
    const shortlist = t.candidates.filter((c) => c.action !== 'skip' && c.relevance >= POLICY.candidateFloor).slice(0, POLICY.maxCompared);
    if (!shortlist.length) {
      const near = t.candidates[0];
      t.outcome = !t.candidates.length
        ? 'First of its kind: nothing is open to compare it with.'
        : near?.reason === 'different_case'
          ? `On its own. Rerank read ${near.id} as the same topic but a different case.`
          : 'On its own. No open incident or earlier ticket reports the same fault.';
      return null;
    }

    // 3. Compare the ticket with the shortlisted reports. This is the decision to merge.
    const others: PriorTicket[] = [];
    for (const c of shortlist) {
      const picks = c.kind === 'incident' ? representatives(incidents.find((i) => i.id === c.id)!, byId) : [byId.get(c.id)!];
      for (const p of picks) if (p && !others.includes(p)) others.push(p);
    }
    const cmp = await call<CompareResponse>(ctx, 'compare', `Compare with ${shortlist.map((c) => c.id).join(' and ')}`, {
      documents: [{ id: t.id, text: masked }, ...others.map((o) => ({ id: o.id, text: clip(o.masked, 3800) }))],
      instructions: COMPARE_INSTRUCTIONS,
      evidence: 'all',
    });
    if (!cmp) {
      t.outcome = 'Compare did not answer, so this ticket was not merged into anything. It stays on its own until someone looks.';
      return null;
    }
    for (const p of cmp.pairs) {
      if (p.a !== t.id && p.b !== t.id) continue;
      const mine = p.a === t.id;
      const otherId = mine ? p.b : p.a;
      // The API returns `duplicates` and `conflicts` as lists per pair; older shapes had one object.
      type Finding = NonNullable<typeof p.duplicate>;
      const lists = p as unknown as { duplicates?: Finding[]; conflicts?: Finding[] };
      const strongest = (one: Finding | null | undefined, many: Finding[] | undefined) =>
        one ?? [...(many ?? [])].sort((x, y) => y.confidence - x.confidence)[0] ?? null;
      const orient = (f: Finding | null) =>
        f ? { kind: f.kind, confidence: f.confidence, a: quote(mine ? f.a : f.b), b: quote(mine ? f.b : f.a) } : null;
      t.pairs.push({
        with: otherId,
        incidentId: byId.get(otherId)?.incidentId ?? null,
        relation: relationOf(p.relation),
        related: p.related,
        probabilities: p.probabilities ?? {},
        duplicate: orient(strongest(p.duplicate, lists.duplicates)),
        conflict: orient(strongest(p.conflict, lists.conflicts)),
      } satisfies PairResult);
    }
    const joinable = t.pairs
      .filter((p) => p.relation !== 'unrelated' && joinProbability(p) >= POLICY.joinRelated)
      .sort((a, b) => joinProbability(b) - joinProbability(a));
    if (!joinable.length) {
      const best = [...t.pairs].sort((a, b) => b.related - a.related)[0];
      t.outcome = best
        ? `On its own. Rerank shortlisted ${shortlist[0].id}, but Compare read ${best.with} as ${best.relation} (${pct(joinProbability(best))} related).`
        : 'On its own. Compare returned no pair for this ticket.';
      return null;
    }

    // 4. Merge: into the incident the best match belongs to, or start one with a lone ticket.
    const best = joinable[0];
    let found = best.incidentId ? incidents.find((i) => i.id === best.incidentId) : undefined;
    if (!found) {
      const other = byId.get(best.with)!;
      found = {
        id: `INC-${incidents.length + 1}`,
        createdAt: raw.at,
        title: 'Unnamed fault',
        memberIds: [other.id],
        services: [],
        sites: [],
        errors: [],
        conflicts: [],
        decisions: [],
        status: 'watching',
        declaredAt: null,
        declaredBy: null,
        reason: 'Two reports of the same fault. Squall sizes an incident up from three.',
        response: null,
      };
      incidents.push(found);
      other.incidentId = found.id;
      other.status = 'joined';
      moved.push({ id: other.id, incidentId: found.id, outcome: `Grouped with ${t.id}: Compare read them as the same fault.`, sent: other.sent });
    }
    const tail = best.relation === 'conflicting' ? ', with a disagreement' : '';
    return { inc: found, why: `Compare read it as the same fault as ${best.with}${tail} (${pct(joinProbability(best))} related).` };
  };
  const hit = threadInc
    ? { inc: threadInc, why: `it is a reply in ${origin!.id}'s thread.` }
    : await findIncident();
  if (!hit) return done();
  const inc = hit.inc;
  inc.memberIds.push(t.id);
  t.incidentId = inc.id;
  t.status = 'joined';
  t.outcome = `Joined ${inc.id}: ${hit.why}`;
  for (const p of t.pairs) {
    if (!p.conflict || p.conflict.confidence < POLICY.conflictFloor) continue;
    if (byId.get(p.with)?.incidentId !== inc.id) continue;
    if (inc.conflicts.some((c) => (c.a === t.id && c.b === p.with) || (c.a === p.with && c.b === t.id))) continue;
    inc.conflicts.push({ a: t.id, b: p.with, kind: p.conflict.kind, confidence: p.conflict.confidence, aQuote: p.conflict.a.quote, bQuote: p.conflict.b.quote });
  }
  const self = toPrior(t);
  byId.set(t.id, self);
  const members = inc.memberIds.map((id) => byId.get(id)).filter(Boolean) as PriorTicket[];
  refreshIncident(inc, members);

  // 5. Size it up with Decide; the declare policy is plain code in lib/policy.ts.
  let justDeclared = false;
  if ((inc.status === 'watching' || inc.status === 'review') && members.length >= POLICY.decideFrom) {
    justDeclared = await sizeUp(ctx, inc, members);
  }
  if (justDeclared) {
    inc.response = await respond(ctx, inc, members, kb);
    if (inc.response.reply) {
      for (const m of members) {
        if (m.id === t.id) t.sent = inc.response.reply.passageIds;
        else moved.push({ id: m.id, incidentId: inc.id, outcome: '+The checked workaround was sent when the incident was declared.', sent: inc.response.reply.passageIds });
      }
    }
    return done();
  }

  // 6. Replies for tickets that join an incident that already has a checked workaround.
  const reply = inc.status === 'declared' ? inc.response?.reply : null;
  if (reply) {
    if (origin && origin.sent.length) {
      // The same person is writing again. Rerank reads the thread so it does not repeat itself.
      const kbById = new Map(kb.map((k) => [k.id, k]));
      const given = origin.sent.map((id) => kbById.get(id)?.text ?? '').join('\n\n');
      const fr = await call<RerankResponse>(
        ctx,
        'rerank',
        'Pick the next step for a follow-up, without repeating what was sent',
        {
          query: masked,
          conversation: [
            { role: 'user', content: clip(origin.masked, 3000) },
            { role: 'assistant', content: clip(given, 6000) },
          ],
          documents: kbDocs(kb),
          instructions: KB_INSTRUCTIONS,
        },
        { incidentId: inc.id },
      );
      if (fr) {
        t.followUp = toChoices(fr, kb);
        const next = t.followUp.find((p) => p.action === 'use' && !origin.sent.includes(p.id));
        if (next) {
          await checkPassage(ctx, next, kbById.get(next.id)!, inc.id);
          if (!next.blocked) {
            next.selected = true;
            t.sent = [...origin.sent, next.id];
            const skipped = t.followUp.filter((p) => p.reason === 'already_given').map((p) => p.id);
            t.outcome += ` Follow-up: ${skipped.length ? `${skipped.join(', ')} already given, so ` : ''}${next.id} goes out next.`;
          } else {
            t.sent = origin.sent;
            t.outcome += ` Follow-up: ${next.id} failed its safety check, so nothing new was sent. A person should reply.`;
          }
        } else {
          t.sent = origin.sent;
          t.outcome += ' Follow-up: the knowledge base has nothing new for this person. A person should reply.';
        }
      } else {
        t.sent = origin.sent;
        t.outcome += ' Follow-up: Rerank did not answer, so nothing new was sent.';
      }
    } else {
      t.sent = reply.passageIds;
      t.outcome += ' The checked workaround was sent.';
    }
  }
  return done();
}

export { toPrior };
