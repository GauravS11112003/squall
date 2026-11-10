'use client';

import { Check, Minus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { KB_BY_ID } from '@/data/kb';
import { usePolicy } from './policy-context';
import type { Incident, PassageChoice, Verification } from '@/lib/types';
import { clip, label, pct } from '@/lib/ui';

/** A number that eases to its new value instead of jumping. */
export function Count({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || a === value) {
      from.current = value;
      setShown(value);
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 700);
      const v = a + (value - a) * (1 - Math.pow(1 - t, 4));
      from.current = v;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{Math.round(shown)}</>;
}

export function Bars({ data, top, order }: { data: Record<string, number>; top?: string; order?: string[] }) {
  const keys = order ?? Object.keys(data).sort((a, b) => data[b] - data[a]);
  return (
    <div className="bars">
      {keys.map((k) => (
        <div key={k} className={`bar ${k === top ? 'lead' : ''}`}>
          <span>{label(k)}</span>
          <i>
            <u style={{ width: `${Math.max(0, Math.min(1, data[k] ?? 0)) * 100}%` }} />
          </i>
          <em>{pct(data[k] ?? 0)}</em>
        </div>
      ))}
    </div>
  );
}

/** Decide's readings for one incident over time, with the two policy lines. */
export function Trace({ incident }: { incident: Incident }) {
  const POLICY = usePolicy();
  const d = incident.decisions;
  if (d.length < 2) return null;
  const W = 360;
  const H = 72;
  const x = (i: number) => 4 + (i / (d.length - 1)) * (W - 8);
  const y = (p: number) => H - 5 - p * (H - 10);
  const line = d.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v.pMajor).toFixed(1)}`).join(' ');
  return (
    <svg className="trace" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Probability of a major incident across ${d.length} readings`}>
      {[POLICY.askManager, POLICY.autoDeclare].map((l) => (
        <line key={l} x1="0" x2={W} y1={y(l)} y2={y(l)} stroke="#0a0f1c" strokeOpacity="0.18" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
      ))}
      <path d={`${line} L${x(d.length - 1)},${H} L${x(0)},${H} Z`} fill="currentColor" opacity="0.08" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(d.length - 1)} cy={y(d[d.length - 1].pMajor)} r="3.5" fill="currentColor" />
    </svg>
  );
}

function scriptOf(text: string): string {
  return /```[a-zA-Z]*\n([\s\S]*?)```/.exec(text)?.[1]?.trim() ?? '';
}

export function Passages({ list }: { list: PassageChoice[] }) {
  const shown = list.filter((p) => p.selected || p.blocked || p.action !== 'skip' || p.reason !== 'unrelated').slice(0, 6);
  return (
    <div className="kb">
      {shown.map((p) => {
        const tone = p.blocked ? 'red' : p.selected ? 'green' : 'slate';
        const verdict =
          p.blocked === 'script'
            ? 'Blocked by Inspect'
            : p.blocked === 'injection'
              ? 'Blocked by Guard'
              : p.blocked === 'unchecked'
                ? 'Not sent, check failed'
                : p.selected
                  ? 'Sent'
                  : p.action === 'skip'
                    ? label(p.reason ?? 'unrelated')
                    : p.action === 'expand'
                      ? 'Right article, other part'
                      : 'Also fits';
        const k = KB_BY_ID[p.id];
        const bad = (p.script?.evidence ?? []).map((e) => e.line.trim()).filter(Boolean);
        return (
          <div key={p.id} className={`kb-item t-${tone} ${p.blocked ? 'blocked' : p.selected ? '' : 'off'}`}>
            <div className="kb-head">
              <b>{p.id}</b>
              <span title={p.title}>{p.title}</span>
              <em>{verdict}</em>
            </div>
            <p className="fine">
              Rerank {pct(p.relevance)} relevant
              {p.guard ? `, Guard ${pct(p.guard.injection)} injection` : ''}
              {p.script ? `, Inspect ${pct(p.script.malicious)} malicious` : ''}
              {p.expandedFrom ? `. Pulled in from ${p.expandedFrom}` : ''}
            </p>
            {p.blocked === 'script' && k && (
              <pre className="code" aria-label="The script lines behind the verdict">
                {scriptOf(k.text)
                  .split('\n')
                  .map((ln, i) => (
                    <span key={i}>
                      {bad.some((b) => ln.includes(b) || b.includes(ln.trim())) ? <mark>{ln}</mark> : ln}
                      {'\n'}
                    </span>
                  ))}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Claims({ v }: { v: Verification }) {
  const POLICY = usePolicy();
  return (
    <ul className="claims">
      {v.claims.map((c, i) => {
        const ok = c.supported >= POLICY.claimSupport;
        const contra = c.verdict.startsWith('contra');
        const tone = !c.counted ? 'slate' : ok ? 'green' : contra ? 'red' : 'amber';
        return (
          <li key={i} className={`t-${tone}`}>
            <span className="mk">{!c.counted ? <Minus /> : ok ? <Check /> : <X />}</span>
            <div>
              {c.claim}
              <small>
                {!c.counted
                  ? 'Not a factual claim'
                  : ok
                    ? `Supported ${pct(c.supported)}${c.source ? ` by ${c.source}` : ''}${c.quote ? `: “${clip(c.quote, 80)}”` : ''}`
                    : contra
                      ? `Contradicted ${pct(c.contradicted)}${c.source ? ` by ${c.source}` : ''}${c.quote ? `: “${clip(c.quote, 80)}”` : ''}`
                      : `Nothing in the reports or the passage says this (${pct(c.supported)} supported)`}
              </small>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
