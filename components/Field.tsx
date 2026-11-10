'use client';

import { Html, Line, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { POLICY } from '@/lib/policy';
import type { Incident, RawTicket, TicketRecord } from '@/lib/types';
import { TONE_HEX, incidentTone, pct, ticketTone } from '@/lib/ui';

/**
 * The pressure field. Every ticket is a drop that falls in while Clocked reads it.
 * Drops that Compare reads as the same fault orbit together as a cell. The column at
 * a cell's centre is Decide's probability of a major incident, and the two rings it
 * climbs through are the policy lines: ask a person, and declare without one.
 */

const COLUMN = 3.2; // world height of probability 1
const HELD_AT = new THREE.Vector3(-5.0, 0.2, 4.2);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

const SEATS: [number, number][] = [
  [-1.5, 0.5],
  [2.1, -1.1],
  [1.2, 2.3],
  [-2.4, -2.2],
  [3.6, 1.6],
  [-3.7, 1.9],
];

function cellCentre(index: number): THREE.Vector3 {
  const seat = SEATS[index];
  if (seat) return new THREE.Vector3(seat[0], 0, seat[1]);
  const a = index * 2.399;
  return new THREE.Vector3(Math.cos(a) * 4.4, 0, Math.sin(a) * 3.6);
}

const cellRadius = (n: number) => 0.55 + 0.19 * Math.sqrt(Math.max(1, n));

/** Where every drop currently is, so links between drops can follow them. */
type Registry = Map<string, THREE.Vector3>;

type DropProps = {
  registry: Registry;
  id: string;
  tone: string;
  kind: 'pending' | 'alone' | 'held' | 'joined';
  centre: THREE.Vector3 | null;
  slot: number;
  selected: boolean;
  still: boolean;
  conflict: boolean;
  onSelect: () => void;
};

function Drop({ registry, id, tone, kind, centre, slot, selected, still, conflict, onSelect }: DropProps) {
  const ref = useRef<THREE.Group>(null);
  const [hover, setHover] = useState(false);
  const seed = useMemo(() => hash(id), [id]);
  const start = useMemo(() => {
    const a = seed * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * 2.2, 8.5, Math.sin(a) * 2.2);
  }, [seed]);
  const target = useMemo(() => new THREE.Vector3(), []);
  const color = TONE_HEX[tone] ?? TONE_HEX.mute;

  useFrame((state, dt) => {
    const g = ref.current;
    if (!g) return;
    const t = still ? 0 : state.clock.elapsedTime;
    if (kind === 'pending') {
      target.set(start.x, 3.6 + Math.sin(t * 3 + seed * 6) * 0.12, start.z);
    } else if (kind === 'joined' && centre) {
      const r = 0.5 + 0.19 * Math.sqrt(slot + 0.6);
      const a = slot * 2.399 + t * (0.55 / (0.6 + r));
      target.set(centre.x + Math.cos(a) * r, 0.28 + Math.sin(t * 1.3 + seed * 9) * 0.07, centre.z + Math.sin(a) * r);
    } else if (kind === 'held') {
      const a = seed * Math.PI * 2;
      target.set(HELD_AT.x + Math.cos(a) * 0.35, HELD_AT.y, HELD_AT.z + Math.sin(a) * 0.35);
    } else {
      const a = seed * Math.PI * 2 + t * 0.02;
      const r = 5.2 + ((seed * 7919) % 1) * 1.3;
      target.set(Math.cos(a) * r, 0.16, Math.sin(a) * r * 0.86);
    }
    if (g.userData.fresh !== false) {
      g.position.copy(start);
      g.userData.fresh = false;
    }
    const k = still ? 1 : 1 - Math.exp(-dt * (kind === 'pending' ? 2.2 : 3.2));
    g.position.lerp(target, k);
    registry.set(id, g.position);
    const s = (selected ? 1.9 : hover ? 1.6 : 1) * (kind === 'pending' ? 0.85 : 1);
    g.scale.lerp(new THREE.Vector3(s, s, s), 0.2);
  });

  const bright = kind === 'joined' ? 1.1 : kind === 'pending' ? 0.9 : 0.3;
  return (
    <group
      ref={ref}
      onClick={(e) => {
        e.stopPropagation();
        if (kind !== 'pending') onSelect();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = '';
      }}
    >
      <mesh>
        <sphereGeometry args={[kind === 'held' ? 0.07 : 0.1, 20, 20]} />
        <meshStandardMaterial
          color={kind === 'pending' ? '#eaf2f1' : color}
          emissive={kind === 'pending' ? '#eaf2f1' : color}
          emissiveIntensity={bright}
          roughness={0.35}
          toneMapped={false}
        />
      </mesh>
      {(kind === 'held' || conflict || selected) && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.18, 0.012, 8, 32]} />
          <meshBasicMaterial color={selected ? '#ffffff' : conflict ? TONE_HEX.storm : TONE_HEX.held} toneMapped={false} />
        </mesh>
      )}
      {/* a generous invisible target so drops are easy to hit */}
      <mesh visible={false}>
        <sphereGeometry args={[0.26, 8, 8]} />
      </mesh>
    </group>
  );
}

