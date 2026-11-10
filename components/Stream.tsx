'use client';

import { ArrowUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Incident, RawTicket, TicketRecord } from '@/lib/types';
import { TICKET_WORD, ticketTone } from '@/lib/ui';

type Select = (s: { kind: 'incident' | 'ticket'; id: string } | null) => void;

/** The ticket stream: newest first, one line each. The detail lives one click away. */
export function Stream(props: {
  tickets: TicketRecord[];
  pending: RawTicket | null;
  incidents: Incident[];
  selectedId: string | null;
  onSelect: Select;
  total: number;
  canFile: boolean;
  busy: boolean;
  onFile: (text: string) => void;
  away: boolean;
}) {
  const [text, setText] = useState('');
  const rows = useMemo(() => [...props.tickets].reverse(), [props.tickets]);
  return (
    <aside className={`stream glass ${props.away ? 'away' : ''}`} aria-label="Incoming tickets">
      <div className="panel-head">
        <h2>Tickets</h2>
        <span>
          <b>{props.tickets.length}</b> of {props.total}
        </span>
      </div>
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
              <em>{t.status === 'joined' ? t.incidentId : TICKET_WORD[t.status]}</em>
              <p>{t.masked ?? 'The safety screen did not answer.'}</p>
            </button>
          );
        })}
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && props.canFile && !props.busy) {
            props.onFile(text.trim());
            setText('');
          }
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!props.canFile}
          aria-label="File your own ticket"
          placeholder={props.canFile ? 'File your own ticket' : 'Filing a ticket needs live mode'}
        />
        <button type="submit" disabled={!props.canFile || props.busy || !text.trim()} aria-label="File ticket">
          <ArrowUp />
        </button>
      </form>
    </aside>
  );
}
