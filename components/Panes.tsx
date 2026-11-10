'use client';

import { useEffect, useMemo, useState } from 'react';
import { KB_BY_ID } from '@/data/kb';
import { STORM } from '@/data/storm';
import { baseline, costOf, score } from '@/lib/metrics';
import { POLICY } from '@/lib/policy';
import type { CallLog, Incident, Mode, PassageChoice, RawTicket, TicketRecord, Verification } from '@/lib/types';
import { Icon, STATUS_WORD, TICKET_WORD, clock, incidentTone, label, locate, marked, maskTokens, ms, pct, ticketTone } from '@/lib/ui';
import type { MarkSpec } from '@/lib/ui';

type Select = (s: { kind: 'incident' | 'ticket'; id: string } | null) => void;

/* ---------------------------------------------------------------- feed */

export function Feed(props: {
  tickets: TicketRecord[];
  pending: RawTicket | null;
  incidents: Incident[];
  selectedId: string | null;
  onSelect: Select;
  canFile: boolean;
  busy: boolean;
  onFile: (text: string) => void;
  total: number;
}) {
  const [text, setText] = useState('');
  const rows = useMemo(() => [...props.tickets].reverse(), [props.tickets]);
  return (
    <section className="pane left" aria-label="Incoming tickets">
      <div className="pane-head">
        <h2>Incoming tickets</h2>
        <small>
          {props.tickets.length} of {props.total} read
        </small>
      </div>
      <div className="scroll">
        <ul className="feed">
          {props.pending && (
            <li>
              <div className="row pending enter">
                <span className="dot tone-mute" />
                <div>
                  <div className="meta">
                    <b>{props.pending.id}</b>
                    <span>{clock(props.pending.at)}</span>
                    <span className="tag tone-mute">Clocked is reading</span>
                  </div>
                  <p>{props.pending.from}</p>
                </div>
              </div>
            </li>
          )}
          {rows.map((t) => {
            const tone = ticketTone(t, props.incidents);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  className="row enter"
                  aria-current={props.selectedId === t.id}
                  onClick={() => props.onSelect({ kind: 'ticket', id: t.id })}
                >
                  <span className={`dot tone-${tone} ${t.status === 'held' || t.status === 'unscreened' ? 'hollow' : ''}`} />
                  <div>
                    <div className="meta">
                      <b>{t.id}</b>
                      <span>{clock(t.at)}</span>
                      <span className={`tag tone-${tone}`}>{t.status === 'joined' ? t.incidentId : TICKET_WORD[t.status]}</span>
                    </div>
                    <p>{t.masked ?? 'Not read: the safety screen did not answer.'}</p>
                  </div>
                </button>
              </li>
            );
          })}
          {!rows.length && !props.pending && (
            <li>
              <div className="empty">
                <b>No tickets yet</b>
                <span>Start the storm and tickets appear here as they are filed, newest first. Personal data is masked before anything else reads them.</span>
              </div>
            </li>
          )}
        </ul>
      </div>
      <form
        className="file"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) {
            props.onFile(text.trim());
            setText('');
          }
        }}
      >
        <label htmlFor="file-ticket">File your own ticket into the storm</label>
        <textarea
          id="file-ticket"
          rows={2}
          value={text}
          disabled={!props.canFile}
          onChange={(e) => setText(e.target.value)}
          placeholder={props.canFile ? 'For example: Harbor VPN keeps failing with 809 in Denver' : 'Needs live mode. The recorded run cannot read new tickets.'}
        />
        <div className="actions">
          <button className="btn" type="submit" disabled={!props.canFile || props.busy || !text.trim()}>
            File ticket
          </button>
        </div>
      </form>
    </section>
  );
}

/* ---------------------------------------------------------------- shared bits */

function Bars({ data, top, tone, order }: { data: Record<string, number>; top?: string; tone?: string; order?: string[] }) {
  const keys = order ?? Object.keys(data).sort((a, b) => data[b] - data[a]);
  return (
    <div className={`bars ${tone ? `tone-${tone}` : ''}`}>
      {keys.map((k) => (
        <div key={k} className={`bar-row ${k === top ? 'top' : ''}`}>
          <span>{label(k)}</span>
          <span className="t">
            <i style={{ width: `${Math.max(0, Math.min(1, data[k] ?? 0)) * 100}%` }} />
          </span>
          <em>{pct(data[k] ?? 0)}</em>
        </div>
      ))}
    </div>
  );
}

