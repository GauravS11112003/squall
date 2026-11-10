'use client';

import { X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { POLICY, resolvePolicy } from '@/lib/policy';
import type { PolicyOverrides } from '@/lib/policy';
import { whatIf } from '@/lib/story';
import type { Incident, TicketRecord } from '@/lib/types';
import { clock, pct } from '@/lib/ui';

const LINES: { key: 'autoDeclare' | 'askManager' | 'guardHold'; name: string; help: string }[] = [
  { key: 'autoDeclare', name: 'Declare without a person at', help: 'At or above this chance of a major incident, Squall declares it and starts the response on its own.' },
  { key: 'askManager', name: 'Ask a person from', help: 'From here up to the declare line, the incident is put in front of you. Below it, Squall keeps watching.' },
  { key: 'guardHold', name: 'Hold a ticket at', help: 'A ticket this likely to be steering the system is held and never counted.' },
];

/**
 * Clocked supplies the probability; these lines decide what happens at each one.
 * The list underneath replays the Clocked answers already taken against the lines
 * as you drag them, so a manager can see what a stricter or looser policy would do.
 */
export function PolicySheet(props: {
  overrides: PolicyOverrides;
  onChange: (o: PolicyOverrides) => void;
  incidents: Incident[];
  tickets: TicketRecord[];
  applies: boolean;
  onClose: () => void;
}) {
  const P = resolvePolicy(props.overrides);
  const rows = useMemo(() => whatIf(props.incidents, P), [props.incidents, P.askManager, P.autoDeclare]);
  const screened = props.tickets.filter((t) => t.guard);
  const held = screened.filter((t) => t.guard!.injection >= P.guardHold);
  const changed = Object.keys(props.overrides).length > 0;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);
  const set = (key: 'autoDeclare' | 'askManager' | 'guardHold', value: number) => {
    const next: PolicyOverrides = { ...props.overrides, [key]: value };
    // keep "ask" at or below "declare", whichever one is being dragged
    const ask = next.askManager ?? POLICY.askManager;
    const dec = next.autoDeclare ?? POLICY.autoDeclare;
    if (ask > dec) {
      if (key === 'askManager') next.autoDeclare = value;
      else next.askManager = value;
    }
    props.onChange(next);
  };
  return (
    <div className="veil" role="dialog" aria-modal="true" aria-label="Policy lines" onClick={props.onClose}>
      <div className="sheet glass policy" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn x" type="button" onClick={props.onClose} aria-label="Close">
          <X />
        </button>
        <h2>Where Squall draws the line</h2>
        <p>Clocked gives a probability. These three lines decide what happens at each one. They are plain numbers you own, not a model.</p>
        <div className="guide-cols">
          <section className="sliders">
            {LINES.map((l) => (
              <label key={l.key}>
                <span>
                  {l.name} <b>{pct(P[l.key])}</b>
                </span>
                <input type="range" min={5} max={99} step={1} value={Math.round(P[l.key] * 100)} onChange={(e) => set(l.key, Number(e.target.value) / 100)} style={{ ['--v' as string]: `${((P[l.key] * 100 - 5) / 94) * 100}%` }} />
                <small>{l.help}</small>
              </label>
            ))}
            <button className="btn" type="button" onClick={() => props.onChange({})} disabled={!changed} style={{ justifySelf: 'start' }}>
              Back to the defaults
            </button>
          </section>
          <section>
            <h3>What these lines do with the answers so far</h3>
            {rows.length === 0 && screened.length === 0 ? (
              <p className="fine" style={{ marginTop: 10 }}>
                Start the storm, then come back: every Clocked answer taken so far is replayed against the lines as you move them.
              </p>
            ) : (
              <div className="rows" style={{ marginTop: 6 }}>
                {rows.map((r) => (
                  <div key={r.incidentId} className={`t-${r.outcome === 'declared' ? 'red' : r.outcome === 'asked' ? 'amber' : 'blue'}`}>
                    <small>{r.name}</small>
                    <b>
                      {r.outcome === 'declared'
                        ? `Declared at ${clock(r.at!)}, with ${r.size} reports (${pct(r.p)})`
                        : r.outcome === 'asked'
                          ? `Put to you at ${clock(r.at!)}, with ${r.size} reports (${pct(r.p)})`
                          : `Left watching. Highest reading ${pct(r.p)}`}
                    </b>
                  </div>
                ))}
                <div className="t-red">
                  <small>Tickets held for trying to steer the system</small>
                  <b>{held.length ? `${held.length} of ${screened.length}: ${held.slice(0, 6).map((t) => t.id).join(', ')}${held.length > 6 ? '…' : ''}` : `None of ${screened.length}`}</b>
                </div>
              </div>
            )}
            <p className="fine" style={{ marginTop: 12 }}>
              {props.applies
                ? 'Changes apply from the next ticket read. Incidents already declared stay declared.'
                : 'This is a recorded run, so the lines cannot change what already happened. The list shows what they would have done with the same Clocked answers. Decide is not asked again once an incident is declared, so later readings may not exist.'}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
