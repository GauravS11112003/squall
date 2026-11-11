import { KB_BY_ID } from '../data/kb';
import { STATUS_WORD, clock, incidentName, pct } from './format';
import { costOf } from './metrics';
import type { Policy } from './policy';
import { storyOf } from './story';
import type { CallLog, Incident, TicketRecord } from './types';

/**
 * Two finished documents built from an incident's state, as self-contained HTML:
 * a status page and a one-page brief. Nothing here calls a model. Every sentence on
 * the status page is a claim Verify already marked supported, printed with the ticket
 * quote that supports it. Ticket text is always the masked text.
 */

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const BASE = `
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:#f5f7fa;color:#0a0f1c;font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Inter,Helvetica,Arial,sans-serif;letter-spacing:-0.006em;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
.wrap{max-width:760px;margin:0 auto;padding:44px 28px 56px}
h1{font-size:34px;line-height:1.08;letter-spacing:-0.04em;margin:14px 0 6px;font-weight:660}
h2{font-size:13px;font-weight:600;color:#6b7588;margin:34px 0 12px;letter-spacing:0}
p{margin:0}
.muted{color:#6b7588}.small{font-size:13px}
.chip{display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 13px;border-radius:999px;font-size:13px;font-weight:600}
.chip i{width:8px;height:8px;border-radius:50%;background:currentColor}
.red{color:#d42a3e;background:#fdecee}.amber{color:#b45f06;background:#fff3dd}.blue{color:#2563ff;background:#eaf0ff}.green{color:#0d7d3d;background:#e6f6ec}.slate{color:#47516a;background:#eceff4}
.card{background:#fff;border:1px solid rgba(10,15,28,.08);border-radius:18px;padding:20px 22px;box-shadow:0 1px 2px rgba(10,15,28,.04),0 14px 30px -18px rgba(10,15,28,.18)}
sup a{color:#2563ff;text-decoration:none;font-weight:600;font-size:11px;margin-left:1px}
ol,ul{margin:0;padding:0;list-style:none}
.tl li{display:grid;grid-template-columns:76px 1fr;gap:14px;padding:10px 0;border-top:1px solid rgba(10,15,28,.07)}
.tl li:first-child{border-top:0}.tl time{color:#6b7588;font-size:13px;padding-top:1px}.tl b{font-weight:600}
.src li{display:grid;grid-template-columns:30px 1fr;gap:10px;padding:9px 0;border-top:1px solid rgba(10,15,28,.07);font-size:13.5px}
.src li:first-child{border-top:0}.src .n{color:#2563ff;font-weight:600}.src q{color:#47516a}
.foot{margin-top:34px;padding-top:16px;border-top:1px solid rgba(10,15,28,.1);font-size:12.5px;color:#6b7588}
pre{white-space:pre-wrap;font:inherit;margin:0}
code{font:12.5px ui-monospace,Menlo,Consolas,monospace;background:#eef1f6;padding:1px 5px;border-radius:5px}
@media print{body{background:#fff}.wrap{padding:0;max-width:none}.card{box-shadow:none}@page{margin:16mm}}
`;

function tone(inc: Incident): string {
  return inc.status === 'declared' ? 'red' : inc.status === 'review' ? 'amber' : inc.status === 'dismissed' ? 'slate' : 'blue';
}

/** The checked workaround as plain prose: the passage text without its code fence. */
function workaroundText(inc: Incident): string[] {
  return (inc.response?.reply?.passageIds ?? []).map((id) => (KB_BY_ID[id]?.text ?? '').replace(/```[a-zA-Z]*\n([\s\S]*?)```/g, '$1').replace(/^Workaround while[^:]*:\s*/i, '').replace(/^./, (c) => c.toUpperCase()));
}

/** A public-style status page. Only supported claims appear, each with a numbered receipt. */
export function statusPageHtml(inc: Incident, tickets: TicketRecord[], incidents: Incident[], P: Policy, source: string): string {
  const v = inc.response?.verification ?? null;
  const good = (v?.claims ?? []).filter((c) => c.counted && c.supported >= P.claimSupport);
  const withheld = (v?.claims ?? []).filter((c) => c.counted && c.supported < P.claimSupport).length;
  const receipts: { n: number; source: string; quote: string }[] = [];
  const sentences = good.map((c) => {
    let mark = '';
    if (c.source && c.quote) {
      receipts.push({ n: receipts.length + 1, source: c.source, quote: c.quote });
      mark = `<sup><a href="#r${receipts.length}">${receipts.length}</a></sup>`;
    }
    return `${esc(c.claim)}${mark}`;
  });
  const events = storyOf(tickets, incidents, P).filter((e) => e.incidentId === inc.id && e.kind !== 'joined' && e.kind !== 'alone' && e.kind !== 'review' && e.kind !== 'conflict');
  const steps = workaroundText(inc);
  const state = inc.status === 'declared' ? 'Major incident' : inc.status === 'review' ? 'Investigating' : inc.status === 'dismissed' ? 'Closed' : 'Monitoring';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(incidentName(inc))} status</title><style>${BASE}</style></head><body><div class="wrap">
