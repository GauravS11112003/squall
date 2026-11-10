'use client';

import { ArrowUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { StoryEvent } from '@/lib/story';
import type { Incident, RawTicket, TicketRecord } from '@/lib/types';
import { TICKET_WORD, clock, incidentName, ticketTone } from '@/lib/ui';

type Select = (s: { kind: 'incident' | 'ticket'; id: string } | null) => void;

/** Left panel. Tickets: one line each, newest first. Activity: the same run told as plain events. */
export function Stream(props: {
  tickets: TicketRecord[];
  pending: RawTicket | null;
  incidents: Incident[];
  events: StoryEvent[];
  selectedId: string | null;
  onSelect: Select;
  total: number;
  canFile: boolean;
  busy: boolean;
  onFile: (text: string) => void;
  away: boolean;
}) {
  const [text, setText] = useState('');
  const [view, setView] = useState<'tickets' | 'activity'>('tickets');
  const rows = useMemo(() => [...props.tickets].reverse(), [props.tickets]);
  const feed = useMemo(() => props.events.filter((e) => e.kind !== 'alone' && e.kind !== 'joined').reverse(), [props.events]);
  const nameOf = (id: string | null) => incidentName(props.incidents.find((i) => i.id === id));
  return (
    <aside className={`stream glass ${props.away ? 'away' : ''}`} aria-label="Tickets and activity">
      <div className="panel-head">
        <div className="seg flat" role="group" aria-label="What to list">
          <button type="button" aria-pressed={view === 'tickets'} onClick={() => setView('tickets')}>
            Tickets
          </button>
          <button type="button" aria-pressed={view === 'activity'} onClick={() => setView('activity')}>
            Activity
          </button>
        </div>
        <span>
          {view === 'tickets' ? (
            <>
              <b>{props.tickets.length}</b> of {props.total}
            </>
          ) : (
            <>
              <b>{feed.length}</b> events
            </>
          )}
        </span>
      </div>
      {view === 'tickets' ? (
        <div className="stream-list">
          {props.pending && !props.tickets.some((t) => t.id === props.pending!.id) && (
            <button key={props.pending.id} type="button" className="tk reading new t-slate" disabled aria-live="polite">
              <span className="dot" />
              <b className="shimmer">{props.pending.id}</b>
              <em>Reading</em>
              <p>{props.pending.from}</p>
            </button>
          )}
          {rows.map((t) => {
            const tone = ticketTone(t, props.incidents);
            const flagged = t.status === 'held' || t.status === 'unscreened';
            return (
              <button key={t.id} type="button" className={`tk new t-${tone}`} aria-current={props.selectedId === t.id} onClick={() => props.onSelect({ kind: 'ticket', id: t.id })}>
                <span className={`dot ${flagged ? 'ring' : ''}`} />
                <b>{t.id}</b>
                <em>{t.status === 'joined' ? nameOf(t.incidentId) : TICKET_WORD[t.status]}</em>
                <p>{t.masked ?? 'The safety screen did not answer.'}</p>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="stream-list">
          {feed.map((e) => (
            <button key={e.id} type="button" className={`ev new t-${e.tone}`} onClick={() => props.onSelect(e.target)}>
              <span className="dot" />
              <b>{e.title}</b>
              <small>{clock(e.at)}</small>
              <p>{e.detail}</p>
            </button>
          ))}
          {!feed.length && <p className="fine" style={{ padding: '6px 12px' }}>Nothing notable yet. Incidents forming, tickets held, fixes blocked and updates checked are listed here as they happen.</p>}
        </div>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && props.canFile && !props.busy) {
            props.onFile(text.trim());
            setText('');
            setView('tickets');
          }
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!props.canFile}
          aria-label="File your own ticket"
          placeholder={props.canFile ? 'Type a ticket and see where it lands' : 'Filing your own ticket needs live mode'}
        />
        <button type="submit" disabled={!props.canFile || props.busy || !text.trim()} aria-label="File ticket">
          <ArrowUp />
        </button>
      </form>
    </aside>
  );
}
