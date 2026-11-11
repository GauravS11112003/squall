'use client';

import { X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { STORM } from '@/data/storm';
import { baseline, costOf, score } from '@/lib/metrics';
import type { CallLog, Incident, Mode, TicketRecord } from '@/lib/types';
import { clock, pct } from '@/lib/ui';

/** The run against ground truth, next to the keyword rule many desks use today. */
export function Scoreboard(props: { tickets: TicketRecord[]; incidents: Incident[]; calls: CallLog[]; mode: Mode; simulated: boolean; onClose: () => void; onRecords?: () => void }) {
  const s = useMemo(() => score(props.tickets, props.incidents), [props.tickets, props.incidents]);
  const b = useMemo(() => baseline(STORM), []);
  const cost = useMemo(() => costOf(props.calls), [props.calls]);
  const faults = s.faults.filter((f) => f.reports > 0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);
  return (
    <div className="veil" role="dialog" aria-modal="true" aria-label="How the run scored" onClick={props.onClose}>
      <div className="sheet glass" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn x" type="button" onClick={props.onClose} aria-label="Close">
          <X />
        </button>
        <h2>How the run scored against the truth</h2>
        <p>
          {props.simulated
            ? 'This run came from the offline simulator, not Clocked. The numbers only show that the scoring works.'
            : 'The storm is synthetic and labelled, and Squall never sees the labels. Beside it is the rule many desks run today: count tickets per keyword and raise an incident at five in ten minutes.'}
        </p>
        <div className="duel">
          <div className="side">
            <h3>Squall, on Clocked</h3>
            <div className="num">
              {pct(s.grouped.precision)}
              <small>of its groupings are right</small>
            </div>
            <div className="rows">
              <div>
                <small>Same-fault tickets it brought together</small>
                <b>{pct(s.grouped.recall)}</b>
              </div>
              {faults.map((f) => (
                <div key={f.fault}>
                  <small>{f.name}</small>
                  <b>
                    {f.flaggedAs === 'declared'
                      ? `Declared ${Math.round(f.flaggedAt! - f.firstReportAt)} s after the first report, at ${f.reportsWhenFlagged ?? '?'} reports`
                      : f.flaggedAs === 'review'
                        ? `Put to the manager ${Math.round(f.flaggedAt! - f.firstReportAt)} s in, at ${f.reportsWhenFlagged ?? '?'} reports`
                        : f.major
                          ? 'Not flagged'
                          : `Left alone. Grouped ${f.found} of ${f.reports}`}
                  </b>
                </div>
              ))}
              <div>
                <small>The ticket that tries to suppress the incident</small>
                <b>{s.hostile.planted === 0 ? 'Not reached' : s.hostile.held === s.hostile.planted ? 'Held by Guard' : 'Not held'}</b>
              </div>
              <div>
                <small>Planted personal data that survived masking</small>
                <b>
                  {s.pii.leaked.length} of {s.pii.planted}
                </b>
              </div>
              {!props.simulated && (
                <div>
                  <small>Cost</small>
                  <b>
                    {cost.credits.toLocaleString()} credits, {cost.medianModelMs === null ? '–' : Math.round(cost.medianModelMs)} ms median model time
                  </b>
                </div>
              )}
            </div>
          </div>
          <div className="side them">
            <h3>Keyword count rule</h3>
            <div className="num">
              {pct(b.grouped.precision)}
              <small>of its groupings are right</small>
            </div>
            <div className="rows">
              <div>
                <small>Same-fault tickets it brought together</small>
                <b>{pct(b.grouped.recall)}</b>
              </div>
              {faults.map((f) => {
                const bf = b.faults.find((x) => x.fault === f.fault)!;
                return (
                  <div key={f.fault}>
                    <small>{f.name}</small>
                    <b>
                      {bf.flaggedAt === null
                        ? f.major
                          ? 'Never raised'
                          : 'Never raised, correctly'
                        : `Raised ${Math.round(bf.flaggedAt - f.firstReportAt)} s in, at ${clock(bf.flaggedAt)}. ${bf.wrongInBucket} of ${bf.inBucket} in its bucket are something else`}
                    </b>
                  </div>
                );
              })}
              <div>
                <small>The ticket that tries to suppress the incident</small>
                <b>Counted like any other</b>
              </div>
              <div>
                <small>Planted personal data that survived masking</small>
                <b>All of it. Nothing is masked</b>
              </div>
              {!props.simulated && (
                <div>
                  <small>Cost</small>
                  <b>Free</b>
                </div>
              )}
            </div>
          </div>
        </div>
        {props.onRecords && (
          <div style={{ marginTop: 18 }}>
            <button className="btn ink" type="button" onClick={props.onRecords}>
              Open the records: proofs and documents for each incident
            </button>
          </div>
        )}
        <p className="foot">One synthetic storm, written by the person who built the engine. It shows the mechanism on awkward cases; it is not a claim about your tickets. Method and limits are in the README.</p>
      </div>
    </div>
  );
}
