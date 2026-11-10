'use client';

import { ChevronRight, Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import { Fragment } from 'react';
import type { JourneyStep } from '@/lib/story';
import type { Incident, RawTicket, TicketRecord } from '@/lib/types';
import { clock, incidentTone, ticketTone } from '@/lib/ui';

type Select = (s: { kind: 'incident' | 'ticket'; id: string } | null) => void;

/**
 * The bottom console, read like a media player. Top row: what just happened, in one
 * sentence, and how far that ticket got through the six steps. Bottom row: transport
 * and a timeline with one tick per ticket.
 */
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
  caption: { title: string; detail: string; tone: string; reading: boolean };
  journey: JourneyStep[];
  onPlay: () => void;
  onPause: () => void;
  onStep: () => void;
  onReset: () => void;
  onSpeed: (s: number) => void;
  onSelect: Select;
  away: boolean;
}) {
  const span = Math.max(1, props.plan[props.plan.length - 1]?.at ?? 1);
  const left = (at: number) => `${2 + (Math.min(span, at) / span) * 96}%`;
  const seen = new Map(props.tickets.map((t) => [t.id, t]));
  const read = props.plan.filter((p) => seen.has(p.id)).length;
  return (
    <footer className={`dock glass ${props.away ? 'away' : ''}`} aria-label="Storm console">
      <div className="now">
        <div className={`now-text t-${props.caption.tone}`} aria-live="polite">
          <b className={props.caption.reading ? 'shimmer' : ''}>{props.caption.title}</b>
          <span title={props.caption.detail}>{props.caption.detail}</span>
        </div>
        <ol className="pipe" aria-label="How far this ticket got">
          {props.journey.map((s, i) => (
            <Fragment key={s.key}>
              {i > 0 && <ChevronRight aria-hidden="true" />}
              <li className={`s-${props.caption.reading ? 'wait' : s.state}`} title={`${s.endpoint}: ${s.note}`}>
                <b>{s.verb}</b>
                <small>{s.endpoint}</small>
              </li>
            </Fragment>
          ))}
        </ol>
      </div>
      <div className="transport">
        {props.running ? (
          <button className="playbtn" type="button" onClick={props.onPause} aria-label="Pause the storm">
            <Pause />
          </button>
        ) : (
          <button className="playbtn" type="button" onClick={props.onPlay} disabled={!props.canRun || props.done} aria-label={props.done ? 'Storm finished' : 'Play the storm'}>
            <Play style={{ marginLeft: 2 }} />
          </button>
        )}
        <button className="icon-btn" type="button" onClick={props.onStep} disabled={!props.canRun || props.done || props.running} aria-label="Read one ticket" title="Read one ticket (right arrow)">
          <SkipForward />
        </button>
        <div className="time">
          <b>{clock(props.now)}</b>
          <span>{props.done ? 'Storm over' : `${read} of ${props.plan.length} tickets`}</span>
        </div>
        <div className="rail" role="list" aria-label="Storm timeline">
          {props.incidents
            .filter((i) => i.declaredAt !== null && i.status === 'declared')
            .map((i) => (
              <span key={i.id} className={`flag t-${incidentTone(i)}`} style={{ left: left(i.declaredAt!) }} title={`${i.services[0] ?? i.id} declared at ${clock(i.declaredAt!)}`} />
            ))}
          {props.plan.map((p) => {
            const t = seen.get(p.id);
            const tone = t ? ticketTone(t, props.incidents) : 'slate';
            const held = t && (t.status === 'held' || t.status === 'unscreened');
            const h = !t ? 7 : t.status === 'joined' ? 24 : held ? 17 : 11;
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
        <button className="icon-btn" type="button" onClick={props.onReset} disabled={!props.tickets.length} aria-label="Start over" title="Start over">
          <RotateCcw />
        </button>
      </div>
    </footer>
  );
}