function Trace({ incident }: { incident: Incident }) {
  const d = incident.decisions;
  if (d.length < 2) return null;
  const W = 400;
  const H = 64;
  const x = (i: number) => 6 + (i / (d.length - 1)) * (W - 12);
  const y = (p: number) => H - 6 - p * (H - 12);
  const path = d.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v.pMajor).toFixed(1)}`).join(' ');
  return (
    <svg className="trace" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Probability of a major incident over ${d.length} readings`}>
      {[POLICY.askManager, POLICY.autoDeclare].map((l) => (
        <line key={l} x1="0" x2={W} y1={y(l)} y2={y(l)} stroke="#8aa2aa" strokeDasharray="3 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ))}
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {d.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v.pMajor)} r="2.6" fill="currentColor" />
      ))}
    </svg>
  );
}

const ACTION_WORD: Record<string, string> = { use: 'Use', expand: 'Right article, other part', skip: 'Skip' };

function Passages({ list }: { list: PassageChoice[] }) {
  const shown = list.filter((p) => p.action !== 'skip' || p.reason !== 'unrelated' || p.selected).slice(0, 7);
  return (
    <ul className="passages">
      {shown.map((p) => {
        const tone = p.blocked ? 'squall' : p.selected ? 'good' : p.action === 'skip' ? 'mute' : 'calm';
        const k = KB_BY_ID[p.id];
        return (
          <li key={p.id} className={p.action === 'skip' && !p.selected ? 'dim' : ''}>
            <div className="line">
              <b>{p.id}</b>
              <span className="ttl" title={p.title}>
                {p.title}
              </span>
              <span className={`verdict tone-${tone}`}>
                {p.blocked === 'script'
                  ? 'Blocked by Inspect'
                  : p.blocked === 'injection'
                    ? 'Blocked by Guard'
                    : p.blocked === 'unchecked'
                      ? 'Not sent: check failed'
                      : p.selected
                        ? 'Sent'
                        : p.action === 'skip'
                          ? `Skip: ${label(p.reason ?? 'unrelated').toLowerCase()}`
                          : ACTION_WORD[p.action]}
              </span>
            </div>
            <div className="note" style={{ marginTop: 0 }}>
              Rerank: {pct(p.relevance)} answers this fault
              {p.expandedFrom ? `, pulled in because ${p.expandedFrom} pointed to another part of the article` : ''}
              {p.guard ? `. Guard: ${pct(p.guard.injection)} injection` : ''}
              {p.script ? `. Inspect: ${pct(p.script.malicious)} malicious${p.script.category && p.script.category !== 'benign' ? ` (${label(p.script.category).toLowerCase()})` : ''}` : ''}
            </div>
            {p.script && p.blocked === 'script' && k && <ScriptEvidence text={k.text} lines={p.script.evidence.map((e) => e.line)} />}
          </li>
        );
      })}
    </ul>
  );
}

function ScriptEvidence({ text, lines }: { text: string; lines: string[] }) {
  const code = /```[a-zA-Z]*\n([\s\S]*?)```/.exec(text)?.[1]?.trim() ?? '';
  const bad = lines.map((l) => l.trim()).filter(Boolean);
  return (
    <pre className="code" aria-label="Script lines behind the verdict">
      {code.split('\n').map((line, i) => {
        const hit = bad.some((b) => line.includes(b) || b.includes(line.trim()));
        return (
          <span key={i}>
            {hit ? <mark>{line}</mark> : line}
            {'\n'}
          </span>
        );
      })}
    </pre>
  );
}

