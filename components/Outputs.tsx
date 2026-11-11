'use client';

import { Check, Download, FileText, Globe, Mail, Printer, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Incident, PersonalReply, TicketRecord } from '@/lib/types';
import { incidentName, pct } from '@/lib/ui';
import { ChannelIcon } from './ChannelIcon';
import { usePolicy } from './policy-context';

type Tab = 'status' | 'brief' | 'replies';

function save(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * What an incident produces for people outside the console: a status page whose every
 * sentence carries its receipt, a one-page brief, and a reply to each reporter written
 * from their own ticket. The first two are built from state; replies are drafted by
 * Fill and checked by Verify on request.
 */
export function Outputs(props: {
  incident: Incident;
  tickets: TicketRecord[];
  statusHtml: string;
  briefHtml: string;
  markdown: string;
  replies: Record<string, PersonalReply>;
  sentReplies: Record<string, boolean>;
  busyId: string | null;
  canDraft: (ticketId: string) => boolean;
  onDraft: (ticketId: string) => void;
  onSendReply: (ticketId: string) => void;
  onClose: () => void;
}) {
  const P = usePolicy();
  const inc = props.incident;
  const [tab, setTab] = useState<Tab>('status');
  const frame = useRef<HTMLIFrameElement>(null);
  const slug = `${inc.id.toLowerCase()}-${incidentName(inc).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);
  // Reporters with a deadline first, then everyone else in the order they wrote in.
  const people = useMemo(() => {
    const members = props.tickets.filter((t) => t.incidentId === inc.id && t.masked);
    return [...members.filter((t) => t.facts.impact?.value), ...members.filter((t) => !t.facts.impact?.value)];
  }, [props.tickets, inc.id]);
  const hasFix = Boolean(inc.response?.reply);
  const html = tab === 'brief' ? props.briefHtml : props.statusHtml;

  return (
    <div className="veil" role="dialog" aria-modal="true" aria-label={`Outputs for ${incidentName(inc)}`} onClick={props.onClose}>
      <div className="sheet glass outputs" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn x" type="button" onClick={props.onClose} aria-label="Close">
          <X />
        </button>
        <header className="out-head">
          <div>
            <h2>What goes out</h2>
            <p>Three things {incidentName(inc)} produces for people outside this console. Nothing in them is unsupported by a report.</p>
          </div>
          <div className="seg flat" role="tablist" aria-label="Which output">
            <button type="button" role="tab" aria-pressed={tab === 'status'} onClick={() => setTab('status')}>
              <Globe size={15} /> Status page
            </button>
            <button type="button" role="tab" aria-pressed={tab === 'brief'} onClick={() => setTab('brief')}>
              <FileText size={15} /> Incident brief
            </button>
            <button type="button" role="tab" aria-pressed={tab === 'replies'} onClick={() => setTab('replies')}>
              <Mail size={15} /> Personal replies
            </button>
          </div>
        </header>

        {tab !== 'replies' ? (
          <>
            <div className="out-bar">
              <span className="fine">
                {tab === 'status'
                  ? 'Each sentence is a claim Verify marked supported, with the quoted report as its numbered receipt. Unsupported sentences are left out.'
                  : 'One page for the incident review: how the risk rose, what was sent, what was blocked and why.'}
              </span>
              <div className="actions">
                <button className="btn" type="button" onClick={() => save(`${slug}-${tab === 'status' ? 'status' : 'brief'}.html`, html, 'text/html')}>
                  <Download /> Download
                </button>
                <button className="btn" type="button" onClick={() => frame.current?.contentWindow?.print()}>
                  <Printer /> Print or save as PDF
                </button>
                {tab === 'brief' && (
                  <button className="btn ghost" type="button" onClick={() => save(`${slug}-report.md`, props.markdown, 'text/markdown')}>
                    Markdown
                  </button>
                )}
              </div>
            </div>
            <div className="out-browser">
              <div className="out-chrome" aria-hidden="true">
                <i />
                <i />
                <i />
                <span>{tab === 'status' ? `status.larkspur.example/${slug}` : `${slug}-brief.html`}</span>
              </div>
              <iframe ref={frame} key={tab} title={tab === 'status' ? 'Status page preview' : 'Incident brief preview'} srcDoc={html} sandbox="allow-modals allow-same-origin" />
            </div>
          </>
        ) : (
          <div className="out-replies">
            {!hasFix && <p className="fine warn">This incident has no checked workaround yet, so there is nothing to reply with. Replies open once it is declared and a fix has passed its checks.</p>}
            {people.map((t) => {
              const r = props.replies[t.id];
              const v = r?.verification ?? null;
              const counted = v?.claims.filter((c) => c.counted) ?? [];
              const ok = counted.filter((c) => c.supported >= P.claimSupport).length;
              const sendable = Boolean(v?.sendable);
              return (
                <article key={t.id} className="reply">
                  <div className="reply-top">
                    <ChannelIcon channel={t.channel} />
                    <div>
                      <b>
                        {t.id} <span>{t.from}</span>
                      </b>
                      <p>{t.masked}</p>
                    </div>
                    {t.facts.impact?.value && <em className="t-amber">Deadline: {t.facts.impact.value}</em>}
                  </div>
                  {r ? (
                    <div className={`reply-body t-${sendable ? 'green' : 'amber'}`}>
                      {r.text ? <p className="reply-text">{r.text}</p> : null}
                      {v && (
                        <ul className="reply-claims">
                          {counted.map((c, i) => (
                            <li key={i} className={`t-${c.supported >= P.claimSupport ? 'green' : 'amber'}`}>
                              <span className="dot" />
                              {c.supported >= P.claimSupport ? `Supported ${pct(c.supported)}${c.source ? ` by ${c.source}` : ''}` : `Not supported (${pct(c.supported)})`}: {c.claim}
                            </li>
                          ))}
                        </ul>
                      )}
                      {r.error && <p className="fine warn">{r.error}</p>}
                      <div className="actions">
                        {props.sentReplies[t.id] ? (
                          <span className="done" style={{ height: 38 }}>
                            <Check /> Marked as sent
                          </span>
                        ) : (
                          <button className="btn ink" type="button" disabled={!sendable} onClick={() => props.onSendReply(t.id)}>
                            {sendable ? 'Send reply' : v ? `Held back: ${counted.length - ok} of ${counted.length} claims unsupported` : 'Cannot send'}
                          </button>
                        )}
                        <span className="fine">Written by Fill from this ticket and {r.passageIds.join(', ')}, then checked by Verify. Sending only marks it: the demo has no mail connection.</span>
                      </div>
                    </div>
                  ) : (
                    <div className="actions">
                      <button className="btn" type="button" disabled={!hasFix || !props.canDraft(t.id) || props.busyId !== null} onClick={() => props.onDraft(t.id)}>
                        {props.busyId === t.id ? 'Writing and checking…' : 'Draft a reply'}
                      </button>
                      {hasFix && !props.canDraft(t.id) && <span className="fine">Needs live mode. The recorded run saved replies only for reporters with a deadline.</span>}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
