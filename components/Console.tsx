'use client';

import { ChartNoAxesColumn, Play } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STORM } from '@/data/storm';
import { costOf } from '@/lib/metrics';
import { applyStep, priorOf } from '@/lib/run';
import type { StormState } from '@/lib/run';
import type { CallLog, Incident, Mode, RawTicket, Recording, StepOutput } from '@/lib/types';
import { incidentTone, pct } from '@/lib/ui';
import { Dock } from './Dock';
import { IncidentCard } from './IncidentCard';
import { Scoreboard } from './Scoreboard';
import { Stream } from './Stream';
import { TicketCard } from './TicketCard';

const Stage = dynamic(() => import('./Stage'), { ssr: false });

type Selection = { kind: 'incident' | 'ticket'; id: string } | null;
type Status = { live: boolean; sim: boolean; needsCode: boolean };

const EMPTY: StormState = { tickets: [], incidents: [], calls: [] };
const sleep = (n: number) => new Promise((r) => setTimeout(r, n));

function Logo() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3a9 9 0 1 0 9 9" stroke="#0a0f1c" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M12 7.5a4.5 4.5 0 1 0 4.5 4.5" stroke="#2563ff" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.4" fill="#0a0f1c" />
    </svg>
  );
}

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
  const [flash, setFlash] = useState(0);

  // The run loop reads the latest values through a ref, so it never works from a stale render.
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

  /** Bring an incident into view when it first forms or first needs attention. */
  const follow = useCallback((before: Incident[], after: Incident[]) => {
    for (const inc of after) {
      const was = before.find((i) => i.id === inc.id);
      const escalated = was && was.status !== inc.status && (inc.status === 'declared' || inc.status === 'review');
      if (escalated && inc.status === 'declared') setFlash((n) => n + 1);
      if (!was || escalated) {
        setSelected((cur) => (cur?.kind === 'ticket' && !escalated ? cur : { kind: 'incident', id: inc.id }));
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
      const steps = ref.current.mode === 'replay' ? recording?.steps ?? [] : null;
      const total = steps ? steps.length : STORM.length;
      if (i >= total) {
        setBoard(true);
        break;
      }
      if (steps) {
        const out = steps[i];
        setPending(out.ticket);
        await sleep(Math.max(200, 760 / ref.current.speed));
        if (ref.current.token !== token) return;
        setPending(null);
        absorb(out);
        await sleep(Math.max(140, 640 / ref.current.speed));
      } else {
        const ok = await liveStep(STORM[i]);
        if (ref.current.token !== token) return;
        if (!ok) break;
        await sleep(Math.max(60, 380 / ref.current.speed));
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
      const s = ref.current.state;
      const last = s.tickets[s.tickets.length - 1];
      const n = s.tickets.filter((t) => t.id.startsWith('T-9')).length + 1;
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

  const now = pending?.at ?? (state.tickets.length ? state.tickets[state.tickets.length - 1].at : 0);

  const declare = useCallback(
    async (inc: Incident) => {
      const saved = ref.current.mode === 'replay' ? recording?.actions?.find((a) => a.incidentId === inc.id) : null;
      if (saved) {
        replaceIncident({ ...saved.incident, declaredAt: now }, saved.calls);
        setFlash((n) => n + 1);
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
        setFlash((n) => n + 1);
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
        if (!res.ok) return data?.error ?? 'Verify did not answer. The edited update is unchecked and cannot be sent.';
        replaceIncident({ ...inc, response: { ...inc.response!, verification: data.verification, error: null } }, data.calls);
        setSent((x) => {
          const { [inc.id]: _, ...rest } = x;
          return rest;
        });
        return null;
      } catch {
        return 'The server could not be reached. The edited update is unchecked and cannot be sent.';
      } finally {
        setBusy(null);
      }
    },
    [headers, now, replaceIncident],
  );

  const plan: RawTicket[] = useMemo(() => (mode === 'replay' && recording ? recording.steps.map((s) => s.ticket) : STORM), [mode, recording]);
  const done = plan.length > 0 && cursor >= plan.length;
  const incident = selected?.kind === 'incident' ? state.incidents.find((i) => i.id === selected.id) : undefined;
  const ticket = selected?.kind === 'ticket' ? state.tickets.find((t) => t.id === selected.id) : undefined;
  const liveReady = Boolean(status?.live && (!status.needsCode || code.trim()));
  const canLive = mode === 'live' ? liveReady : mode === 'sim';
  const canRun = Boolean(mode) && (mode !== 'live' || liveReady);
  const started = state.tickets.length > 0 || pending !== null;
  const simulated = mode === 'sim' || (mode === 'replay' && recording?.meta.mode !== 'live');
  const cost = useMemo(() => costOf(state.calls), [state.calls]);
  const modes = useMemo(() => {
    const list: { id: Mode; word: string }[] = [];
    if (status?.live) list.push({ id: 'live', word: 'Live' });
    if (recording) list.push({ id: 'replay', word: 'Recorded' });
    if (status?.sim) list.push({ id: 'sim', word: 'Simulator' });
    return list;
  }, [status, recording]);
  const source = simulated
    ? { tone: 'red', word: 'Simulator, not Clocked', title: 'Keyword rules stand in for the API so the app can be developed without a key. None of these numbers are real.' }
    : mode === 'replay' && recording
      ? { tone: 'blue', word: `Recorded live run, ${new Date(recording.meta.recordedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`, title: 'Every probability, quote, timing and credit count is an unedited Clocked API answer.' }
      : mode === 'live'
        ? { tone: 'green', word: 'Live on the Clocked API', title: 'Every ticket is read by Clocked as you watch.' }
        : null;

  return (
    <>
      <div className="stage">
        <Stage tickets={state.tickets} pending={pending} incidents={state.incidents} selected={selected} onSelect={setSelected} still={still} idle={!started} />
        <div key={flash} className={`stage-flash ${flash ? 'on' : ''}`} />
      </div>

      <header className="top">
        <div className="brand">
          <Logo />
          Squall
        </div>
        {source && (
          <span className={`pill t-${source.tone} hide-s`} title={source.title}>
            <span className="live" />
            {source.word}
          </span>
        )}
        <div className="spacer" />
        {started && (
          <span className="pill hide-s" title="Summed from the X-Clocked headers on every call">
            <b>{cost.calls}</b> calls
            <i />
            <b>{cost.medianModelMs === null ? '–' : Math.round(cost.medianModelMs)} ms</b> median
            {!simulated && (
              <>
                <i />
                <b>{cost.credits.toLocaleString()}</b> credits
              </>
            )}
          </span>
        )}
        {done && (
          <button className="pill" type="button" onClick={() => setBoard(true)}>
            <ChartNoAxesColumn size={15} /> <b>Score</b>
          </button>
        )}
        {modes.length > 1 && (
          <div className="seg" role="group" aria-label="Where the answers come from">
            {modes.map((m) => (
              <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => mode !== m.id && reset(m.id)}>
                {m.word}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className={`intro ${started ? 'gone' : ''}`} aria-hidden={started}>
        <h1 className="rise">See the outage in the tickets.</h1>
        {mode ? (
          <>
            <p className="rise d1">
              When a service fails, people report it in dozens of different ways. Squall reads every ticket as it lands, groups the ones that mean the same thing, and raises the major incident while it is still forming.
            </p>
            <div className="go rise d2">
              <button className="btn ink big" type="button" onClick={run} disabled={!canRun} tabIndex={started ? -1 : 0}>
                <Play size={17} fill="currentColor" /> Start the storm
              </button>
              <small>
                {mode === 'live'
                  ? `${STORM.length} synthetic tickets, read live by the Clocked API. About 3,000 credits.`
                  : mode === 'replay'
                    ? `${plan.length} synthetic tickets, replayed from a live Clocked run.`
                    : `${STORM.length} synthetic tickets, answered by the offline simulator.`}
              </small>
            </div>
          </>
        ) : status ? (
          <p className="rise d1">
            This server has no Clocked key and no recorded run yet. Copy <code>.env.local.example</code> to <code>.env.local</code>, add your <code>CLOCKED_API_KEY</code>, and restart <code>npm run dev</code>.
          </p>
        ) : null}
      </div>

      {mode === 'live' && status?.needsCode && !started && (
        <div className="notice glass">
          <label htmlFor="code">
            <b>Live mode spends Clocked credits,</b> so this site asks for an access code.
          </label>
          <input id="code" type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Access code" autoComplete="off" />
        </div>
      )}
      {error && (
        <div className="notice glass bad" role="alert">
          <b>The storm stopped.</b> {error} Nothing was grouped on a guess. Press play to retry this ticket.
        </div>
      )}

      <Stream
        tickets={state.tickets}
        pending={pending}
        incidents={state.incidents}
        selectedId={ticket?.id ?? null}
        onSelect={setSelected}
        total={plan.length}
        canFile={canLive}
        busy={busy !== null || running}
        onFile={file}
        away={!started}
      />

      <section className={`card glass ${incident || ticket ? '' : 'away'}`} aria-label="Detail">
        {state.incidents.length > 1 && !ticket && (
          <div className="switch" role="tablist" aria-label="Incidents">
            {state.incidents.map((i) => {
              const last = i.decisions[i.decisions.length - 1];
              return (
                <button key={i.id} role="tab" type="button" className={`t-${incidentTone(i)}`} aria-selected={incident?.id === i.id} onClick={() => setSelected({ kind: 'incident', id: i.id })}>
                  <span className="dot" />
                  {i.services[0] ?? i.id}
                  <span style={{ color: 'var(--ink-3)', fontWeight: 500 }}>{last ? pct(last.pMajor) : i.memberIds.length}</span>
                </button>
              );
            })}
          </div>
        )}
        {ticket ? (
          <TicketCard ticket={ticket} incidents={state.incidents} calls={state.calls} onSelect={setSelected} />
        ) : incident ? (
          <IncidentCard
            key={incident.id}
            incident={incident}
            tickets={state.tickets}
            mode={mode ?? 'replay'}
            busy={busy}
            canAct={canLive || Boolean(mode === 'replay' && recording?.actions?.some((a) => a.incidentId === incident.id))}
            canEdit={canLive}
            sent={sent[incident.id] ?? null}
            onSelect={setSelected}
            onDeclare={() => declare(incident)}
            onDismiss={() => dismiss(incident)}
            onVerify={(d) => verify(incident, d)}
            onSend={() => setSent((x) => ({ ...x, [incident.id]: { at: now, to: incident.memberIds.length } }))}
          />
        ) : null}
      </section>

      <Dock
        plan={plan}
        tickets={state.tickets}
        incidents={state.incidents}
        now={now}
        running={running}
        done={done}
        canRun={canRun}
        speed={speed}
        selectedId={ticket?.id ?? null}
        onPlay={run}
        onPause={pause}
        onReset={() => reset()}
        onSpeed={setSpeed}
        onSelect={setSelected}
        away={!started}
      />

      {board && mode && <Scoreboard tickets={state.tickets} incidents={state.incidents} calls={state.calls} mode={mode} simulated={simulated} onClose={() => setBoard(false)} />}
    </>
  );
}
