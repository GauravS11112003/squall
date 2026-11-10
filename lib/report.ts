import { KB_BY_ID } from '../data/kb';
import { costOf } from './metrics';
import type { Policy } from './policy';
import { storyOf } from './story';
import type { CallLog, Incident, TicketRecord } from './types';
import { STATUS_WORD, clock, pct } from './format';

/**
 * A post-incident report as Markdown, built from the engine's state. Ticket text is
 * the masked text: nothing Protect hid can reach the report.
 */
export function incidentReport(inc: Incident, tickets: TicketRecord[], incidents: Incident[], calls: CallLog[], P: Policy, source: string): string {
  const members = tickets.filter((t) => t.incidentId === inc.id);
  const events = storyOf(tickets, incidents, P).filter((e) => e.incidentId === inc.id);
  const mine = calls.filter((c) => c.incidentId === inc.id || members.some((m) => m.id === c.ticketId));
  const cost = costOf(mine);
  const v = inc.response?.verification;
  const L: string[] = [];
  L.push(`# Incident report: ${inc.title}`, '');
  L.push(`- **Status:** ${STATUS_WORD[inc.status]}${inc.declaredAt !== null ? `, declared at ${clock(inc.declaredAt)} ${inc.declaredBy === 'manager' ? 'by the incident manager' : 'by policy'}` : ''}`);
  L.push(`- **Reports:** ${members.length}${inc.sites.length ? `, from ${inc.sites.join(', ')}` : ''}`);
  L.push(`- **Service:** ${inc.services.join(', ') || 'not named'}${inc.errors.length ? `. **Error quoted:** ${inc.errors.join(', ')}` : ''}`);
  L.push(`- **Why it is in this status:** ${inc.reason}`);
  L.push(`- **Policy lines in force:** ask a person from ${pct(P.askManager)}, declare from ${pct(P.autoDeclare)}, hold a ticket from ${pct(P.guardHold)} injection`);
  L.push(`- **Source of every judgement:** ${source}`, '');
  L.push('## Timeline', '');
  for (const e of events) L.push(`- **${clock(e.at)}** ${e.title}. ${e.detail}`);
  L.push('', '## Decide readings', '', '| Time | Reports | Major incident | Scope | Severity |', '|---|---|---|---|---|');
  for (const d of inc.decisions) L.push(`| ${clock(d.at)} | ${d.size} | ${pct(d.pMajor)} | ${d.scope?.choice.replace(/_/g, ' ') ?? '–'} | ${d.severity ? d.severity.score.toFixed(1) : '–'} |`);
  if (inc.conflicts.length) {
    L.push('', '## Reports that disagree', '');
    for (const c of inc.conflicts) L.push(`- ${c.a}: "${c.aQuote}" against ${c.b}: "${c.bQuote}" (Compare, ${pct(c.confidence)})`);
  }
  if (inc.response) {
    L.push('', '## Workaround', '');
    for (const p of inc.response.passages.filter((x) => x.selected || x.blocked)) {
      const k = KB_BY_ID[p.id];
      L.push(`- **${p.id}** ${k?.title ?? ''}: ${p.blocked ? `NOT SENT (${p.blocked === 'script' ? `Inspect ${pct(p.script?.malicious)} malicious` : p.blocked === 'injection' ? `Guard ${pct(p.guard?.injection)} injection` : 'safety check failed'})` : 'sent'}. Rerank ${pct(p.relevance)} relevant.`);
    }
    if (inc.response.error) L.push('', `> ${inc.response.error}`);
  }
  if (v) {
    L.push('', '## Company update', '', `> ${v.draft}`, '', `Verify: ${pct(v.grounded)} grounded. ${v.sendable ? 'Every counted claim is supported.' : 'Blocked: at least one claim is not supported.'}`, '');
    for (const c of v.claims) L.push(`- ${c.counted ? (c.supported >= P.claimSupport ? 'Supported' : 'NOT supported') : 'Not a claim'} (${pct(c.supported)}): ${c.claim}${c.source ? ` [${c.source}]` : ''}`);
  }
  L.push('', '## Reports', '', 'Personal data was masked by Protect before anything else read these.', '');
  for (const t of members) L.push(`- **${t.id}** ${clock(t.at)}, ${t.from}: ${t.masked ?? ''}`);
  L.push('', '## Clocked usage for this incident', '', `${cost.calls} calls, ${cost.failed} failed, ${cost.credits} credits, median model time ${cost.medianModelMs === null ? 'n/a' : `${Math.round(cost.medianModelMs)} ms`}.`, '');
  return L.join('\n');
}