<span class="chip ${tone(inc)}"><i></i>${state}</span>
<h1>${esc(incidentName(inc))}</h1>
<p class="muted">${inc.declaredAt !== null ? `Declared ${clock(inc.declaredAt)}. ` : ''}${inc.memberIds.length} reports${inc.sites.length ? ` from ${esc(inc.sites.slice(0, 4).join(', '))}` : ''}.</p>
<h2>What is happening</h2>
<div class="card">${sentences.length ? `<p style="font-size:17px;line-height:1.5">${sentences.join(' ')}</p>` : '<p class="muted">No statement has been verified yet. Nothing is published until every sentence is supported by a report.</p>'}
${withheld ? `<p class="small muted" style="margin-top:12px">${withheld} sentence${withheld === 1 ? ' was' : 's were'} withheld because no report supports ${withheld === 1 ? 'it' : 'them'}.</p>` : ''}</div>
${steps.length ? `<h2>What you can do now</h2><div class="card"><pre>${esc(steps.join('\n\n'))}</pre><p class="small muted" style="margin-top:12px">This workaround was screened for injected instructions and its script inspected before it was published.</p></div>` : ''}
<h2>Timeline</h2><ol class="tl">${events.map((e) => `<li><time>${clock(e.at)}</time><div><b>${esc(e.title)}</b><div class="small muted">${esc(e.detail)}</div></div></li>`).join('')}</ol>
${receipts.length ? `<h2>Receipts</h2><ol class="src">${receipts.map((r) => `<li id="r${r.n}"><span class="n">${r.n}</span><div><b>${esc(r.source)}</b> <q>${esc(r.quote)}</q></div></li>`).join('')}</ol>` : ''}
<p class="foot">Every sentence under "What is happening" was checked against the employee reports by Clocked Verify, and its numbered receipt is the quoted report behind it. Personal data was masked by Clocked Protect before anything else read the reports. Judgements from ${esc(source)}. Generated by Squall from synthetic demo data.</p>
</div></body></html>`;
}

/** A one-page brief for whoever runs the incident review. */
export function briefHtml(inc: Incident, tickets: TicketRecord[], incidents: Incident[], calls: CallLog[], P: Policy, source: string): string {
  const members = tickets.filter((t) => t.incidentId === inc.id);
  const first = members.length ? Math.min(...members.map((m) => m.at)) : inc.createdAt;
  const last = inc.decisions[inc.decisions.length - 1];
  const events = storyOf(tickets, incidents, P).filter((e) => e.incidentId === inc.id && e.kind !== 'joined' && e.kind !== 'alone');
  const mine = calls.filter((c) => c.incidentId === inc.id || members.some((m) => m.id === c.ticketId));
  const cost = costOf(mine);
  const v = inc.response?.verification ?? null;
  const sites: Record<string, number> = {};
  for (const m of members) {
    const s = m.facts.site?.value?.trim();
    if (s) sites[s.charAt(0).toUpperCase() + s.slice(1)] = (sites[s.charAt(0).toUpperCase() + s.slice(1)] ?? 0) + 1;
  }
  const deadlines = members.filter((m) => m.facts.impact?.value);
  // Decide's readings as a small chart
  const W = 700;
  const H = 150;
  const d = inc.decisions;
  const x = (i: number) => 34 + (d.length > 1 ? (i / (d.length - 1)) * (W - 68) : (W - 68) / 2);
  const y = (p: number) => H - 12 - p * (H - 44);
  const chart = d.length
    ? `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Chance of a major incident at each reading">
