'use client';

import { useEffect, useRef, useState } from 'react';
import type { StoryEvent } from '@/lib/story';
import { clock } from '@/lib/ui';

const WEIGHT: Record<string, number> = { declared: 6, blocked: 5, held: 5, unread: 5, conflict: 4, followup: 3, review: 3, checked: 2, formed: 1 };

type Select = (s: { kind: 'incident' | 'ticket'; id: string } | null) => void;

/**
 * The things worth interrupting for (an incident declared, a ticket held, a dangerous
 * fix blocked) appear one at a time over the stage, in a sentence, then leave.
 */
export function Moments({ events, onSelect, quiet }: { events: StoryEvent[]; onSelect: Select; quiet: boolean }) {
  const seen = useRef<Set<string>>(new Set());
  const [queue, setQueue] = useState<StoryEvent[]>([]);
  useEffect(() => {
    if (!events.length) {
      seen.current.clear();
      setQueue([]);
      return;
    }
    const declared = new Set(events.filter((e) => e.kind === 'declared').map((e) => e.incidentId));
    // "needs your call" is stale once the same incident has been declared
    const fresh = events.filter((e) => e.moment && !seen.current.has(e.id) && !(e.kind === 'review' && declared.has(e.incidentId)));
    for (const e of events) seen.current.add(e.id);
    if (fresh.length) {
      setQueue((q) => {
        const all = [...q, ...fresh];
        if (all.length <= 3) return all;
        // too many at once: keep the three that matter most, still in the order they happened
        const keep = new Set([...all].sort((a, b) => (WEIGHT[b.kind] ?? 0) - (WEIGHT[a.kind] ?? 0)).slice(0, 3));
        return all.filter((e) => keep.has(e));
      });
    }
  }, [events]);
  const head = queue[0];
  const waiting = queue.length - 1;
  useEffect(() => {
    if (!head) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), waiting > 0 ? 2100 : 4600);
    return () => clearTimeout(t);
  }, [head, waiting]);
  if (!head || quiet) return null;
  return (
    <button key={head.id} type="button" className={`moment glass t-${head.tone}`} onClick={() => onSelect(head.target)} aria-live="polite">
      <span className="dot" />
      <span className="moment-text">
        <b>{head.title}</b>
        <span>{head.detail}</span>
      </span>
      <small>
        {clock(head.at)}
        {waiting > 0 ? `, ${waiting} more` : ''}
      </small>
    </button>
  );
}