function Cell({ incident, index, selected, still, onSelect }: { incident: Incident; index: number; selected: boolean; still: boolean; onSelect: () => void }) {
  const centre = useMemo(() => cellCentre(index), [index]);
  const tone = incidentTone(incident);
  const color = TONE_HEX[tone];
  const p = incident.decisions.length ? incident.decisions[incident.decisions.length - 1].pMajor : 0;
  const column = useRef<THREE.Mesh>(null);
  const base = useRef<THREE.Mesh>(null);
  const pulse = useRef<THREE.Mesh>(null);
  const labelAt = useRef<THREE.Group>(null);
  const h = useRef(0.02);
  const rad = useRef(0.6);
  const declared = incident.status === 'declared';
  const dismissed = incident.status === 'dismissed';

  useFrame((state, dt) => {
    const k = still ? 1 : 1 - Math.exp(-dt * 2.4);
    h.current += (Math.max(0.02, p * COLUMN) - h.current) * k;
    rad.current += (cellRadius(incident.memberIds.length) + 0.28 - rad.current) * k;
    if (column.current) {
      column.current.scale.y = h.current;
      column.current.position.y = h.current / 2;
    }
    if (base.current) base.current.scale.setScalar(rad.current);
    if (labelAt.current) labelAt.current.position.y = COLUMN + 0.42;
    if (pulse.current) {
      const m = pulse.current.material as THREE.MeshBasicMaterial;
      if (declared && !still) {
        const t = (state.clock.elapsedTime * 0.45 + index * 0.3) % 1;
        pulse.current.visible = true;
        pulse.current.scale.setScalar(rad.current + t * 1.9);
        m.opacity = (1 - t) * 0.4;
      } else {
        pulse.current.visible = false;
      }
    }
  });

  return (
    <group position={centre}>
      {/* a barometer: the glass tube is probability 1, the fill is Decide's reading */}
      <mesh position={[0, COLUMN / 2, 0]}>
        <cylinderGeometry args={[0.1, 0.1, COLUMN, 24, 1, true]} />
        <meshBasicMaterial color="#b4c6cb" transparent opacity={0.13} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh ref={column}>
        <cylinderGeometry args={[0.062, 0.062, 1, 20]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={dismissed ? 0.15 : 1.25} toneMapped={false} roughness={0.5} />
      </mesh>
      {/* policy lines the column climbs through */}
      {[POLICY.askManager, POLICY.autoDeclare].map((line) => (
        <mesh key={line} position={[0, line * COLUMN, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.2, 0.007, 6, 40]} />
          <meshBasicMaterial color="#eaf2f1" transparent opacity={p >= line ? 0.95 : 0.32} toneMapped={false} />
        </mesh>
      ))}
      <mesh ref={base} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.975, 1, 72]} />
        <meshBasicMaterial color={selected ? '#ffffff' : color} transparent opacity={selected ? 0.95 : 0.7} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh ref={pulse} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} visible={false}>
        <ringGeometry args={[0.985, 1, 72]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh
        position={[0, COLUMN / 2, 0]}
        visible={false}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <cylinderGeometry args={[0.4, 0.4, COLUMN, 8]} />
      </mesh>
      <group ref={labelAt} position={[0, COLUMN + 0.42, 0]}>
        <Html center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`cell-label tone-${tone}`}>
            <b>{incident.decisions.length ? pct(p) : `${incident.memberIds.length}`}</b>
            <span>
              {incident.id}, {incident.memberIds.length} reports
            </span>
          </div>
        </Html>
      </group>
    </group>
  );
}


