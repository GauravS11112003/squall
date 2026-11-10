'use client';

import { ChevronLeft, EyeOff, GitMerge, ListFilter, ScanText, Send, Shield } from 'lucide-react';
import { useEffect, useState } from 'react';
import { usePolicy } from './policy-context';
import type { CallLog, Incident, TicketRecord } from '@/lib/types';
import { TICKET_WORD, clock, label, locate, marked, maskTokens, pct, ticketTone } from '@/lib/ui';
import type { MarkSpec } from '@/lib/ui';
import { Bars, Passages } from './bits';

type Select = (s: { kind: 'incident' | 'ticket'; id: string } | null) => void;

function cost(calls: CallLog[], endpoint: string): string | null {
  const c = calls.find((x) => x.endpoint === endpoint || (x.steps ?? []).includes(endpoint));
  if (!c) return null;
  return c.ok ? `${Math.round(c.modelMs ?? c.ms)} ms${c.credits !== null ? `, ${c.credits} credits` : ''}` : 'failed';
}

/** One ticket, as a journey: what each Clocked endpoint read, and what that changed. */
export function TicketCard(props: { ticket: TicketRecord; incidents: Incident[]; calls: CallLog[]; onSelect: Select }) {
  const t = props.ticket;
  const POLICY = usePolicy();
  const [asFiled, setAsFiled] = useState(false);
  useEffect(() => setAsFiled(false), [t.id]);
  const tone = ticketTone(t, props.incidents);
  const calls = props.calls.filter((c) => c.ticketId === t.id);
  const text = asFiled || t.masked === null ? t.text : t.masked;
  const marks: MarkSpec[] = [];
  if (asFiled) {
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
  const piiTotal = Object.values(t.piiCounts).reduce((a, b) => a + b, 0) || t.pii.length;
  const held = t.status === 'held';
  const failed = calls.filter((c) => !c.ok);

  return (
    <>
      <div className={`hero t-${tone}`}>
        <button className="back" type="button" onClick={() => props.onSelect(t.incidentId ? { kind: 'incident', id: t.incidentId } : null)}>
          <ChevronLeft /> {t.incidentId ?? 'Close'}
        </button>
        <div className="state">
          <span className={`dot ${held || t.status === 'unscreened' ? 'ring' : ''}`} />
          {held ? 'Held by Guard' : TICKET_WORD[t.status]}
          {t.incidentId ? ` in ${t.incidentId}` : ''}
        </div>
        <h2 className="title" style={{ marginTop: 10 }}>
          {t.id}
        </h2>
        <p className="sub">
          {clock(t.at)}, {t.from}, by {t.channel}
          {t.thread ? `. A reply in ${t.thread}'s thread` : ''}
        </p>
      </div>

      <div className="body" style={{ paddingTop: 16 }}>
        <section>
          <div className="quote">{marked(text, marks)}</div>
          <div className="under">
            {t.masked !== null ? (
              <div className="seg flat" role="group" aria-label="Which text to show">
                <button type="button" aria-pressed={!asFiled} onClick={() => setAsFiled(false)}>
                  What Squall reads
                </button>
                <button type="button" aria-pressed={asFiled} onClick={() => setAsFiled(true)}>
                  As filed
                </button>
              </div>
            ) : (
              <span />
            )}
          </div>
          <p className="sub" style={{ marginTop: 14, color: 'var(--ink)' }}>
            {t.outcome}
          </p>
        </section>

        <section className="steps">
          <div className={`step t-${t.masked === null ? 'red' : 'green'}`}>
            <span className="n">
              <EyeOff />
            </span>
            <h4>
              Hide personal data <small>Protect{cost(calls, 'pii') ? `, ${cost(calls, 'pii')}` : ''}</small>
            </h4>
            <div className="in">
              <p>
                {t.masked === null
                  ? 'Did not answer, so nothing else saw this text.'
                  : piiTotal
                    ? `Masked ${piiTotal} piece${piiTotal === 1 ? '' : 's'} of personal data before anything else read the ticket.`
                    : 'Found no personal data.'}
              </p>
            </div>
          </div>

          {t.guard && (
            <div className={`step t-${held ? 'red' : 'green'}`}>
              <span className="n">
                <Shield />
              </span>
              <h4>
                Screen for manipulation <small>Guard{cost(calls, 'injection') ? `, ${cost(calls, 'injection')}` : ''}</small>
              </h4>
              <div className="in">
                <p>
                  {pct(t.guard.injection)} likely to be steering the system
                  {held
                    ? `${t.guard.category && t.guard.category !== 'benign' ? ` (${label(t.guard.category).toLowerCase()})` : ''}. At or above the ${pct(POLICY.guardHold)} line, so it was kept out of every incident.`
                    : `. Under the ${pct(POLICY.guardHold)} line, so it was read.`}
                </p>
              </div>
            </div>
          )}

          {facts.length > 0 && (
            <div className="step t-blue">
              <span className="n">
                <ScanText />
              </span>
              <h4>
                Quote the facts <small>Extract{cost(calls, 'extract') ? `, ${cost(calls, 'extract')}` : ''}</small>
              </h4>
              <div className="in">
                <dl className="facts">
                  {facts.map(([name, f]) => (
                    <span key={name} style={{ display: 'contents' }}>
                      <dt>{label(name)}</dt>
                      <dd>
                        {f!.value}
                        {f!.confidence !== null && <small>{pct(f!.confidence)}</small>}
                      </dd>
                    </span>
                  ))}
                </dl>
              </div>
            </div>
          )}

          {t.candidates.length > 0 && (
            <div className="step t-blue">
              <span className="n">
                <ListFilter />
              </span>
              <h4>
                Shortlist what it could belong to <small>Rerank{cost(calls, 'rerank') ? `, ${cost(calls, 'rerank')}` : ''}</small>
              </h4>
              <div className="in">
                <div className="list" style={{ margin: '0 -10px' }}>
                  {t.candidates.slice(0, 4).map((c) => (
                    <button key={c.id} type="button" className={`item t-${c.action === 'skip' ? 'slate' : 'blue'}`} onClick={() => props.onSelect({ kind: c.kind, id: c.id })}>
                      <b>{c.id}</b>
                      <span>{c.action === 'skip' ? label(c.reason ?? 'unrelated') : c.action === 'use' ? 'Same fault' : 'Related'}</span>
                      <em>{pct(c.relevance)}</em>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {t.pairs.length > 0 && (
            <div className={`step t-${t.status === 'joined' ? 'green' : 'slate'}`}>
              <span className="n">
                <GitMerge />
              </span>
              <h4>
                Decide whether to merge <small>Compare{cost(calls, 'compare') ? `, ${cost(calls, 'compare')}` : ''}</small>
              </h4>
              <div className="in">
                {t.pairs.slice(0, 2).map((p) => (
                  <div key={p.with} style={{ display: 'grid', gap: 8 }}>
                    <p>
                      Against{' '}
                      <button type="button" className="back" style={{ margin: 0, display: 'inline', color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: 3 }} onClick={() => props.onSelect({ kind: 'ticket', id: p.with })}>
                        {p.with}
                      </button>
                      : {p.relation === 'same' ? 'the same fault' : p.relation === 'conflicting' ? 'the same fault, with a disagreement' : p.relation}.
                    </p>
                    {Object.keys(p.probabilities).length > 0 && (
                      <div className={`t-${p.relation === 'same' ? 'green' : p.relation === 'conflicting' ? 'orange' : 'slate'}`}>
                        <Bars data={p.probabilities} top={p.relation} order={['same', 'conflicting', 'overlapping', 'unrelated'].filter((k) => k in p.probabilities)} />
                      </div>
                    )}
                    {(p.conflict ?? p.duplicate) && (
                      <div className="versus">
                        <div>
                          <small>{t.id}</small>
                          <q>{(p.conflict ?? p.duplicate)!.a.quote}</q>
                        </div>
                        <div>
                          <small>{p.with}</small>
                          <q>{(p.conflict ?? p.duplicate)!.b.quote}</q>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(t.sent.length > 0 || t.followUp) && (
            <div className="step t-green">
              <span className="n">
                <Send />
              </span>
              <h4>
                Reply to the reporter <small>{t.followUp ? 'Rerank, with the thread' : 'checked workaround'}</small>
              </h4>
              <div className="in">
                <p>{t.followUp ? 'This person had already been sent a fix. Rerank read the thread, so they get the next step and not the same one again.' : `Sent the checked workaround: ${t.sent.join(', ')}.`}</p>
                {t.followUp && <Passages list={t.followUp} />}
              </div>
            </div>
          )}
        </section>

        {failed.length > 0 && (
          <section>
            {failed.map((c) => (
              <p key={c.id} className="fine warn">
                {c.label}: {c.error}
              </p>
            ))}
          </section>
        )}
      </div>
    </>
  );
}
