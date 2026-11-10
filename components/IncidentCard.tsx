'use client';

import { Check, Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { usePolicy } from './policy-context';
import type { Incident, Mode, TicketRecord } from '@/lib/types';
import { STATUS_WORD, clock, incidentTone } from '@/lib/ui';
import { Bars, Claims, Count, Passages, Trace } from './bits';

type Select = (s: { kind: 'incident' | 'ticket'; id: string } | null) => void;
type Tab = 'why' | 'evidence' | 'response';

/**
 * One incident, one number, one action. Everything that explains the number
 * sits behind three tabs: why Squall thinks so, the words it rests on, and
 * what goes out to the people affected.
 */
export function IncidentCard(props: {
  incident: Incident;
  tickets: TicketRecord[];
  mode: Mode;
  busy: string | null;
  canAct: boolean;
  canEdit: boolean;
  sent: { at: number; to: number } | null;
  onSelect: Select;
  onDeclare: () => void;
  onDismiss: () => void;
  onVerify: (draft: string) => Promise<string | null>;
  onSend: () => void;
  onExport: () => void;
}) {
  const inc = props.incident;
  const POLICY = usePolicy();
  const tone = incidentTone(inc);
  const last = inc.decisions[inc.decisions.length - 1];
  const members = props.tickets.filter((t) => t.incidentId === inc.id);
  const res = inc.response;
  const v = res?.verification ?? null;
  const [tab, setTab] = useState<Tab>(res ? 'response' : 'why');
  const [draft, setDraft] = useState(v?.draft ?? '');
  const [note, setNote] = useState<string | null>(null);
  const hasResponse = Boolean(res);
  useEffect(() => {
    if (hasResponse) setTab('response');
  }, [hasResponse]);
  useEffect(() => {
    setDraft(v?.draft ?? '');
    setNote(null);
  }, [v?.draft]);
  const edited = v !== null && draft.trim() !== v.draft.trim();
  const blockedCount = res?.passages.filter((p) => p.blocked).length ?? 0;
  const open = inc.status === 'watching' || inc.status === 'review';
  // Counting, not a model: where the reports come from and whose work has a deadline, from Extract's verbatim values.
  const siteCounts: Record<string, number> = {};
  for (const m of members) {
    const v = m.facts.site?.value?.trim();
    if (!v) continue;
    const key = v.charAt(0).toUpperCase() + v.slice(1);
    siteCounts[key] = (siteCounts[key] ?? 0) + 1;
  }
  const siteTop = Object.entries(siteCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const deadlines = members.filter((m) => m.facts.impact?.value);

  return (
    <>
      <div className={`hero t-${tone}`}>
        <div className={`state ${inc.status === 'review' ? 'pulse' : ''}`}>
          <span className="dot" />
          {STATUS_WORD[inc.status]}
          {inc.status === 'declared' && inc.declaredAt !== null ? ` since ${clock(inc.declaredAt)}` : ''}
        </div>
        <div className="figure">
          <b>
            <Count value={last ? last.pMajor * 100 : inc.memberIds.length} />
            {last && <sup>%</sup>}
          </b>
          <span>{last ? `chance this is a major incident, at ${last.size} reports` : `reports so far. Sized up from ${POLICY.decideFrom}.`}</span>
        </div>
        <div className="meter" aria-hidden="true">
          <i style={{ width: `${(last?.pMajor ?? 0) * 100}%` }} />
          <u style={{ left: `${POLICY.askManager * 100}%` }} />
          <u style={{ left: `${POLICY.autoDeclare * 100}%` }} />
        </div>
        <div className="meter-notes" aria-hidden="true">
          <span style={{ left: `${POLICY.askManager * 100}%` }}>ask a person</span>
          <span style={{ left: `${POLICY.autoDeclare * 100}%` }}>declare</span>
        </div>
        <h2 className="title">{inc.title}</h2>
        <p className="sub">
          {inc.memberIds.length} reports{inc.sites.length ? ` from ${inc.sites.slice(0, 3).join(', ')}` : ''}
        </p>
      </div>

      <div className="cta">
        {open && (
          <>
            <div className="row">
              <button className="btn red" type="button" onClick={props.onDeclare} disabled={!props.canAct || props.busy !== null}>
                {props.busy === 'declare' ? 'Preparing the response…' : 'Declare major incident'}
              </button>
              <button className="btn ghost" type="button" onClick={props.onDismiss} disabled={props.busy !== null}>
                Dismiss
              </button>
            </div>
            {!props.canAct && <p className="fine">Declaring by hand needs live mode. This recorded run has no saved answer for it.</p>}
          </>
        )}
        {inc.status === 'declared' &&
          v &&
          (props.sent && !edited ? (
            <div className="done">
              <Check /> Update sent to {props.sent.to} people at {clock(props.sent.at)}
            </div>
          ) : (
            <button className="btn ink wide" type="button" disabled={!v.sendable || edited} onClick={props.onSend}>
              {edited ? 'Check the edited update first' : v.sendable ? `Send update to ${inc.memberIds.length} people` : 'Update blocked: a claim is unsupported'}
            </button>
          ))}
        <p className="fine">{inc.reason}</p>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" type="button" aria-selected={tab === 'why'} onClick={() => setTab('why')}>
          Why
        </button>
        <button role="tab" type="button" aria-selected={tab === 'evidence'} onClick={() => setTab('evidence')} className={inc.conflicts.length ? 't-orange' : ''}>
          Evidence
          {inc.conflicts.length > 0 && <sup>{inc.conflicts.length}</sup>}
        </button>
        {res && (
          <button role="tab" type="button" aria-selected={tab === 'response'} onClick={() => setTab('response')} className={blockedCount ? 't-red' : ''}>
            Response
            {blockedCount > 0 && <sup>{blockedCount} blocked</sup>}
          </button>
        )}
        <button type="button" className="export" onClick={props.onExport} title="Download this incident as a Markdown report">
          <Download /> Report
        </button>
      </div>

      <div className="body" key={tab}>
        {tab === 'why' && (
          <>
            {!last && <p className="sub">Two reports of the same fault make an incident. From {POLICY.decideFrom}, Squall asks Decide how likely it is to be major, how widely it is felt and how badly it stops work.</p>}
            {last?.scope && (
              <section className={`t-${tone}`}>
                <div className="label">How widely it is felt</div>
                <Bars data={last.scope.probabilities} top={last.scope.choice} order={['one_person', 'one_team', 'one_site', 'several_sites'].filter((k) => k in last.scope!.probabilities)} />
              </section>
            )}
            {last?.severity && (
              <section>
                <div className="label">How badly it stops work</div>
                <p style={{ fontSize: 15, fontWeight: 550, letterSpacing: '-0.015em' }}>{last.severity.legend[String(Math.round(last.severity.score))] ?? `Level ${last.severity.score.toFixed(1)}`}</p>
                <p className="fine">
                  {last.severity.score.toFixed(1)} on a scale of 0 to {Math.max(1, Object.keys(last.severity.legend).length - 1)}
                </p>
              </section>
            )}
            {inc.decisions.length > 1 && (
              <section className={`t-${tone}`}>
                <div className="label">Each reading as reports came in</div>
                <Trace incident={inc} />
              </section>
            )}
          </>
        )}

        {tab === 'evidence' && (
          <>
            <section>
              <div className="label">Quoted from the reports, word for word</div>
              <dl className="facts">
                <dt>Service</dt>
                <dd>{inc.services.join(', ') || '–'}</dd>
                <dt>Error</dt>
                <dd>{inc.errors.join(', ') || '–'}</dd>
              </dl>
            </section>
            {siteTop.length > 0 && (
              <section>
                <div className="label">Where the reports come from</div>
                <div className="tally">
                  {siteTop.map(([site, n]) => (
                    <div key={site}>
                      <span>{site}</span>
                      <i>
                        <u style={{ width: `${(n / siteTop[0][1]) * 100}%` }} />
                      </i>
                      <em>{n}</em>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {deadlines.length > 0 && (
              <section>
                <div className="label">Work with a deadline, in the reporter's words</div>
                <div className="list">
                  {deadlines.map((t) => (
                    <button key={t.id} type="button" className="item t-amber" onClick={() => props.onSelect({ kind: 'ticket', id: t.id })}>
                      <b>{t.id}</b>
                      <span>{t.facts.impact!.value}</span>
                      <em>Reply first</em>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {inc.conflicts.length > 0 && (
              <section>
                <div className="label">Reports that disagree</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {inc.conflicts.map((c, i) => (
                    <div className="versus" key={i}>
                      <div>
                        <small>{c.a}</small>
                        <q>{c.aQuote}</q>
                      </div>
                      <div>
                        <small>{c.b}</small>
                        <q>{c.bQuote}</q>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="fine" style={{ marginTop: 8 }}>
                  Found by Compare while matching. A disagreement stops Squall declaring on its own.
                </p>
              </section>
            )}
            <section>
              <div className="label">{members.length} reports</div>
              <div className="list">
                {members.map((t) => (
                  <button key={t.id} type="button" className="item t-green" onClick={() => props.onSelect({ kind: 'ticket', id: t.id })}>
                    <b>{t.id}</b>
                    <span>{t.masked}</span>
                    {t.sent.length > 0 && <em>{t.sent.join(' → ')}</em>}
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        {tab === 'response' && res && (
          <>
            {v && (
              <section>
                <div className="label">The update, checked claim by claim</div>
                <textarea className="draft" value={draft} onChange={(e) => setDraft(e.target.value)} readOnly={!props.canEdit} aria-label="Update to the company" />
                {edited && (
                  <button className="btn" type="button" style={{ marginTop: 8 }} disabled={props.busy !== null || !draft.trim()} onClick={async () => setNote(await props.onVerify(draft))}>
                    {props.busy === 'verify' ? 'Checking each claim…' : 'Check the edited update'}
                  </button>
                )}
                {note && (
                  <p className="fine warn" style={{ marginTop: 8 }}>
                    {note}
                  </p>
                )}
                <div style={{ marginTop: 14 }}>
                  <Claims v={v} />
                </div>
                <p className="fine" style={{ marginTop: 12 }}>
                  Drafted by Fill, checked by Verify against the reports and the passage below.
                  {props.canEdit ? ' Add something the reports do not say and check again.' : ' Editing needs live mode.'} Sending only marks it as sent: this demo has no mail connection.
                </p>
              </section>
            )}
            <section>
              <div className="label">The workaround, checked before it reaches a laptop</div>
              {res.passages.length > 0 && <Passages list={res.passages} />}
              {res.error && (
                <p className="fine warn" style={{ marginTop: 8 }}>
                  {res.error}
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