type LinkSpec = { key: string; a: string; b: string; color: string; lasting: boolean };

/** A line between two drops: a flash when Compare merges them, a standing line when they disagree. */
function Link({ registry, spec, still }: { registry: Registry; spec: LinkSpec; still: boolean }) {
  const born = useRef<number | null>(null);
  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
    const material = new THREE.LineBasicMaterial({ color: spec.color, transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
    return new THREE.Line(geometry, material);
  }, [spec.color]);
  useFrame((state) => {
    const a = registry.get(spec.a);
    const b = registry.get(spec.b);
    const m = line.material as THREE.LineBasicMaterial;
    if (!a || !b) {
      m.opacity = 0;
      return;
    }
    if (born.current === null) born.current = state.clock.elapsedTime;
    const age = state.clock.elapsedTime - born.current;
    m.opacity = spec.lasting ? 0.75 : still ? 0 : Math.max(0, 0.95 - age / 2.6);
    if (m.opacity <= 0) return;
    const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const lift = 0.35 + a.distanceTo(b) * 0.22;
    for (let i = 0; i < 24; i++) {
      const t = i / 23;
      pos.setXYZ(i, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + Math.sin(t * Math.PI) * lift, a.z + (b.z - a.z) * t);
    }
    pos.needsUpdate = true;
  });
  return <primitive object={line} />;
}

/** Light rain over the field while tickets are arriving: the storm is on. */
function Rain({ on, still }: { on: boolean; still: boolean }) {
  const count = 260;
  const points = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (hash(`x${i}`) - 0.5) * 20;
      arr[i * 3 + 1] = hash(`y${i}`) * 9;
      arr[i * 3 + 2] = (hash(`z${i}`) - 0.5) * 16;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const material = new THREE.PointsMaterial({ color: '#b4c6cb', size: 0.035, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true });
    return new THREE.Points(geometry, material);
  }, []);
  useFrame((_, dt) => {
    const m = points.material as THREE.PointsMaterial;
    m.opacity += ((on && !still ? 0.5 : 0) - m.opacity) * Math.min(1, dt * 2);
    if (m.opacity < 0.01) return;
    const pos = points.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      let y = pos.getY(i) - dt * (3.2 + (i % 7) * 0.35);
      if (y < 0) y += 9;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
  });
  return <primitive object={points} />;
}

/** Eases the orbit target toward the selected incident, so declaring one brings it to the middle. */
function Focus({ target }: { target: THREE.Vector3 }) {
  const goal = useMemo(() => new THREE.Vector3(), []);
  useFrame((state, dt) => {
    const controls = state.controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (!controls) return;
    goal.set(target.x * 0.7, 1.1, target.z * 0.7);
    controls.target.lerp(goal, 1 - Math.exp(-dt * 1.6));
  });
  return null;
}

function Ground() {
  const rings = useMemo(
    () =>
      [2, 4, 6, 8].map((r) => {
        const pts: [number, number, number][] = [];
        for (let i = 0; i <= 96; i++) {
          const a = (i / 96) * Math.PI * 2;
          pts.push([Math.cos(a) * r, 0, Math.sin(a) * r * 0.86]);
        }
        return pts;
      }),
    [],
  );
  const spokes = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return [
          [Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6 * 0.86],
          [Math.cos(a) * 8, 0, Math.sin(a) * 8 * 0.86],
        ] as [number, number, number][];
      }),
    [],
  );
  const pen = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push([HELD_AT.x + Math.cos(a) * 0.85, 0.01, HELD_AT.z + Math.sin(a) * 0.85]);
    }
    return pts;
  }, []);
  return (
    <group>
      {rings.map((pts, i) => (
        <Line key={i} points={pts} color="#2e5064" lineWidth={1} transparent opacity={0.75 - i * 0.12} />
      ))}
      {spokes.map((pts, i) => (
        <Line key={i} points={pts} color="#2e5064" lineWidth={1} transparent opacity={0.28} />
      ))}
      <Line points={pen} color="#c9d3d6" lineWidth={1} dashed dashSize={0.12} gapSize={0.1} transparent opacity={0.7} />
      <Html position={[HELD_AT.x, 0.02, HELD_AT.z + 1.15]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
        <div className="cell-label">
          <span>Held by Guard</span>
        </div>
      </Html>
    </group>
  );
}

