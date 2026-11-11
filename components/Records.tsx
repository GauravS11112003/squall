'use client';

import { Download, FileText, Globe, Mail, Printer, ScrollText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { costOf } from '@/lib/metrics';
import type { StoryEvent } from '@/lib/story';
import type { CallLog, Incident, PersonalReply, TicketRecord } from '@/lib/types';
import { STATUS_WORD, clock, incidentName, incidentTone, label, pct } from '@/lib/ui';
import { Claims, Passages, Trace } from './bits';
import { ChannelIcon } from './ChannelIcon';

type Tab = 'proofs' | 'documents' | 'tickets' | 'activity' | 'calls';
type Docs = { status: string; brief: string; markdown: string };

function save(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens the browser's print dialog for a document, which is also how it is saved as a PDF. */
function printHtml(html: string) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  f.srcdoc = html;
  f.onload = () => {
    f.contentWindow?.focus();
    f.contentWindow?.print();
    setTimeout(() => f.remove(), 60000);
  };
  document.body.appendChild(f);
}

/**
 * The record of the run: every incident, with the proof behind each decision and the
 * documents it produced. This is where you go after the storm, to drill down.
 */
export function Records(props: {
  tickets: TicketRecord[];
  incidents: Incident[];
  calls: CallLog[];
  events: StoryEvent[];
  replies: Record<string, PersonalReply>;
  selectedId: string | null;
  simulated: boolean;
  docsFor: (inc: Incident) => Docs;
  onSelect: (id: string) => void;
  onTicket: (id: string) => void;
  onOutputs: (id: string, tab: 'status' | 'brief' | 'replies') => void;
}) {
  const [tab, setTab] = useState<Tab>('proofs');
  const inc = props.incidents.find((i) => i.id === props.selectedId) ?? props.incidents[0];
  const cost = useMemo(() => costOf(props.calls), [props.calls]);
  const held = props.tickets.filter((t) => t.status === 'held' || t.status === 'unscreened');
  const major = props.incidents.filter((i) => i.status === 'declared').length;
  const members = inc ? props.tickets.filter((t) => t.incidentId === inc.id) : [];
  const byId = new Map(props.tickets.map((t) => [t.id, t]));
  const first = members.length ? Math.min(...members.map((m) => m.at)) : 0;
  const last = inc?.decisions[inc.decisions.length - 1];
  const docs = useMemo(() => (inc ? props.docsFor(inc) : null), [inc, props.docsFor]);
  const incEvents = inc ? props.events.filter((e) => e.incidentId === inc.id && e.kind !== 'joined' && e.kind !== 'alone') : [];
  const incCalls = inc ? props.calls.filter((c) => c.incidentId === inc.id || members.some((m) => m.id === c.ticketId)) : [];
  const incCost = useMemo(() => costOf(incCalls), [incCalls.length]);
  const drafted = members.filter((m) => props.replies[m.id]).length;
  const slug = inc ? `${inc.id.toLowerCase()}-${incidentName(inc).toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : '';

  const kpis: [string, string][] = [
    ['Tickets read', String(props.tickets.length)],
    ['Incidents', String(props.incidents.length)],
    ['Major', String(major)],
    ['Held by Guard', String(held.length)],
    ['Clocked calls', String(cost.calls)],
    [props.simulated ? 'Median time' : 'Credits', props.simulated ? `${cost.medianModelMs === null ? '–' : Math.round(cost.medianModelMs)} ms` : cost.credits.toLocaleString()],
  ];

  return (
    <section className="records glass" aria-label="Incident records">
      <header className="rec-head">
        <div>
          <h2>Records</h2>
          <p>Every incident from this run, with the proof behind each decision and the documents it produced.</p>
        </div>
        <dl className="kpis">
          {kpis.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="rec-body">
        <nav className="rec-list" aria-label="Incidents">
          <div className="rec-th">
            <span>Incident</span>
            <span>Reports</span>
            <span>Major</span>
          </div>
          {props.incidents.map((i) => {
            const d = i.decisions[i.decisions.length - 1];
            return (
              <button key={i.id} type="button" className={`rec-row t-${incidentTone(i)}`} aria-current={inc?.id === i.id} onClick={() => props.onSelect(i.id)}>
                <span className="who">
                  <span className="dot" />
                  <span>
                    <b>{incidentName(i)}</b>
                    <small>
                      {i.id}, {STATUS_WORD[i.status].toLowerCase()}
                    </small>
                  </span>
                </span>
                <span>{i.memberIds.length}</span>
                <span>{d ? pct(d.pMajor) : '–'}</span>
              </button>
            );
          })}
          {!props.incidents.length && <p className="fine" style={{ padding: 14 }}>No incident formed in this run.</p>}
          {held.length > 0 && (
            <>
              <div className="rec-th" style={{ marginTop: 14 }}>
                <span>Held, never counted</span>
                <span />
                <span>Injection</span>
              </div>
              {held.map((t) => (
                <button key={t.id} type="button" className="rec-row t-red" onClick={() => props.onTicket(t.id)}>
                  <span className="who">
                    <span className="dot ring" />
                    <span>
                      <b>{t.id}</b>
                      <small>{t.from}</small>
                    </span>
                  </span>
                  <span />
                  <span>{pct(t.guard?.injection)}</span>
                </button>
              ))}
            </>
          )}
        </nav>

        {inc && docs ? (
          <article className="rec-page">
            <div className={`rec-title t-${incidentTone(inc)}`}>
              <div>
                <span className="state">
                  <span className="dot" />
                  {STATUS_WORD[inc.status]}
                </span>
                <h3>{inc.title}</h3>
              </div>
              <div className="actions">
                <button className="btn" type="button" onClick={() => printHtml(docs.brief)}>
                  <Printer /> Brief as PDF
                </button>
                <button className="btn ink" type="button" onClick={() => props.onOutputs(inc.id, 'status')}>
                  <Globe /> Status page
                </button>
              </div>
            </div>
            <dl className="rec-fields">
              <div>
                <dt>Reports</dt>
                <dd>{members.length}</dd>
              </div>
              <div>
                <dt>First report</dt>
                <dd>{clock(first)}</dd>
              </div>
              <div>
                <dt>Declared</dt>
                <dd>{inc.status === 'declared' && inc.declaredAt !== null ? `${clock(inc.declaredAt)}, ${inc.declaredBy === 'manager' ? 'by you' : 'by policy'}` : 'Not declared'}</dd>
              </div>
              <div>
                <dt>Time to declare</dt>
                <dd>{inc.status === 'declared' && inc.declaredAt !== null ? `${Math.max(0, Math.round(inc.declaredAt - first))} s` : '–'}</dd>
              </div>
              <div>
                <dt>Chance major</dt>
                <dd>{last ? pct(last.pMajor) : '–'}</dd>
              </div>
              <div>
                <dt>Felt across</dt>
                <dd>{last?.scope ? label(last.scope.choice) : '–'}</dd>
              </div>
            </dl>

            <div className="tabs" role="tablist">
              {(
                [
                  ['proofs', 'Proofs'],
                  ['documents', 'Documents'],
                  ['tickets', `Tickets (${members.length})`],
                  ['activity', 'Activity'],
                  ['calls', `Clocked calls (${incCalls.length})`],
                ] as [Tab, string][]
              ).map(([id, word]) => (
                <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)}>
                  {word}
                </button>
              ))}
            </div>

            <div className="rec-tab" key={`${inc.id}-${tab}`}>
              {tab === 'proofs' && (
                <>
                  <section>
                    <h4>
                      Why these tickets are one incident <small>Compare</small>
                    </h4>
                    <div className="tbl">
                      <div className="tr th">
                        <span>Ticket</span>
                        <span>Matched with</span>
                        <span>Related</span>
                        <span>Compare read it as</span>
                      </div>
                      {members.map((t) => {
                        const best = [...t.pairs].filter((p) => p.relation !== 'unrelated').sort((a, b) => b.related - a.related)[0];
                        return (
                          <button key={t.id} type="button" className="tr" onClick={() => props.onTicket(t.id)}>
                            <span>
                              <b>{t.id}</b>
                            </span>
                            <span>{best ? best.with : t.thread ? `${t.thread} (same thread)` : 'Matched by a later ticket'}</span>
                            <span>{best ? pct(best.related) : '–'}</span>
                            <span>{best ? label(best.relation) : t.thread ? 'Not asked: a reply in a thread' : 'See the ticket that matched it'}</span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                  <section className={`t-${incidentTone(inc)}`}>
                    <h4>
                      Why it is {inc.status === 'declared' ? 'a major incident' : 'not declared'} <small>Decide</small>
                    </h4>
                    <p className="sub">{inc.reason}</p>
                    <Trace incident={inc} />
                    <div className="tbl" style={{ marginTop: 8 }}>
                      <div className="tr th">
                        <span>Time</span>
                        <span>Reports</span>
                        <span>Major</span>
                        <span>Felt across</span>
                      </div>
                      {inc.decisions.map((d, i) => (
                        <div key={i} className="tr">
                          <span>{clock(d.at)}</span>
                          <span>{d.size}</span>
                          <span>
                            <b>{pct(d.pMajor)}</b>
                          </span>
                          <span>{d.scope ? label(d.scope.choice) : '–'}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                  {inc.conflicts.length > 0 && (
                    <section>
                      <h4>
                        Where reports disagree <small>Compare</small>
                      </h4>
                      <div style={{ display: 'grid', gap: 8 }}>
                        {inc.conflicts.map((c, i) => (
                          <div className="versus" key={i}>
                            <div>
                              <small>
                                {c.a}, {label(c.kind).toLowerCase()}, {pct(c.confidence)}
                              </small>
                              <q>{c.aQuote}</q>
                            </div>
                            <div>
                              <small>{c.b}</small>
                              <q>{c.bQuote}</q>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                  {inc.response && inc.response.passages.length > 0 && (
                    <section>
                      <h4>
                        Why this fix was sent and another was not <small>Rerank, Guard, Inspect</small>
                      </h4>
                      <Passages list={inc.response.passages} />
                    </section>
                  )}
                  {inc.response?.verification && (
                    <section>
                      <h4>
                        Why the update {inc.response.verification.sendable ? 'can be sent' : 'is held back'} <small>Fill, Verify</small>
                      </h4>
                      <p className="quote" style={{ marginBottom: 12 }}>
                        {inc.response.verification.draft}
                      </p>
                      <Claims v={inc.response.verification} />
                    </section>
                  )}
                </>
              )}

              {tab === 'documents' && (
                <div className="files">
                  {(
                    [
                      { key: 'status', Icon: Globe, name: 'Status page', kind: 'HTML', note: 'Every sentence footnoted with the report that supports it.', html: docs.status, file: `${slug}-status.html` },
                      { key: 'brief', Icon: FileText, name: 'Incident brief', kind: 'HTML, one page', note: 'How the risk rose, what was sent, what was blocked and why.', html: docs.brief, file: `${slug}-brief.html` },
                    ] as const
                  ).map((f) => (
                    <div key={f.key} className="file">
                      <span className="file-ico">
                        <f.Icon />
                      </span>
                      <div>
                        <b>{f.name}</b>
                        <small>
                          {f.kind}. {f.note}
                        </small>
                      </div>
                      <div className="actions">
                        <button className="btn" type="button" onClick={() => props.onOutputs(inc.id, f.key)}>
                          Preview
                        </button>
                        <button className="btn" type="button" onClick={() => printHtml(f.html)}>
                          <Printer /> PDF
                        </button>
                        <button className="btn" type="button" onClick={() => save(f.file, f.html, 'text/html')} aria-label={`Download ${f.name}`}>
                          <Download />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="file">
                    <span className="file-ico">
                      <ScrollText />
                    </span>
                    <div>
                      <b>Full incident report</b>
                      <small>Markdown. Timeline, every Decide reading, the masked reports and the Clocked usage.</small>
                    </div>
                    <div className="actions">
                      <button className="btn" type="button" onClick={() => save(`${slug}-report.md`, docs.markdown, 'text/markdown')}>
                        <Download /> Download
                      </button>
                    </div>
                  </div>
                  <div className="file">
                    <span className="file-ico">
                      <Mail />
                    </span>
                    <div>
                      <b>Personal replies</b>
                      <small>
                        {drafted} of {members.length} drafted. Written from each reporter's own ticket, then checked.
                      </small>
                    </div>
                    <div className="actions">
                      <button className="btn" type="button" onClick={() => props.onOutputs(inc.id, 'replies')}>
                        Open
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {tab === 'tickets' && (
                <div className="tbl wide">
                  <div className="tr th">
                    <span>Ticket</span>
                    <span>What Squall read (personal data masked)</span>
                    <span>Deadline</span>
                    <span>Sent</span>
                  </div>
                  {members.map((t) => (
                    <button key={t.id} type="button" className="tr" onClick={() => props.onTicket(t.id)}>
                      <span className="tk-id">
                        <ChannelIcon channel={t.channel} />
                        <b>{t.id}</b>
                      </span>
                      <span className="clip">{t.masked}</span>
                      <span className="clip">{t.facts.impact?.value ?? '–'}</span>
                      <span>{t.sent.join(' → ') || '–'}</span>
                    </button>
                  ))}
                </div>
              )}

              {tab === 'activity' && (
                <ol className="rec-log">
                  {incEvents.map((e) => (
                    <li key={e.id} className={`t-${e.tone}`}>
                      <time>{clock(e.at)}</time>
                      <span className="dot" />
                      <div>
                        <b>{e.title}</b>
                        <p>{e.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              {tab === 'calls' && (
                <>
                  <p className="sub" style={{ marginBottom: 10 }}>
                    {incCost.calls} calls, {incCost.failed} failed{props.simulated ? '' : `, ${incCost.credits.toLocaleString()} credits`}, median model time {incCost.medianModelMs === null ? '–' : `${Math.round(incCost.medianModelMs)} ms`}. Read from the X-Clocked headers on each response.
                  </p>
                  <div className="tbl calls">
                    <div className="tr th">
                      <span>Time</span>
                      <span>What was asked</span>
                      <span>Endpoint</span>
                      <span>Model</span>
                      <span>Credits</span>
                    </div>
                    {incCalls.map((c) => (
                      <div key={c.id} className={`tr ${c.ok ? '' : 't-red'}`}>
                        <span>{clock(c.at)}</span>
                        <span className="clip">{c.ok ? c.label : `${c.label}: ${c.error}`}</span>
                        <span>{c.endpoint === 'pipeline' ? (c.steps ?? []).join(' + ') : c.endpoint}</span>
                        <span>{c.modelMs === null ? '–' : `${Math.round(c.modelMs)} ms`}</span>
                        <span>{props.simulated ? '–' : c.credits ?? '–'}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </article>
        ) : (
          <article className="rec-page">
            <p className="sub" style={{ padding: 24 }}>
              Nothing to show yet. Run the storm, then come back: each incident gets a record here with its proofs and documents.
            </p>
          </article>
        )}
      </div>
    </section>
  );
}
