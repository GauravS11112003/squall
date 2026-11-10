import type { Api } from './api';
import { step, toPrior } from './engine';
import type { CallLog, Incident, KbPassage, RawTicket, StepOutput, TicketRecord } from './types';

export type StormState = { tickets: TicketRecord[]; incidents: Incident[]; calls: CallLog[] };

/** Folds one engine step into the running state. The browser and the scripts share this. */
export function applyStep(state: StormState, out: StepOutput): StormState {
  const tickets = state.tickets.map((t) => {
    const m = out.moved.find((x) => x.id === t.id);
    // an outcome starting with + adds to what is already known about the ticket; anything else replaces it
    return m ? { ...t, incidentId: m.incidentId, status: 'joined' as const, outcome: m.outcome.startsWith('+') ? `${t.outcome} ${m.outcome.slice(1)}` : m.outcome, sent: m.sent } : t;
  });
  const i = tickets.findIndex((t) => t.id === out.ticket.id);
  if (i >= 0) tickets[i] = out.ticket;
  else tickets.push(out.ticket);
  return { tickets, incidents: out.incidents, calls: [...state.calls, ...out.calls] };
}

export function priorOf(state: StormState) {
  return state.tickets.filter((t) => t.masked !== null && t.status !== 'held' && t.status !== 'unscreened').map(toPrior);
}

/** Runs a list of tickets through the engine in order. Used by the evaluation script and the tests. */
export async function runStorm(
  tickets: RawTicket[],
  api: Api,
  kb: KbPassage[],
  onStep?: (out: StepOutput, state: StormState) => void,
  policy?: import('./policy').PolicyOverrides,
): Promise<StormState & { steps: StepOutput[] }> {
  let state: StormState = { tickets: [], incidents: [], calls: [] };
  const steps: StepOutput[] = [];
  for (const ticket of tickets) {
    const out = await step({ ticket, incidents: state.incidents, prior: priorOf(state), policy }, api, kb);
    state = applyStep(state, out);
    steps.push(out);
    onStep?.(out, state);
  }
  return { ...state, steps };
}
