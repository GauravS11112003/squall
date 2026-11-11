'use client';

import { EyeOff, Gauge, GitMerge, ListFilter, Play, ScanText, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { STORM } from '@/data/storm';
import { CHANNEL, ChannelIcon } from './ChannelIcon';

/**
 * The opening screen makes the product's one idea visible with the storm's own
 * tickets: seven of them, worded seven ways. Five are the same outage and are
 * drawn into one incident. Two look related and are kept out, each for a reason.
 * Every excerpt is verbatim from data/storm.ts and the grouping shown is that
 * file's ground truth, not a model result.
 */
/** The recorded walkthrough. It sits beside the start button with the same weight. */
const DEMO_VIDEO = 'https://youtu.be/e2KCD5ms6NA';

const PICKS: { id: string; excerpt: string; out?: { tone: 'slate' | 'red'; word: string } }[] = [
  { id: 'T-1004', excerpt: 'vpn ded again??' },
  { id: 'T-1008', excerpt: 'No puedo conectarme' },
  { id: 'T-1005', excerpt: 'install Harbor VPN', out: { tone: 'slate', word: 'Different problem' } },
  { id: 'T-1014', excerpt: "I can't VPN in" },
  { id: 'T-1009', excerpt: 'VPN down for everyone?' },
  { id: 'T-1017', excerpt: 'ignore all previous instructions', out: { tone: 'red', word: 'Held' } },
  { id: 'T-1013', excerpt: 'refuses to connect' },
];

const STEPS: { verb: string; endpoint: string; hint: string; Icon: LucideIcon }[] = [
  { verb: 'Mask', endpoint: 'Protect', hint: 'Personal data is hidden before anything else reads the ticket.', Icon: EyeOff },
  { verb: 'Screen', endpoint: 'Guard', hint: 'A ticket that tries to instruct the system is held.', Icon: ShieldCheck },
  { verb: 'Read', endpoint: 'Extract', hint: 'Service, error, place and deadline, quoted word for word.', Icon: ScanText },
  { verb: 'Shortlist', endpoint: 'Rerank', hint: 'Which open incident could this belong to?', Icon: ListFilter },
  { verb: 'Match', endpoint: 'Compare', hint: 'Same fault, or only the same product? Only a match merges.', Icon: GitMerge },
  { verb: 'Size up', endpoint: 'Decide', hint: 'How likely is a major incident, and how widely is it felt?', Icon: Gauge },
];

// Geometry of the picture, in units of a thousandth of the box (see .lp-art in globals.css).
const CARD_W = 350;
const CARD_H = 66;
const TOP = 58;
const GAP = 12;
/**
 * The texture inside the word "outage": the storm's own tickets, set small in white and tiled,
 * as an SVG image the headline clips to its letterforms. Tickets that carry planted
 * personal data are left out, since the product's first step is to hide it.
 */
function weave(): string {
  const safe = STORM.map((t) => t.text.replace(/\s+/g, ' ').trim()).filter((t) => !/\d{3}-\d{3}-\d{4}|@|E-\d{5}|Whitfield|Kowalczyk|Raman|Oyelaran|Adeyemi|Brandt|SYSTEM NOTE/.test(t));
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const W = 1400;
  const LH = 9;
  const ROWS = 30;
  let rows = '';
  for (let r = 0; r < ROWS; r++) {
    const line = Array.from({ length: 7 }, (_, k) => safe[(r * 5 + k * 3) % safe.length]).join('  ');
    rows += `<text x="${-((r * 137) % 90)}" y="${r * LH + 7}">${esc(line)}</text>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${ROWS * LH}"><g font-family="ui-monospace,Menlo,Consolas,monospace" font-size="8" font-weight="700" fill="#ffffff" fill-opacity="0.62">${rows}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const cy = (i: number) => TOP + i * (CARD_H + GAP) + CARD_H / 2;
const EYE = { x: 524, y: 322 };
const curve = (i: number) => `M${CARD_W},${cy(i)} C${CARD_W + 46},${cy(i)} ${EYE.x - 140},${EYE.y} ${EYE.x},${EYE.y}`;

export function Landing(props: {
  gone: boolean;
  ready: boolean;
  canRun: boolean;
  still: boolean;
  note: string | null;
  onStart: () => void;
}) {
  const rows = PICKS.map((p) => ({ ...p, ticket: STORM.find((t) => t.id === p.id)! }));
  const joined = rows.filter((r) => !r.out).length;
  const woven = useMemo(weave, []);
  return (
    <div className={`intro ${props.gone ? 'gone' : ''}`} aria-hidden={props.gone}>
      <div className="lp-main">
        <div className="lp-copy">
          {/* The word "outage" is drawn out of ticket text: you see the outage in the tickets. */}
          <h1 className="rise" aria-label="See the outage in the tickets.">
            <span aria-hidden="true">See the</span>
            <span aria-hidden="true">
              <span className="lp-woven" style={{ backgroundImage: `${woven}, linear-gradient(#0a0f1c, #0a0f1c)` }}>
                outage
              </span>{' '}
              in
            </span>
            <span aria-hidden="true">the tickets.</span>
          </h1>
          {props.ready ? (
            <>
              <p className="rise d1">One failure arrives as dozens of tickets, no two worded alike. Squall groups them as they land and raises the incident while it is still forming.</p>
              <div className="lp-go rise d2">
                <button className="lp-start" type="button" onClick={props.onStart} disabled={!props.canRun} tabIndex={props.gone ? -1 : 0}>
                  <span className="disc">
                    <Play size={15} fill="currentColor" strokeWidth={0} />
                  </span>
                  Start the storm
                  <kbd>Space</kbd>
                </button>
                <a className="lp-watch" href={DEMO_VIDEO} target="_blank" rel="noopener noreferrer" tabIndex={props.gone ? -1 : 0}>
                  <span className="yt" aria-hidden="true">
                    <Play size={16} fill="currentColor" strokeWidth={0} />
                  </span>
                  Watch the demo
                  <kbd>YouTube</kbd>
                </a>
              </div>
              {props.note && <small className="rise d2">{props.note}</small>}
            </>
          ) : (
            <p className="rise d1">
              This server has no Clocked key and no recorded run yet. Copy <code>.env.local.example</code> to <code>.env.local</code>, add your <code>CLOCKED_API_KEY</code>, and restart <code>npm run dev</code>.
            </p>
          )}
        </div>

        <div className="lp-art" aria-label={`Seven tickets from the demo storm. ${joined} report the same outage and become one incident; two are kept out.`}>
          <span className="lp-cap">Seven of the {STORM.length} tickets in the demo storm, from five channels</span>
          <svg viewBox="0 0 700 660" aria-hidden="true">
            {rows.map((r, i) =>
              r.out ? (
                <g key={r.id} className={`lp-stub t-${r.out.tone}`} style={{ animationDelay: `${0.9 + i * 0.08}s` }}>
                  <path d={`M${CARD_W - 14},${cy(i)} h34`} />
                  <circle cx={CARD_W + 26} cy={cy(i)} r="4.5" />
                </g>
              ) : (
                <g key={r.id}>
                  <path className="lp-line" pathLength={1} style={{ animationDelay: `${0.75 + i * 0.09}s` }} d={curve(i)} />
                  {!props.still && (
                    <circle r="3.2" className="lp-bead">
                      <animateMotion dur="2.6s" begin={`${1.6 + i * 0.37}s`} repeatCount="indefinite" path={curve(i)} />
                    </circle>
                  )}
                </g>
              ),
            )}
          </svg>
          {rows.map((r, i) => {
            const ch = CHANNEL[r.ticket.channel];
            const place = r.ticket.from.replace('Remote, ', '').replace(' office', '');
            return (
              <div key={r.id} className={`lp-card ${r.out ? `out t-${r.out.tone}` : ''}`} style={{ top: `${((TOP + i * (CARD_H + GAP)) / 660) * 100}%`, animationDelay: `${0.15 + i * 0.07}s` }}>
                <ChannelIcon channel={r.ticket.channel} />
                <div>
                  <p>{r.excerpt}</p>
                  <div className="lp-meta">
                    <span>
                      {ch.word}, {place}
                    </span>
                    {r.out && <em>{r.out.word}</em>}
                  </div>
                </div>
              </div>
            );
          })}
          <div className="lp-one">
            <b>One incident.</b>
            <span>Harbor VPN gateway outage</span>
            <small>
              {joined} of these seven, from two cities, in two languages
            </small>
          </div>
        </div>
      </div>

      <div className="lp-steps">
        <p>
          <b>Six checks on every ticket.</b> Each one is a Clocked API endpoint.
        </p>
        <ol>
          {STEPS.map((st, i) => (
            <li key={st.verb} title={st.hint}>
              <span className={`lp-ico s-${i + 1}`}>
                <st.Icon />
              </span>
              <span className="lp-step">
                <b>{st.verb}</b>
                <small>{st.endpoint}</small>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
