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

/** What people call an incident: the failing service if the reports name one, otherwise its id. */
export function incidentName(i: Incident | undefined | null): string {
  if (!i) return 'an incident';
  return i.services[0] ?? i.id;
}

/**
 * Which knowledge base passages a personal reply is written from: the latest step for someone
 * who has written again in a thread, otherwise the workaround the incident sent to everyone.
 */
export function replyPassageIds(t: { thread?: string | null; sent: string[] }, incidentReply: string[]): string[] {
  if (t.thread && t.sent.length) return [t.sent[t.sent.length - 1]];
  return incidentReply.length ? incidentReply : t.sent;
}
