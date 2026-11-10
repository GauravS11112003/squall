'use client';

import { Pause, Play, RotateCcw } from 'lucide-react';
import type { Incident, RawTicket, TicketRecord } from '@/lib/types';
import { clock, incidentTone, ticketTone } from '@/lib/ui';

type Select = (s: { kind: 'incident' | 'ticket'; id: string } | null) => void;

/** Transport and timeline. One tick per ticket, tall when it joined an incident; a flag where one was declared. */
export function Dock(props: {
  plan: RawTicket[];
  tickets: TicketRecord[];
  incidents: Incident[];
  now: number;
  running: boolean;
  done: boolean;
  canRun: boolean;
  speed: number;
  selectedId: string | null;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  onSpeed: (s: number) => void;
  onSelect: Select;
  away: boolean;
}) {
  const span = Math.max(1, props.plan[props.plan.length - 1]?.at ?? 1);
  const left = (at: number) => `${2 + (Math.min(span, at) / span) * 96}%`;
  const seen = new Map(props.tickets.map((t) => [t.id, t]));
  return (
    <footer className={`dock glass ${props.away ? 'away' : ''}`} aria-label="Storm controls">
      {props.running ? (
        <button className="playbtn" type="button" onClick={props.onPause} aria-label="Pause the storm">
          <Pause />
        </button>
      ) : (
        <button className="playbtn" type="button" onClick={props.onPlay} disabled={!props.canRun || props.done} aria-label={props.done ? 'Storm finished' : 'Play the storm'}>
          <Play style={{ marginLeft: 2 }} />
        </button>
      )}
      <div className="time">
        <b>{clock(props.now)}</b>
        <span>{props.done ? 'Storm over' : `${props.tickets.filter((t) => seen.has(t.id) && props.plan.some((p) => p.id === t.id)).length} of ${props.plan.length} tickets`}</span>
      </div>
      <div className="rail" role="list" aria-label="Storm timeline">
        {props.incidents
          .filter((i) => i.declaredAt !== null && i.status === 'declared')
          .map((i) => (
            <span key={i.id} className={`flag t-${incidentTone(i)}`} style={{ left: left(i.declaredAt!) }} title={`${i.id} declared at ${clock(i.declaredAt!)}`} />
          ))}
        {props.plan.map((p) => {
          const t = seen.get(p.id);
          const tone = t ? ticketTone(t, props.incidents) : 'slate';
          const held = t && (t.status === 'held' || t.status === 'unscreened');
          const h = !t ? 7 : t.status === 'joined' ? 26 : held ? 18 : 11;
          return (
            <button
              key={p.id}
              type="button"
              role="listitem"
              className={`tick t-${tone} ${t ? 'seen' : ''} ${held ? 'ring' : ''}`}
              style={{ left: left(p.at), ['--h' as string]: `${h}px` }}
              aria-current={props.selectedId === p.id}
              aria-label={`${p.id} at ${clock(p.at)}${t ? '' : ', not read yet'}`}
              title={`${p.id}, ${clock(p.at)}`}
              disabled={!t}
              onClick={() => props.onSelect({ kind: 'ticket', id: p.id })}
            >
              <i />
            </button>
          );
        })}
        <span className="head-mark" style={{ left: left(props.now) }} />
      </div>
      <div className="seg flat" role="group" aria-label="Speed">
        {[1, 2, 4].map((s) => (
          <button key={s} type="button" aria-pressed={props.speed === s} onClick={() => props.onSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
      <button className="icon-btn" type="button" onClick={props.onReset} disabled={!props.tickets.length} aria-label="Start over">
        <RotateCcw />
      </button>
    </footer>
  );
}
