'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STORM } from '@/data/storm';
import { applyStep, priorOf } from '@/lib/run';
import type { StormState } from '@/lib/run';
import type { CallLog, Incident, Mode, RawTicket, Recording, StepOutput } from '@/lib/types';
import { Icon, STATUS_WORD, TONE_HEX, clock, incidentTone, pct } from '@/lib/ui';
import { CallStrip, Feed, IncidentPane, Scoreboard, TicketPane } from './Panes';

const Field = dynamic(() => import('./Field'), { ssr: false });

type Selection = { kind: 'incident' | 'ticket'; id: string } | null;
type Status = { live: boolean; sim: boolean; needsCode: boolean };

const EMPTY: StormState = { tickets: [], incidents: [], calls: [] };
const sleep = (n: number) => new Promise((r) => setTimeout(r, n));

export default function Console() {
  const [status, setStatus] = useState<Status | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [code, setCode] = useState('');
  const [state, setState] = useState<StormState>(EMPTY);
  const [cursor, setCursor] = useState(0);
  const [pending, setPending] = useState<RawTicket | null>(null);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<Selection>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, { at: number; to: number }>>({});
  const [board, setBoard] = useState(false);
  const [still, setStill] = useState(false);

  // The run loop reads the latest values through refs so it never works from a stale render.
  const ref = useRef({ state, cursor, running: false, speed, mode, code, token: 0 });
  ref.current.speed = speed;
  ref.current.mode = mode;
  ref.current.code = code;

  const commit = useCallback((next: StormState) => {
    ref.current.state = next;
    setState(next);
  }, []);

  useEffect(() => {
    setStill(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    let alive = true;
    (async () => {
      const [s, r] = await Promise.all([
        fetch('/api/status').then((x) => x.json()).catch(() => ({ live: false, sim: false, needsCode: false })),
        fetch('/recordings/latest.json').then((x) => (x.ok ? x.json() : null)).catch(() => null),
      ]);
      if (!alive) return;
      setStatus(s);
      setRecording(r && Array.isArray(r.steps) && r.steps.length ? r : null);
      setMode(s.live && !s.needsCode ? 'live' : r ? 'replay' : s.sim ? 'sim' : s.live ? 'live' : null);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const headers = useCallback(() => {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (ref.current.code) h['x-squall-code'] = ref.current.code;
    return h;
  }, []);

  /** Auto-follow: bring an incident into view when it first needs attention. */
  const follow = useCallback((before: Incident[], after: Incident[]) => {
    for (const inc of after) {
      const was = before.find((i) => i.id === inc.id);
      if (!was || (was.status !== inc.status && (inc.status === 'declared' || inc.status === 'review'))) {
        setSelected((cur) => (cur?.kind === 'ticket' && was ? cur : { kind: 'incident', id: inc.id }));
        return;
      }
    }
  }, []);

  const absorb = useCallback(
    (out: StepOutput) => {
      const before = ref.current.state.incidents;
      commit(applyStep(ref.current.state, out));
      follow(before, out.incidents);
    },
    [commit, follow],
  );

  const liveStep = useCallback(
    async (ticket: RawTicket): Promise<boolean> => {
      setPending(ticket);
      try {
        const res = await fetch('/api/step', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ ticket, incidents: ref.current.state.incidents, prior: priorOf(ref.current.state) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? `The server answered ${res.status}.`);
        absorb(data as StepOutput);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setPending(null);
      }
    },
    [absorb, headers],
  );

  const run = useCallback(async () => {
    if (ref.current.running) return;
    const token = ++ref.current.token;
    ref.current.running = true;
    setRunning(true);
    setError(null);
    while (ref.current.running && ref.current.token === token) {
      const i = ref.current.cursor;
      const m = ref.current.mode;
      const steps = m === 'replay' ? recording?.steps ?? [] : null;
      const total = steps ? steps.length : STORM.length;
      if (i >= total) {
        setBoard(true);
        break;
      }
      if (steps) {
        const out = steps[i];
        setPending(out.ticket);
        await sleep(Math.max(180, 620 / ref.current.speed));
        if (ref.current.token !== token) return;
        setPending(null);
        absorb(out);
        await sleep(Math.max(120, 520 / ref.current.speed));
      } else {
        const ok = await liveStep(STORM[i]);
        if (ref.current.token !== token) return;
        if (!ok) break;
        await sleep(Math.max(60, 320 / ref.current.speed));
      }
      if (ref.current.token !== token) return;
      ref.current.cursor = i + 1;
      setCursor(i + 1);
    }
    if (ref.current.token === token) {
      ref.current.running = false;
      setRunning(false);
    }
  }, [absorb, liveStep, recording]);

  const pause = useCallback(() => {
    ref.current.running = false;
    setRunning(false);
  }, []);

  const reset = useCallback(
    (nextMode?: Mode) => {
      ref.current.token++;
      ref.current.running = false;
      ref.current.cursor = 0;
      setRunning(false);
      setCursor(0);
      setPending(null);
      setSelected(null);
      setError(null);
      setBusy(null);
      setSent({});
      setBoard(false);
      commit(EMPTY);
      if (nextMode) setMode(nextMode);
    },
    [commit],
  );

  const file = useCallback(
    async (text: string) => {
      const last = ref.current.state.tickets[ref.current.state.tickets.length - 1];
      const n = ref.current.state.tickets.filter((t) => t.id.startsWith('T-9')).length + 1;
      setBusy('file');
      const ticket: RawTicket = { id: `T-9${String(n).padStart(3, '0')}`, at: (last?.at ?? 0) + 5, from: 'Filed by you', channel: 'portal', text };
      const ok = await liveStep(ticket);
      setBusy(null);
      if (ok) setSelected({ kind: 'ticket', id: ticket.id });
    },
    [liveStep],
  );

  const replaceIncident = useCallback(
    (inc: Incident, calls: CallLog[]) => {
      const s = ref.current.state;
      const reply = inc.response?.reply?.passageIds;
      commit({
        tickets: reply ? s.tickets.map((t) => (t.incidentId === inc.id && !t.sent.length ? { ...t, sent: reply } : t)) : s.tickets,
        incidents: s.incidents.map((i) => (i.id === inc.id ? inc : i)),
        calls: [...s.calls, ...calls],
      });
    },
    [commit],
  );

  const now = state.tickets.length ? state.tickets[state.tickets.length - 1].at : 0;

  const declare = useCallback(
    async (inc: Incident) => {
      const saved = ref.current.mode === 'replay' ? recording?.actions?.find((a) => a.incidentId === inc.id) : null;
      if (saved) {
        replaceIncident({ ...saved.incident, declaredAt: now }, saved.calls);
        return;
      }
      setBusy('declare');
      setError(null);
      try {
        const members = priorOf(ref.current.state).filter((p) => p.incidentId === inc.id);
        const res = await fetch('/api/declare', { method: 'POST', headers: headers(), body: JSON.stringify({ incident: inc, members, at: now }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? `The server answered ${res.status}.`);
        replaceIncident(data.incident, data.calls);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [headers, now, recording, replaceIncident],
  );

  const dismiss = useCallback(
    (inc: Incident) => {
      const s = ref.current.state;
      commit({ ...s, incidents: s.incidents.map((i) => (i.id === inc.id ? { ...i, status: 'dismissed' as const, reason: 'Dismissed by the incident manager. New tickets are no longer matched to it.' } : i)) });
    },
    [commit],
  );

  const verify = useCallback(
    async (inc: Incident, draft: string): Promise<string | null> => {
      setBusy('verify');
      try {
        const members = ref.current.state.tickets.filter((t) => t.incidentId === inc.id && t.masked).map((t) => ({ id: t.id, masked: t.masked! }));
        const res = await fetch('/api/verify', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ draft, members, passageIds: inc.response?.reply?.passageIds ?? [], incidentId: inc.id, at: now }),
        });
        const data = await res.json();
        if (!res.ok) return data?.error ?? 'Verify did not answer. The edited draft is unchecked and cannot be sent.';
        replaceIncident({ ...inc, response: { ...inc.response!, verification: data.verification, error: null } }, data.calls);
        setSent((x) => {
          const { [inc.id]: _, ...rest } = x;
          return rest;
        });
        return null;
      } catch {
        return 'The server could not be reached. The edited draft is unchecked and cannot be sent.';
      } finally {
        setBusy(null);
      }
    },
    [headers, now, replaceIncident],
  );

  const total = mode === 'replay' ? recording?.steps.length ?? 0 : STORM.length;
  const done = total > 0 && cursor >= total;
  const incident = selected?.kind === 'incident' ? state.incidents.find((i) => i.id === selected.id) : undefined;
  const ticket = selected?.kind === 'ticket' ? state.tickets.find((t) => t.id === selected.id) : undefined;
  const liveReady = Boolean(status?.live && (!status.needsCode || code.trim()));
  const canLive = mode === 'live' ? liveReady : mode === 'sim';
  const started = state.tickets.length > 0 || pending !== null;
  const modes = useMemo(() => {
    const list: { id: Mode; word: string; ok: boolean }[] = [];
    if (status?.live) list.push({ id: 'live', word: 'Live', ok: true });
    if (recording) list.push({ id: 'replay', word: 'Recorded run', ok: true });
    if (status?.sim) list.push({ id: 'sim', word: 'Simulator', ok: true });
    return list;
  }, [status, recording]);

  return (
    <div className="shell">
      <header className="bar">
        <div className="mark">
          <b>Squall</b>
          <span>sees the outage in the tickets</span>
        </div>
        <div className="grow" />
        <div className="readout" aria-live="off">
          <span className="clock" title="Time inside the storm">
            {clock(pending?.at ?? now)}
          </span>
          <span className="wide">
            <b>{state.incidents.filter((i) => i.status === 'declared').length}</b> major, <b>{state.incidents.filter((i) => i.status === 'review').length}</b> awaiting you
          </span>
        </div>
        {modes.length > 1 && (
          <div className="seg" role="group" aria-label="Where the answers come from">
            {modes.map((m) => (
              <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => mode !== m.id && reset(m.id)}>
                {m.word}
              </button>
            ))}
          </div>
        )}
        <div className="seg" role="group" aria-label="Speed">
          {[1, 2, 4].map((s) => (
            <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        {running ? (
          <button className="btn" type="button" onClick={pause}>
            {Icon.pause} Pause
          </button>
        ) : (
          <button className="btn primary" type="button" onClick={run} disabled={!mode || done || (mode === 'live' && !liveReady)}>
            {Icon.play} {started ? (done ? 'Storm finished' : 'Resume') : 'Start the storm'}
          </button>
        )}
        <button className="btn quiet" type="button" onClick={() => reset()} disabled={!started} aria-label="Reset the storm">
          {Icon.reset}
        </button>
      </header>

      <main className="main">
        <Feed
          tickets={state.tickets}
          pending={pending}
          incidents={state.incidents}
          selectedId={ticket?.id ?? null}
          onSelect={setSelected}
          canFile={canLive}
          busy={busy !== null || running}
          onFile={file}
          total={total}
        />

        <section className="centre" aria-label="Storm field">
          <div className="field-wrap">
            <Field tickets={state.tickets} pending={pending} incidents={state.incidents} selected={selected} onSelect={setSelected} still={still} raining={running || pending !== null} />
          </div>

          <div className="overlay-top">
            <div className="legend" aria-label="What the colours mean">
              <div>
                <span className="dot" style={{ background: TONE_HEX.calm }} /> Watching
              </div>
              <div>
                <span className="dot" style={{ background: TONE_HEX.shower }} /> Needs your call
              </div>
              <div>
                <span className="dot" style={{ background: TONE_HEX.squall }} /> Major incident
              </div>
              <div>
                <span className="dot" style={{ background: TONE_HEX.mute }} /> On its own
              </div>
            </div>
            <div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
              {mode === 'replay' && recording && (
                <div className="banner">
                  <b>Recorded run.</b> Every probability, quote, timing and credit count here is an unedited Clocked answer, recorded {new Date(recording.meta.recordedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.
                </div>
              )}
              {mode === 'sim' && (
                <div className="banner bad">
                  <b>Offline simulator, not Clocked.</b> Keyword rules stand in for the API so the app can be developed without a key. None of these numbers are real.
                </div>
              )}
              {mode === 'live' && status?.needsCode && (
                <div className="banner field">
                  <label htmlFor="code">
                    <b>Live mode spends Clocked credits,</b> so this deployment asks for an access code.
                  </label>
                  <input id="code" type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Access code" style={{ marginTop: 8 }} autoComplete="off" />
                </div>
              )}
              {error && (
                <div className="banner bad" role="alert">
                  <b>The storm stopped.</b> {error} Nothing was grouped on a guess. Press Resume to retry this ticket.
                </div>
              )}
              {done && !board && (
                <button className="btn" type="button" onClick={() => setBoard(true)}>
                  See how the run scored
                </button>
              )}
            </div>
          </div>

          {!started && (
            <div className="start">
              <div className="start-card">
                <h1>Forty people are about to report the same outage in forty different ways.</h1>
                {mode ? (
                  <>
                    <p>
                      Squall reads each ticket as it lands, groups the ones that describe the same fault, and raises the major incident while it is still forming. Every judgement comes from the Clocked API, with its probability and the words it rests on.
                    </p>
                    <div className="actions">
                      <button className="btn primary" type="button" onClick={run} disabled={mode === 'live' && !liveReady}>
                        {Icon.play} Start the storm
                      </button>
                      <span style={{ color: 'var(--chalk-3)', fontSize: 13 }}>
                        {mode === 'live' ? `${STORM.length} synthetic tickets, read live. Uses roughly 3,000 credits.` : mode === 'replay' ? `${total} synthetic tickets, replayed from a live run.` : 'Simulated answers.'}
                      </span>
                    </div>
                  </>
                ) : status ? (
                  <p>
                    This server has no Clocked key and no recorded run yet. Copy <code>.env.local.example</code> to <code>.env.local</code>, add your <code>CLOCKED_API_KEY</code> and restart <code>npm run dev</code>.
                  </p>
                ) : (
                  <p>Checking what this server can do.</p>
                )}
              </div>
            </div>
          )}

          {board && mode && <Scoreboard tickets={state.tickets} incidents={state.incidents} calls={state.calls} mode={mode} onClose={() => setBoard(false)} />}
          <CallStrip calls={state.calls} mode={mode} />
        </section>

        <section className="pane right" aria-label="Incident detail">
          {state.incidents.length > 0 && (
            <>
              <div className="pane-head">
                <h2>Incidents</h2>
                <small>{state.incidents.length} forming or open</small>
              </div>
              <div className="tabs" role="tablist">
                {state.incidents.map((i) => {
                  const tone = incidentTone(i);
                  const last = i.decisions[i.decisions.length - 1];
                  return (
                    <button
                      key={i.id}
                      role="tab"
                      type="button"
                      className={`tab tone-${tone}`}
                      aria-selected={incident?.id === i.id}
                      onClick={() => setSelected({ kind: 'incident', id: i.id })}
                    >
                      <b>
                        <span className="dot" /> {i.id}
                        <span style={{ marginLeft: 'auto', color: 'var(--chalk-2)' }}>{last ? pct(last.pMajor) : `${i.memberIds.length}`}</span>
                      </b>
                      <span>{i.status === 'watching' ? i.title : STATUS_WORD[i.status]}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div className="scroll">
            {ticket ? (
              <TicketPane ticket={ticket} incidents={state.incidents} calls={state.calls} onSelect={setSelected} />
            ) : incident ? (
              <IncidentPane
                key={incident.id}
                incident={incident}
                tickets={state.tickets}
                mode={mode ?? 'replay'}
                busy={busy}
                canAct={canLive || Boolean(mode === 'replay' && recording?.actions?.some((a) => a.incidentId === incident.id))}
                sent={sent[incident.id] ?? null}
                onSelect={setSelected}
                onDeclare={() => declare(incident)}
                onDismiss={() => dismiss(incident)}
                onVerify={(d) => verify(incident, d)}
                onSend={() => setSent((x) => ({ ...x, [incident.id]: { at: now, to: incident.memberIds.length } }))}
              />
            ) : (
              <div className="empty">
                <b>Nothing has formed yet</b>
                <span>
                  When two tickets report the same fault they become a cell in the field and an incident here. From {3} reports Squall asks Clocked how likely it is to be a major incident.
                </span>
                <span>Select any drop in the field or any ticket on the left to see exactly what Clocked read and decided.</span>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
