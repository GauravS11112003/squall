'use client';

import { X } from 'lucide-react';
import { useEffect } from 'react';
import { usePolicy } from './policy-context';
import { pct } from '@/lib/ui';

const STEPS: [string, string, string][] = [
  ['Mask', 'Protect', 'Names, phone numbers and addresses are hidden before anything else reads the ticket.'],
  ['Screen', 'Guard', 'A ticket that tries to instruct the system is held and cannot move an incident.'],
  ['Read', 'Extract', 'The service, error, place and deadline are quoted word for word from the ticket.'],
  ['Shortlist', 'Rerank', 'Finds the open incidents and earlier tickets this one could belong to.'],
  ['Match', 'Compare', 'Decides whether it is the same fault. Only then is the ticket merged.'],
  ['Size up', 'Decide', 'Gives the chance the incident is major, how widely it is felt and how badly.'],
];

/** How to read the screen, in one place. Opened from the top bar or with the ? key. */
export function Guide({ onClose }: { onClose: () => void }) {
  const P = usePolicy();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="veil" role="dialog" aria-modal="true" aria-label="How to read Squall" onClick={onClose}>
      <div className="sheet glass guide" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn x" type="button" onClick={onClose} aria-label="Close">
          <X />
        </button>
        <h2>How to read Squall</h2>
        <div className="guide-cols">
          <section>
            <h3>On the stage</h3>
            <ul className="key">
              <li>
                <span className="g g-dot" />
                <p>
                  <b>A dot is one ticket.</b> Select it to see what was read and why it ended up where it did.
                </p>
              </li>
              <li>
                <span className="g g-storm" />
                <p>
                  <b>A storm is one fault, reported by several people.</b> It grows with every report and spins faster as the risk rises.
                </p>
              </li>
              <li>
                <span className="g g-ring" />
                <p>
                  <b>The ring is the chance it is a major incident.</b> Its two notches are where Squall asks you ({pct(P.askManager)}) and where it declares on its own ({pct(P.autoDeclare)}).
                </p>
              </li>
              <li>
                <span className="g g-tones">
                  <i className="t-blue" />
                  <i className="t-amber" />
                  <i className="t-red" />
                </span>
                <p>
                  <b>Colour is state.</b> Blue is being watched, amber needs your call, red is a declared major incident.
                </p>
              </li>
              <li>
                <span className="g g-arc" />
                <p>
                  <b>An arc flashes when two tickets are matched.</b> An orange line stays between two reports that disagree on a fact.
                </p>
              </li>
              <li>
                <span className="g g-pen" />
                <p>
                  <b>Held tickets wait in the red pen.</b> A person reads them. They are never counted.
                </p>
              </li>
            </ul>
          </section>
          <section>
            <h3>What happens to every ticket</h3>
            <ol className="flow">
              {STEPS.map(([verb, endpoint, text]) => (
                <li key={verb}>
                  <b>
                    {verb} <small>{endpoint}</small>
                  </b>
                  <p>{text}</p>
                </li>
              ))}
            </ol>
            <p className="fine" style={{ marginTop: 12 }}>
              When an incident is declared, Rerank finds the workaround, Guard and Inspect check it is safe to send, Fill drafts the company update and Verify checks every claim in it against the reports. Each name is a Clocked API endpoint.
            </p>
          </section>
        </div>
        <div className="keys">
          <span>
            <kbd>Space</kbd> play or pause
          </span>
          <span>
            <kbd>→</kbd> read one ticket
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
          <span>
            <kbd>?</kbd> this guide
          </span>
        </div>
      </div>
    </div>
  );
}
