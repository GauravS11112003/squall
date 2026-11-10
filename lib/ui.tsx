import type { ReactNode } from 'react';
import type { Incident, TicketRecord } from './types';

/** Colour is state, nothing else: blue watching, amber a person is asked, red major. */
export type Tone = 'blue' | 'amber' | 'red' | 'orange' | 'green' | 'slate';

export function incidentTone(i: Incident | undefined | null): Tone {
  if (!i) return 'slate';
  if (i.status === 'declared') return 'red';
  if (i.status === 'review') return 'amber';
  if (i.status === 'dismissed') return 'slate';
  return 'blue';
}

export function ticketTone(t: TicketRecord, incidents: Incident[]): Tone {
  if (t.status === 'held' || t.status === 'unscreened') return 'red';
  if (t.status === 'joined') return incidentTone(incidents.find((i) => i.id === t.incidentId));
  return 'slate';
}

export const STATUS_WORD: Record<string, string> = {
  watching: 'Watching',
  review: 'Needs your call',
  declared: 'Major incident',
  dismissed: 'Dismissed',
};

export const TICKET_WORD: Record<string, string> = {
  held: 'Held',
  unscreened: 'Not read',
  alone: 'On its own',
  joined: 'Grouped',
};

/** Storm time (seconds after 08:40:00) as a wall-clock string. */
export function clock(at: number): string {
  const total = 8 * 3600 + 40 * 60 + Math.max(0, Math.round(at));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const pct = (p: number | null | undefined) => (p === null || p === undefined ? '–' : `${Math.round(p * 100)}%`);

export const ms = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${Math.round(n)} ms`);

export function label(key: string): string {
  const s = key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export type MarkSpec = { start: number; end: number; cls?: string; title?: string };

/** Finds where a quoted value sits in a text: at the offsets given if they match, otherwise by search. */
export function locate(text: string, value: string, start: number, end: number): { start: number; end: number } | null {
  if (!value) return null;
  if (start >= 0 && end > start && text.slice(start, end) === value) return { start, end };
  const i = text.indexOf(value);
  return i >= 0 ? { start: i, end: i + value.length } : null;
}

/** Renders text with non-overlapping highlighted ranges. Overlaps are dropped, earliest first. */
export function marked(text: string, marks: MarkSpec[]): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  const sorted = [...marks].filter((m) => m.end > m.start).sort((a, b) => a.start - b.start);
  sorted.forEach((m, i) => {
    if (m.start < at) return;
    if (m.start > at) out.push(text.slice(at, m.start));
    out.push(
      <mark key={i} className={m.cls} title={m.title}>
        {text.slice(m.start, m.end)}
      </mark>,
    );
    at = m.end;
  });
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** Placeholders Protect leaves behind, such as <PERSON> or [PHONE]. */
export function maskTokens(text: string): MarkSpec[] {
  const out: MarkSpec[] = [];
  for (const m of text.matchAll(/<[A-Z][A-Z_ ]{1,24}(?:_\d+)?>|\[[A-Z][A-Z_ ]{1,24}(?:_\d+)?\]|\*{4,}/g)) {
    out.push({ start: m.index!, end: m.index! + m[0].length, cls: 'mask', title: 'Masked by Protect' });
  }
  return out;
}