${[P.askManager, P.autoDeclare].map((l) => `<line x1="0" x2="${W}" y1="${y(l)}" y2="${y(l)}" stroke="#0a0f1c" stroke-opacity=".2" stroke-dasharray="3 5"/><text x="${W - 2}" y="${y(l) + 14}" text-anchor="end" font-size="11" fill="#6b7588">${l === P.askManager ? 'ask a person' : 'declare'} ${pct(l)}</text>`).join('')}
<polyline fill="none" stroke="#f0364a" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${d.map((v2, i) => `${x(i).toFixed(1)},${y(v2.pMajor).toFixed(1)}`).join(' ')}"/>
${d.map((v2, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v2.pMajor).toFixed(1)}" r="4" fill="#f0364a"/><text x="${x(i).toFixed(1)}" y="${(y(v2.pMajor) - 10).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="#0a0f1c">${pct(v2.pMajor)}</text>`).join('')}</svg>
<p class="small muted">Decide's reading each time a report joined, at ${d.map((v2) => v2.size).join(', ')} reports.</p>`
    : '<p class="muted">Not sized up yet.</p>';
  const facts: [string, string][] = [
    ['Reports', String(members.length)],
    ['Declared', inc.declaredAt !== null && inc.status === 'declared' ? `${Math.max(0, Math.round(inc.declaredAt - first))} s after the first report` : 'Not declared'],
    ['Chance major', last ? pct(last.pMajor) : 'n/a'],
    ['Felt across', last?.scope ? last.scope.choice.replace(/_/g, ' ') : 'n/a'],
  ];
  const passages = (inc.response?.passages ?? []).filter((p) => p.selected || p.blocked);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Incident brief: ${esc(inc.title)}</title><style>${BASE}
.wrap{max-width:860px}
.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:0;margin-top:22px;border-top:1px solid rgba(10,15,28,.12);border-bottom:1px solid rgba(10,15,28,.12)}
.facts div{padding:14px 14px 14px 0}.facts div+div{padding-left:16px;border-left:1px solid rgba(10,15,28,.08)}
.facts small{display:block;font-size:12.5px;color:#6b7588}.facts b{font-size:19px;font-weight:640;letter-spacing:-0.025em;line-height:1.2}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:0 34px}
.kv{display:grid;grid-template-columns:96px 1fr;gap:7px 12px;font-size:14px}.kv dt{color:#6b7588}.kv dd{margin:0}
.row{padding:9px 0;border-top:1px solid rgba(10,15,28,.07);font-size:14px}.row:first-child{border-top:0}
.ok{color:#0d7d3d;font-weight:600}.no{color:#d42a3e;font-weight:600}
@media (max-width:640px){.cols,.facts{grid-template-columns:1fr 1fr}}
</style></head><body><div class="wrap">
<span class="chip ${tone(inc)}"><i></i>${esc(STATUS_WORD[inc.status])}</span>
<h1>${esc(inc.title)}</h1>
<p class="muted">${esc(inc.reason)}</p>
<div class="facts">${facts.map(([k, val]) => `<div><small>${esc(k)}</small><b>${esc(val)}</b></div>`).join('')}</div>
<h2>How the risk rose</h2>${chart}
<div class="cols"><div>
<h2>Timeline</h2><ol class="tl">${events.map((e) => `<li><time>${clock(e.at)}</time><div><b>${esc(e.title)}</b><div class="small muted">${esc(e.detail)}</div></div></li>`).join('')}</ol>
</div><div>
<h2>What the reports say, word for word</h2><dl class="kv"><dt>Service</dt><dd>${esc(inc.services.join(', ') || 'n/a')}</dd><dt>Error</dt><dd>${esc(inc.errors.join(', ') || 'n/a')}</dd><dt>Places</dt><dd>${esc(Object.entries(sites).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} (${n})`).join(', ') || 'n/a')}</dd></dl>
${deadlines.length ? `<h2>Work with a deadline</h2>${deadlines.map((t) => `<div class="row"><b>${esc(t.id)}</b> <q>${esc(t.facts.impact!.value)}</q></div>`).join('')}` : ''}
${inc.conflicts.length ? `<h2>Reports that disagree</h2>${inc.conflicts.map((c) => `<div class="row"><b>${esc(c.a)}</b> <q>${esc(c.aQuote)}</q><br><b>${esc(c.b)}</b> <q>${esc(c.bQuote)}</q></div>`).join('')}` : ''}
${passages.length ? `<h2>Workaround</h2>${passages.map((p) => `<div class="row"><b>${esc(p.id)}</b> ${esc(KB_BY_ID[p.id]?.title ?? '')}<br>${p.blocked ? `<span class="no">Not sent.</span> ${p.blocked === 'script' ? `Inspect read its script as ${pct(p.script?.malicious)} malicious.` : p.blocked === 'injection' ? `Guard read it as ${pct(p.guard?.injection)} likely to carry an injected instruction.` : 'Its safety check did not answer.'}` : '<span class="ok">Sent.</span> Cleared by Guard and Inspect.'} <span class="muted">Rerank ${pct(p.relevance)} relevant.</span></div>`).join('')}` : ''}
</div></div>
${v ? `<h2>Company update, checked claim by claim</h2><div class="card"><p style="font-size:16px">${esc(v.draft)}</p><div style="margin-top:12px">${v.claims.map((c) => `<div class="row">${!c.counted ? '<span class="muted">Not a claim.</span>' : c.supported >= P.claimSupport ? `<span class="ok">Supported ${pct(c.supported)}.</span>` : `<span class="no">Not supported (${pct(c.supported)}).</span>`} ${esc(c.claim)}${c.source ? ` <span class="muted">[${esc(c.source)}]</span>` : ''}</div>`).join('')}</div></div>` : ''}
<p class="foot">Policy lines in force: ask a person from ${pct(P.askManager)}, declare from ${pct(P.autoDeclare)}, hold a ticket from ${pct(P.guardHold)} injection. Clocked usage for this incident: ${cost.calls} calls, ${cost.failed} failed, ${cost.credits} credits, median model time ${cost.medianModelMs === null ? 'n/a' : `${Math.round(cost.medianModelMs)} ms`}. Judgements from ${esc(source)}. Personal data was masked before anything else read the reports. Generated by Squall from synthetic demo data.</p>
</div></body></html>`;
}
