import type { ReactNode } from 'react';

export * from './format';

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

