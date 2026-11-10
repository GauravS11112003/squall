/** Shared shapes. Everything that crosses the wire between browser and server is defined here. */

export type Endpoint =
  | 'decide'
  | 'extract'
  | 'fill'
  | 'pii'
  | 'injection'
  | 'script'
  | 'grounding'
  | 'compare'
  | 'rerank'
  | 'pipeline';

export type Mode = 'live' | 'replay' | 'sim';

export type RawTicket = {
  id: string;
  /** Seconds after the storm starts. */
  at: number;
  from: string;
  channel: 'email' | 'chat' | 'portal';
  text: string;
  /** Id of the ticket this one follows up on, when the same person writes again. */
  thread?: string;
};

export type Span = { start: number; end: number };

export type Fact = { value: string; start: number; end: number; confidence: number | null };

export type PiiFinding = { type: string; start: number; end: number; confidence: number };

export type GuardResult = {
  injection: number;
  verdict: string;
  threshold: number;
  category: string;
  severity: string | null;
  evidence: { quote: string; start: number; end: number; confidence: number }[];
};

/** One Rerank result for a candidate incident or earlier ticket. */
export type Candidate = {
  id: string;
  kind: 'incident' | 'ticket';
  action: 'use' | 'expand' | 'skip';
  reason: string | null;
  relevance: number;
  levels: Record<string, number>;
};

export type PassageQuote = { quote: string; start: number; end: number; confidence: number };

/** One Compare pair between the new ticket and an earlier one. */
export type PairResult = {
  with: string;
  /** Incident the other ticket belongs to, if any. */
  incidentId: string | null;
  relation: string;
  related: number;
  probabilities: Record<string, number>;
  duplicate: { kind: string; confidence: number; a: PassageQuote; b: PassageQuote } | null;
  conflict: { kind: string; confidence: number; a: PassageQuote; b: PassageQuote } | null;
};

export type TicketStatus =
  | 'held' // Guard flagged it; never clustered
  | 'unscreened' // Protect or Guard failed; never clustered
  | 'alone' // screened, no matching incident
  | 'joined'; // member of an incident

export type TicketRecord = RawTicket & {
  status: TicketStatus;
  /** Text after Protect. Everything downstream reads this, never `text`. */
  masked: string | null;
  pii: PiiFinding[];
  piiCounts: Record<string, number>;
  guard: GuardResult | null;
  facts: Record<string, Fact | null>;
  candidates: Candidate[];
  pairs: PairResult[];
  incidentId: string | null;
  /** Why the ticket ended where it did, in one plain sentence. */
  outcome: string;
  /** Knowledge-base passage ids sent to this reporter so far. */
  sent: string[];
  /** Rerank results for a follow-up in a thread (shows already_given). */
  followUp: PassageChoice[] | null;
};

export type Conflict = {
  a: string;
  b: string;
  kind: string;
  confidence: number;
  aQuote: string;
  bQuote: string;
};

export type Decision = {
  at: number;
  size: number;
  pMajor: number;
  scope: { choice: string; probabilities: Record<string, number> } | null;
  severity: { score: number; probabilities: Record<string, number>; legend: Record<string, string> } | null;
};

export type IncidentStatus = 'watching' | 'review' | 'declared' | 'dismissed';

export type PassageChoice = {
  id: string;
  title: string;
  action: 'use' | 'expand' | 'skip';
  reason: string | null;
  relevance: number;
  levels: Record<string, number>;
  selected: boolean;
  /** Set when the passage was pulled in because a neighbour came back as "expand". */
  expandedFrom?: string;
  guard?: { injection: number; verdict: string } | null;
  script?: {
    malicious: number;
    suspicious: number;
    verdict: string;
    category: string;
    severity: string | null;
    evidence: { line: string; start: number; end: number; confidence: number }[];
  } | null;
  blocked?: 'script' | 'injection' | 'unchecked' | null;
};

export type Claim = {
  claim: string;
  verdict: string;
  supported: number;
  contradicted: number;
  notStated: number;
  counted: boolean;
  source: string | null;
  quote: string | null;
};

export type Verification = {
  draft: string;
  grounded: number;
  verdict: string;
  threshold: number;
  answersQuestion: number | null;
  claims: Claim[];
  /** True when every counted claim is supported: the broadcast may be sent. */
  sendable: boolean;
};

export type DraftField = { value: string | null; source: string | null; probabilities?: Record<string, number> };

export type IncidentResponse = {
  at: number;
  passages: PassageChoice[];
  /** The checked workaround that goes to affected reporters. */
  reply: { passageIds: string[]; text: string } | null;
  draftFields: Record<string, DraftField>;
  verification: Verification | null;
  error: string | null;
};

export type Incident = {
  id: string;
  createdAt: number;
  title: string;
  memberIds: string[];
  /** Verbatim values pooled from members' Extract results. */
  services: string[];
  sites: string[];
  errors: string[];
  conflicts: Conflict[];
  decisions: Decision[];
  status: IncidentStatus;
  declaredAt: number | null;
  declaredBy: 'policy' | 'manager' | null;
  /** Why the incident is in its current status. */
  reason: string;
  response: IncidentResponse | null;
};

export type CallLog = {
  id: string;
  /** Storm time (seconds) the call belongs to. */
  at: number;
  endpoint: Endpoint;
  /** Endpoints run inside a pipeline call. */
  steps?: string[];
  label: string;
  ticketId: string | null;
  incidentId: string | null;
  ok: boolean;
  error: string | null;
  /** Round trip measured by this server. */
  ms: number;
  /** Model time reported by Clocked (X-Clocked-Model-Ms). */
  modelMs: number | null;
  /** Credits reported by Clocked (X-Clocked-Credits). */
  credits: number | null;
  costUsd: number | null;
};

/** What the engine needs to know about earlier tickets. Never contains unmasked text. */
export type PriorTicket = {
  id: string;
  at: number;
  masked: string;
  status: TicketStatus;
  incidentId: string | null;
  sent: string[];
  facts: Record<string, Fact | null>;
};

export type StepInput = {
  /** Policy lines the manager has moved. Missing keys use the defaults in lib/policy.ts. */
  policy?: import('./policy').PolicyOverrides;
  ticket: RawTicket;
  incidents: Incident[];
  prior: PriorTicket[];
};

export type StepOutput = {
  ticket: TicketRecord;
  incidents: Incident[];
  /** Earlier tickets whose incident changed in this step (a lone ticket that now has company). */
  /** `outcome` replaces the ticket's outcome, or is appended to it when it starts with "+". */
  moved: { id: string; incidentId: string; outcome: string; sent: string[] }[];
  calls: CallLog[];
};

export type Recording = {
  meta: {
    mode: 'live' | 'sim';
    recordedAt: string;
    sdk: string;
    note: string;
  };
  steps: StepOutput[];
  /** What declaring by hand produced for incidents the policy left to a person. */
  actions: { incidentId: string; incident: Incident; calls: CallLog[] }[];
};

export type KbPassage = {
  id: string;
  article: string;
  part: number;
  title: string;
  text: string;
};