function Claims({ v }: { v: Verification }) {
  return (
    <ul className="claims">
      {v.claims.map((c, i) => {
        const ok = c.supported >= POLICY.claimSupport;
        const tone = !c.counted ? 'mute' : ok ? 'good' : c.verdict.startsWith('contra') ? 'squall' : 'shower';
        return (
          <li key={i} className={`tone-${tone}`}>
            {!c.counted ? Icon.dash : ok ? Icon.check : Icon.cross}
            <div>
              {c.claim}
              <small>
                {!c.counted
                  ? 'Not a factual claim'
                  : ok
                    ? `Supported ${pct(c.supported)}${c.source ? ` by ${c.source}` : ''}${c.quote ? `: “${c.quote.length > 90 ? c.quote.slice(0, 88) + '…' : c.quote}”` : ''}`
                    : c.verdict.startsWith('contra')
                      ? `Contradicted ${pct(c.contradicted)}${c.source ? ` by ${c.source}` : ''}${c.quote ? `: “${c.quote.length > 90 ? c.quote.slice(0, 88) + '…' : c.quote}”` : ''}`
                      : `No report or passage states this (${pct(c.supported)} supported)`}
              </small>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------------------------- incident */

export function IncidentPane(props: {
  incident: Incident;
  tickets: TicketRecord[];
  mode: Mode;
  busy: string | null;
  canAct: boolean;
  sent: { at: number; to: number } | null;
  onSelect: Select;
  onDeclare: () => void;
  onDismiss: () => void;
  onVerify: (draft: string) => Promise<string | null>;
  onSend: () => void;
}) {
  const inc = props.incident;
  const tone = incidentTone(inc);
  const last = inc.decisions[inc.decisions.length - 1];
  const members = props.tickets.filter((t) => t.incidentId === inc.id);
  const v = inc.response?.verification ?? null;
  const [draft, setDraft] = useState(v?.draft ?? '');
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    setDraft(v?.draft ?? '');
    setNote(null);
  }, [inc.id, v?.draft]);
  const edited = v !== null && draft.trim() !== v.draft.trim();

  return (
    <div className="detail">
      <header>
        <div className={`status-line tone-${tone}`}>
          <span className="dot" />
          {STATUS_WORD[inc.status]}
          {inc.declaredAt !== null && inc.status === 'declared' ? ` since ${clock(inc.declaredAt)}` : ''}
        </div>
        <h3>{inc.title}</h3>
        <p className="lede">{inc.reason}</p>
      </header>

      <section className={`gauge tone-${tone}`} aria-label="Probability of a major incident">
        <div className="big">
          <b>{last ? pct(last.pMajor) : inc.memberIds.length}</b>
          <span>
            {last
              ? `major incident, by Decide at ${last.size} reports`
              : `reports so far. Decide sizes an incident up from ${POLICY.decideFrom}.`}
          </span>
        </div>
        <div className="track">
          <i style={{ width: `${(last?.pMajor ?? 0) * 100}%` }} />
          <u style={{ left: `${POLICY.askManager * 100}%` }} />
          <u style={{ left: `${POLICY.autoDeclare * 100}%` }} />
        </div>
        <div className="track-notes">
          <span style={{ left: `${POLICY.askManager * 100}%` }}>ask a person</span>
          <span style={{ left: `${POLICY.autoDeclare * 100}%` }}>declare</span>
        </div>
        <Trace incident={inc} />
      </section>

      {(inc.status === 'review' || inc.status === 'watching') && (
        <div className="actions">
          <button className="btn alarm" type="button" onClick={props.onDeclare} disabled={!props.canAct || props.busy !== null}>
            {props.busy === 'declare' ? 'Preparing the response' : 'Declare major incident'}
          </button>
          <button className="btn quiet" type="button" onClick={props.onDismiss} disabled={props.busy !== null}>
            Dismiss
          </button>
          {!props.canAct && <span className="note">Declaring by hand needs live mode; this recorded run has no answer saved for it.</span>}
        </div>
      )}

      {last && (
        <section className="two">
          {last.scope && (
            <div>
              <h4>How widely it is felt</h4>
              <Bars data={last.scope.probabilities} top={last.scope.choice} tone={tone} order={['one_person', 'one_team', 'one_site', 'several_sites'].filter((k) => k in last.scope!.probabilities)} />
            </div>
          )}
          {last.severity && (
            <div>
              <h4>How badly it stops work</h4>
              <p style={{ fontSize: 13.5 }}>{last.severity.legend[String(Math.round(last.severity.score))] ?? `Level ${last.severity.score.toFixed(1)}`}</p>
              <p className="note">
                Score {last.severity.score.toFixed(1)} on a scale of 0 to {Math.max(1, Object.keys(last.severity.legend).length - 1)}
              </p>
            </div>
          )}
        </section>
      )}

      <section>
        <h4>What the reports say, word for word</h4>
        <dl className="kv">
          <dt>Service</dt>
          <dd>{inc.services.join(', ') || <small>Not named yet</small>}</dd>
          <dt>Error</dt>
          <dd>{inc.errors.join(', ') || <small>None quoted</small>}</dd>
          <dt>Places</dt>
          <dd>{inc.sites.join(', ') || <small>None named</small>}</dd>
        </dl>
      </section>

      {inc.conflicts.length > 0 && (
        <section>
          <h4>Reports that disagree</h4>
          <div style={{ display: 'grid', gap: 8 }}>
            {inc.conflicts.map((c, i) => (
              <div className="split" key={i}>
                <div>
                  <small>
                    <button className="link" type="button" onClick={() => props.onSelect({ kind: 'ticket', id: c.a })}>
                      {c.a}
                    </button>
                  </small>
                  <q>{c.aQuote}</q>
                </div>
                <div>
                  <small>
                    <button className="link" type="button" onClick={() => props.onSelect({ kind: 'ticket', id: c.b })}>
                      {c.b}
                    </button>
                  </small>
                  <q>{c.bQuote}</q>
                </div>
              </div>
            ))}
          </div>
          <p className="note">Compare found these while matching tickets. A disagreement stops Squall declaring on its own, and Verify will not let the broadcast state the disputed fact as settled.</p>
        </section>
      )}

      {inc.response && (
        <>
          <section>
            <h4>Workaround for the people affected</h4>
            {inc.response.passages.length > 0 && <Passages list={inc.response.passages} />}
            {inc.response.error && <p className="note tone-shower" style={{ color: 'var(--shower)' }}>{inc.response.error}</p>}
          </section>

          {v && (
            <section className="field">
              <h4>Broadcast to the company</h4>
              <textarea
                rows={5}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="Broadcast draft"
                readOnly={props.mode === 'replay'}
              />
              <p className="note">
                Drafted by Fill from the reports and the checked passage
                {v.claims.length ? `, then checked by Verify: ${pct(v.grounded)} grounded.` : '.'}
                {props.mode === 'replay' ? ' Editing needs live mode.' : ' Edit it and check again; try adding something the reports do not say.'}
              </p>
              <div style={{ marginTop: 10 }}>
                <Claims v={v} />
              </div>
              {note && <p className="note" style={{ color: 'var(--shower)' }}>{note}</p>}
              <div className="actions" style={{ marginTop: 12 }}>
                {edited ? (
                  <button
                    className="btn primary"
                    type="button"
                    disabled={props.busy !== null || !draft.trim()}
                    onClick={async () => setNote(await props.onVerify(draft))}
                  >
                    {props.busy === 'verify' ? 'Checking each claim' : 'Check the edited draft'}
                  </button>
                ) : props.sent ? (
                  <span className="verdict tone-good">
                    Marked as sent to {props.sent.to} reporters at {clock(props.sent.at)}
                  </span>
                ) : (
                  <button className="btn primary" type="button" disabled={!v.sendable} onClick={props.onSend}>
                    Send broadcast
                  </button>
                )}
                {!edited && !v.sendable && <span className="note" style={{ margin: 0 }}>Sending is blocked until every claim is supported.</span>}
              </div>
              {!edited && v.sendable && !props.sent && (
                <p className="note">This demo has no mail connection. Sending marks the broadcast as sent and nothing leaves the app.</p>
              )}
            </section>
          )}
        </>
      )}

      <section>
        <h4>
          {members.length} reports in this incident
        </h4>
        <ul className="mini">
          {members.map((t) => (
            <li key={t.id}>
              <div className="head">
                <button className="link" type="button" onClick={() => props.onSelect({ kind: 'ticket', id: t.id })}>
                  {t.id}
                </button>
                <span style={{ color: 'var(--chalk-3)' }}>
                  {clock(t.at)}, {t.from}
                </span>
                {t.sent.length > 0 && <span className="verdict tone-good">{t.sent.join(' then ')}</span>}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- ticket */

export function TicketPane(props: { ticket: TicketRecord; incidents: Incident[]; calls: CallLog[]; onSelect: Select }) {
  const t = props.ticket;
  const [original, setOriginal] = useState(false);
  useEffect(() => setOriginal(false), [t.id]);
  const tone = ticketTone(t, props.incidents);
  const text = original || t.masked === null ? t.text : t.masked;
  const marks: MarkSpec[] = [];
  if (original) {
    for (const p of t.pii) marks.push({ start: p.start, end: p.end, cls: 'pii', title: `${label(p.type)}, found by Protect` });
    for (const e of t.guard?.evidence ?? []) {
      const at = locate(t.text, e.quote, e.start, e.end);
      if (at) marks.push({ ...at, cls: 'attack', title: 'Flagged by Guard' });
    }
  } else if (t.masked !== null) {
    marks.push(...maskTokens(t.masked));
    for (const [name, f] of Object.entries(t.facts)) {
      if (!f) continue;
      const at = locate(t.masked, f.value, f.start, f.end);
      if (at) marks.push({ ...at, title: `${label(name)}, quoted by Extract` });
    }
    for (const e of t.guard?.evidence ?? []) {
      const at = locate(t.masked, e.quote, -1, -1);
      if (at) marks.push({ ...at, cls: 'attack', title: 'Flagged by Guard' });
    }
  }
  const facts = Object.entries(t.facts).filter(([, f]) => f);
  const calls = props.calls.filter((c) => c.ticketId === t.id);
  const piiTotal = Object.values(t.piiCounts).reduce((a, b) => a + b, 0) || t.pii.length;

  return (
    <div className="detail">
      <header>
        {t.incidentId && (
          <button className="link" type="button" style={{ marginBottom: 10, display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => props.onSelect({ kind: 'incident', id: t.incidentId! })}>
            <span style={{ width: 14, display: 'inline-flex' }}>{Icon.back}</span>
            Back to {t.incidentId}
          </button>
        )}
        <div className={`status-line tone-${tone}`}>
          <span className={`dot ${t.status === 'held' || t.status === 'unscreened' ? 'hollow' : ''}`} />
          {TICKET_WORD[t.status]}
          {t.incidentId ? ` in ${t.incidentId}` : ''}
        </div>
        <h3>
          {t.id}
        </h3>
        <p className="lede">
          {clock(t.at)}, {t.from}, by {t.channel}
          {t.thread ? `, a reply in ${t.thread}'s thread` : ''}
        </p>
        <p className="lede" style={{ color: 'var(--chalk)' }}>
          {t.outcome}
        </p>
      </header>

      <section>
        <div className="text">{marked(text, marks)}</div>
        <div className="actions" style={{ marginTop: 8 }}>
          {t.masked !== null && (
            <div className="seg" role="group" aria-label="Which text to show">
              <button type="button" aria-pressed={!original} onClick={() => setOriginal(false)}>
                What Squall reads
              </button>
              <button type="button" aria-pressed={original} onClick={() => setOriginal(true)}>
                As filed
              </button>
            </div>
          )}
          <span className="note" style={{ margin: 0 }}>
            {t.masked === null
              ? 'Protect did not answer, so nothing downstream saw this text.'
              : piiTotal
                ? `Protect masked ${piiTotal} piece${piiTotal === 1 ? '' : 's'} of personal data.`
                : 'Protect found no personal data.'}
          </span>
        </div>
      </section>

      {t.guard && (
        <section className={`tone-${t.status === 'held' ? 'squall' : 'good'}`}>
          <h4>Guard: is this ticket trying to steer the system?</h4>
          <Bars data={{ injection: t.guard.injection }} top="injection" />
          <p className="note">
            {t.status === 'held'
              ? `Held at ${pct(t.guard.injection)}${t.guard.category && t.guard.category !== 'benign' ? ` (${label(t.guard.category).toLowerCase()})` : ''}. The line is ${pct(POLICY.guardHold)}. It was kept out of every incident.`
              : `Below the ${pct(POLICY.guardHold)} line, so it went on to be read.`}
          </p>
        </section>
      )}

      {facts.length > 0 && (
        <section>
          <h4>Extract: quoted from the ticket, with its place in the text</h4>
          <dl className="kv">
            {facts.map(([name, f]) => (
              <span key={name} style={{ display: 'contents' }}>
                <dt>{label(name)}</dt>
                <dd>
                  {f!.value} {f!.confidence !== null && <small>{pct(f!.confidence)}</small>}
                </dd>
              </span>
            ))}
          </dl>
        </section>
      )}

      {t.candidates.length > 0 && (
        <section>
          <h4>Rerank: which open incident or earlier ticket could this belong to?</h4>
          <ul className="mini">
            {t.candidates.slice(0, 5).map((c) => (
              <li key={c.id}>
                <div className="head">
                  <button className="link" type="button" onClick={() => props.onSelect({ kind: c.kind, id: c.id })}>
                    {c.id}
                  </button>
                  <span className={`verdict tone-${c.action === 'skip' ? 'mute' : 'calm'}`}>
                    {c.action === 'skip' ? `Skip: ${label(c.reason ?? 'unrelated').toLowerCase()}` : c.action === 'use' ? 'Same fault' : 'Related'} {pct(c.relevance)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {t.pairs.length > 0 && (
        <section>
          <h4>Compare: the decision to merge</h4>
          <ul className="mini">
            {t.pairs.map((p) => (
              <li key={p.with}>
                <div className="head">
                  <b>{t.id}</b> and
                  <button className="link" type="button" onClick={() => props.onSelect({ kind: 'ticket', id: p.with })}>
                    {p.with}
                  </button>
                  <span className={`verdict tone-${p.relation === 'same' ? 'good' : p.relation === 'conflicting' ? 'storm' : 'mute'}`}>{label(p.relation)}</span>
                </div>
                {Object.keys(p.probabilities).length > 0 && (
                  <Bars data={p.probabilities} top={p.relation} order={['same', 'conflicting', 'overlapping', 'unrelated'].filter((k) => k in p.probabilities)} />
                )}
                {(p.conflict ?? p.duplicate) && (
                  <div className="split" style={{ marginTop: 4 }}>
                    <div>
                      <small>
                        {t.id} {p.conflict ? 'says' : 'matches on'}
                      </small>
                      <q>{(p.conflict ?? p.duplicate)!.a.quote}</q>
                    </div>
                    <div>
                      <small>
                        {p.with} {p.conflict ? 'says' : 'matches on'}
                      </small>
                      <q>{(p.conflict ?? p.duplicate)!.b.quote}</q>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {t.followUp && (
        <section>
          <h4>Rerank with the thread: what to send someone who already got a reply</h4>
          <Passages list={t.followUp} />
        </section>
      )}

      {calls.length > 0 && (
        <section>
          <h4>Clocked calls for this ticket</h4>
          <ul className="mini">
            {calls.map((c) => (
              <li key={c.id}>
                <div className="head">
                  <span>{c.label}</span>
                  <span className={`verdict tone-${c.ok ? 'mute' : 'squall'}`}>
                    {c.ok ? `${c.endpoint}, ${ms(c.modelMs ?? c.ms)}, ${c.credits ?? '–'} credits` : 'Failed'}
                  </span>
                </div>
                {!c.ok && <span className="note" style={{ margin: 0 }}>{c.error}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- strip + scoreboard */

export function CallStrip({ calls, mode }: { calls: CallLog[]; mode: Mode | null }) {
  const cost = useMemo(() => costOf(calls), [calls]);
  const recent = calls.slice(-9).reverse();
  return (
    <div className="strip" aria-label="Clocked calls">
      <div className="calls">
        {recent.length ? (
          recent.map((c) => (
            <div key={c.id} className={`call ${c.ok ? '' : 'fail'}`} title={c.error ?? c.label}>
              <b>{c.endpoint === 'pipeline' ? (c.steps ?? []).join(' + ') : c.endpoint}</b>
              <span>{c.ok ? `${ms(c.modelMs ?? c.ms)}, ${c.credits ?? '–'} cr` : 'failed'}</span>
            </div>
          ))
        ) : (
          <span style={{ color: 'var(--chalk-3)', fontSize: 12.5 }}>Each Clocked call appears here with its model time and credit cost.</span>
        )}
      </div>
      <div className="totals">
        <span>
          <b>{cost.calls}</b>calls
        </span>
        <span>
          <b>{cost.medianModelMs === null ? '–' : Math.round(cost.medianModelMs)}</b>ms median
        </span>
        <span>
          <b>{mode === 'sim' ? '–' : cost.credits}</b>credits
        </span>
      </div>
    </div>
  );
}

export function Scoreboard(props: { tickets: TicketRecord[]; incidents: Incident[]; calls: CallLog[]; mode: Mode; onClose: () => void }) {
  const s = useMemo(() => score(props.tickets, props.incidents), [props.tickets, props.incidents]);
  const b = useMemo(() => baseline(STORM), []);
  const cost = useMemo(() => costOf(props.calls), [props.calls]);
  const flagged = (at: number | null, first: number) => (at === null ? 'Never' : `${clock(at)} (${Math.round(at - first)} s after the first report)`);
  return (
    <div className="sheet" role="region" aria-label="How this run scored">
      <button className="btn quiet close" type="button" onClick={props.onClose}>
        Close
      </button>
      <h2>How this run scored against the storm's ground truth</h2>
      <p className="lede">
        {props.mode === 'sim'
          ? 'This is the offline simulator, not Clocked. These numbers only show the scoring works.'
          : 'The storm is synthetic and labelled. Squall never sees the labels. The comparison is the rule many desks run today: count tickets per keyword, raise an incident at five in ten minutes.'}
      </p>
      <table>
        <thead>
          <tr>
            <th />
            <th>Squall on Clocked</th>
            <th>Keyword count rule</th>
          </tr>
        </thead>
        <tbody>
          {s.faults
            .filter((f) => f.reports > 0)
            .map((f) => {
              const bf = b.faults.find((x) => x.fault === f.fault)!;
              return (
                <tr key={f.fault}>
                  <td>
                    {f.name}
                    <br />
                    <small style={{ color: 'var(--chalk-3)' }}>{f.major ? 'A real major incident' : 'Not a major incident'}</small>
                  </td>
                  <td>
                    <b>
                      {f.flaggedAs === 'declared' ? 'Declared ' : f.flaggedAs === 'review' ? 'Put to the manager ' : f.major ? 'Not flagged' : 'Left alone'}
                      {f.flaggedAt !== null ? clock(f.flaggedAt) : ''}
                    </b>
                    <br />
                    {f.flaggedAt !== null ? `${Math.round(f.flaggedAt - f.firstReportAt)} s after the first report, at ${f.reportsWhenFlagged ?? '?'} reports. ` : ''}
                    Grouped {f.found} of {f.reports} reports.
                  </td>
                  <td>
                    <b>{bf.flaggedAt === null ? 'Never raised' : `Raised ${clock(bf.flaggedAt)}`}</b>
                    <br />
                    {bf.flaggedAt !== null ? `${flagged(bf.flaggedAt, f.firstReportAt).split('(')[1]?.replace(')', '')}. ` : ''}
                    {bf.wrongInBucket} of {bf.inBucket} tickets in its bucket are not this fault.
                  </td>
                </tr>
              );
            })}
          <tr>
            <td>Tickets grouped with the right company</td>
            <td>
              <b>{pct(s.grouped.precision)} precision, {pct(s.grouped.recall)} recall</b>
              <br />
              {s.grouped.wrongPairs} wrong pairings, {s.grouped.missedPairs} missed
            </td>
            <td>
              <b>{pct(b.grouped.precision)} precision, {pct(b.grouped.recall)} recall</b>
              <br />
              {b.grouped.wrongPairs} wrong pairings, {b.grouped.missedPairs} missed
            </td>
          </tr>
          <tr>
            <td>The ticket that tries to suppress the incident</td>
            <td>
              <b>{s.hostile.planted === 0 ? 'Not reached yet' : s.hostile.held === s.hostile.planted ? 'Held by Guard, kept out' : 'Not held'}</b>
              {s.hostile.wronglyHeld.length ? `. ${s.hostile.wronglyHeld.length} honest ticket(s) also held: ${s.hostile.wronglyHeld.join(', ')}` : ''}
            </td>
            <td>
              <b>Counted like any other</b>
            </td>
          </tr>
          <tr>
            <td>Personal data that survived masking</td>
            <td>
              <b>
                {s.pii.leaked.length} of {s.pii.planted} planted items
              </b>
            </td>
            <td>Not masked</td>
          </tr>
          {props.mode !== 'sim' && (
            <tr>
              <td>Cost of the run</td>
              <td>
                <b>
                  {cost.credits} credits for {s.tickets} tickets
                </b>
                <br />
                {cost.calls} calls, {cost.failed} failed, median model time {cost.medianModelMs === null ? '–' : `${Math.round(cost.medianModelMs)} ms`}
              </td>
              <td>Free, and blind</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