export type FieldProps = {
  tickets: TicketRecord[];
  pending: RawTicket | null;
  incidents: Incident[];
  selected: { kind: 'incident' | 'ticket'; id: string } | null;
  onSelect: (s: { kind: 'incident' | 'ticket'; id: string }) => void;
  still: boolean;
  /** True while tickets are arriving. */
  raining: boolean;
};

export default function Field({ tickets, pending, incidents, selected, onSelect, still, raining }: FieldProps) {
  const registry = useMemo<Registry>(() => new Map(), []);
  const links = useMemo(() => {
    const out: LinkSpec[] = [];
    for (const t of tickets) {
      if (t.status !== 'joined') continue;
      const best = t.pairs.find((p) => p.relation === 'same' || p.relation === 'conflicting');
      if (best) out.push({ key: `m-${t.id}`, a: t.id, b: best.with, color: '#eaf2f1', lasting: false });
    }
    for (const inc of incidents) for (const c of inc.conflicts) out.push({ key: `c-${c.a}-${c.b}`, a: c.a, b: c.b, color: TONE_HEX.storm, lasting: true });
    return out;
  }, [tickets, incidents]);
  const focusIndex = selected?.kind === 'incident' ? incidents.findIndex((i) => i.id === selected.id) : -1;
  const focus = useMemo(() => (focusIndex >= 0 ? cellCentre(focusIndex) : new THREE.Vector3(0, 0, 0)), [focusIndex]);
  const centres = useMemo(() => incidents.map((_, i) => cellCentre(i)), [incidents.length]);
  // One list, so a drop keeps its place in the scene from the moment it arrives to the moment it settles.
  const drops = useMemo(() => {
    const list: (Pick<TicketRecord, 'id' | 'status' | 'incidentId'> & { reading?: boolean })[] = [...tickets];
    if (pending && !tickets.some((t) => t.id === pending.id)) list.push({ id: pending.id, status: 'alone', incidentId: null, reading: true });
    return list;
  }, [tickets, pending]);
  const conflicted = useMemo(() => new Set(incidents.flatMap((i) => i.conflicts.flatMap((c) => [c.a, c.b]))), [incidents]);
  return (
    <Canvas camera={{ position: [0, 9.2, 15.2], fov: 36 }} dpr={[1, 2]} gl={{ antialias: true, powerPreference: 'high-performance' }}>
      <color attach="background" args={['#0f1e28']} />
      <fog attach="fog" args={['#0f1e28', 13, 27]} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[4, 9, 6]} intensity={1.1} />
      <Ground />
      {incidents.map((inc, i) => (
        <Cell
          key={inc.id}
          incident={inc}
          index={i}
          still={still}
          selected={selected?.kind === 'incident' && selected.id === inc.id}
          onSelect={() => onSelect({ kind: 'incident', id: inc.id })}
        />
      ))}
      {drops.map((t) => {
        const idx = t.incidentId ? incidents.findIndex((i) => i.id === t.incidentId) : -1;
        const inc = idx >= 0 ? incidents[idx] : null;
        const kind = t.reading ? 'pending' : t.status === 'joined' && inc ? 'joined' : t.status === 'held' || t.status === 'unscreened' ? 'held' : 'alone';
        return (
          <Drop
            registry={registry}
            key={t.id}
            id={t.id}
            tone={t.reading ? 'mute' : ticketTone(t as TicketRecord, incidents)}
            kind={kind}
            centre={idx >= 0 ? centres[idx] : null}
            slot={inc ? inc.memberIds.indexOf(t.id) : 0}
            selected={selected?.kind === 'ticket' && selected.id === t.id}
            conflict={conflicted.has(t.id)}
            still={still}
            onSelect={() => onSelect({ kind: 'ticket', id: t.id })}
          />
        );
      })}
      {links.map((l) => (
        <Link key={l.key} registry={registry} spec={l} still={still} />
      ))}
      <Rain on={raining} still={still} />
      <Focus target={focus} />
      <EffectComposer>
        <Bloom luminanceThreshold={0.7} luminanceSmoothing={0.2} intensity={0.55} mipmapBlur />
      </EffectComposer>
      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        minDistance={7}
        maxDistance={24}
        minPolarAngle={0.55}
        maxPolarAngle={1.32}
        autoRotate={!still}
        autoRotateSpeed={0.3}
      />
    </Canvas>
  );
}
