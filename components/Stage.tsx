'use client';

import { Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Policy } from '@/lib/policy';
import type { Incident, RawTicket, TicketRecord } from '@/lib/types';
import { incidentTone, pct } from '@/lib/ui';

/**
 * The stage. Each incident is a hurricane drawn from a few thousand particles in a
 * vertex shader. It grows with every report Compare merges into it, spins faster as
 * Decide's probability rises, and changes colour with its state. The ink dots riding
 * inside it are the real tickets. The ring on the floor is the probability, with a
 * notch at each policy line.
 */

type Sel = { kind: 'incident' | 'ticket'; id: string };

const PARTICLES = 16000;
const INK = '#0a0f1c';

const PALETTE: Record<string, [string, string]> = {
  blue: ['#1d4ed8', '#8fb2ff'],
  amber: ['#e07a00', '#ffcc66'],
  red: ['#e11d48', '#ff8f6b'],
  slate: ['#7b8496', '#c9ced8'],
};

const SEATS: [number, number][] = [
  [-1.9, 0.3],
  [2.3, -1.7],
  [1.1, 2.7],
  [-0.5, -4.3],
  [4.6, 1.9],
  [-4.9, 2.6],
];

function seat(index: number): THREE.Vector3 {
  const s = SEATS[index];
  if (s) return new THREE.Vector3(s[0], 0, s[1]);
  const a = index * 2.399;
  return new THREE.Vector3(Math.cos(a) * 6.4, 0, Math.sin(a) * 5.2);
}

const radiusFor = (reports: number) => 0.5 + 0.185 * Math.pow(Math.max(1, reports), 0.8);
const HELD_AT = new THREE.Vector3(-3.7, 0, -3.3);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uRadius;
  uniform float uGrow;
  uniform float uSpeed;
  uniform float uSize;
  uniform float uFlash;
  uniform vec3 uCore;
  uniform vec3 uRim;
  attribute vec4 aData;   // radius 0..1, arm, jitter, height
  attribute vec2 aSeed;   // reveal order, size
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float r = aData.x;
    float ang = aData.y * 3.14159265 + r * 4.3 + aData.z * (0.24 + r * 0.9) + uTime * uSpeed * (1.35 - r * 0.25) + sin(uTime * 0.35 + aSeed.x * 40.0) * 0.06;
    float rr = (0.09 + r * 0.91) * uRadius;
    float wall = exp(-pow((r - 0.1) / 0.22, 2.0));
    float y = aData.w * aData.w * (0.03 + wall * 0.2 + r * 0.1) * uRadius;
    vec3 p = vec3(cos(ang) * rr, y, sin(ang) * rr);
    float vis = step(aSeed.x, uGrow);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.35 + aSeed.y * 0.95) * vis / -mv.z;
    vColor = mix(uCore, uRim, smoothstep(0.0, 0.95, r)) + uFlash;
    vAlpha = vis * mix(0.62, 0.1, pow(r, 0.8)) * (0.6 + 0.4 * aSeed.y);
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

function useHurricaneGeometry() {
  return useMemo(() => {
    const g = new THREE.BufferGeometry();
    const data = new Float32Array(PARTICLES * 4);
    const seed = new Float32Array(PARTICLES * 2);
    // mulberry32: consecutive draws are uncorrelated, so the arms do not band into rings
    let seedState = 0x9e3779b9;
    const rnd = () => {
      seedState = (seedState + 0x6d2b79f5) | 0;
      let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < PARTICLES; i++) {
      data[i * 4] = Math.pow(rnd(), 0.72);
      data[i * 4 + 1] = Math.floor(rnd() * 2);
      data[i * 4 + 2] = rnd() + rnd() + rnd() - 1.5;
      data[i * 4 + 3] = rnd();
      seed[i * 2] = rnd();
      seed[i * 2 + 1] = rnd();
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3));
    g.setAttribute('aData', new THREE.BufferAttribute(data, 4));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
    return g;
  }, []);
}

function useShadowTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    const grd = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(10,15,28,0.55)');
    grd.addColorStop(0.5, 'rgba(10,15,28,0.16)');
    grd.addColorStop(1, 'rgba(10,15,28,0)');
    x.fillStyle = grd;
    x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
}

type Registry = Map<string, THREE.Vector3>;
type Live = Map<string, { radius: number; speed: number }>;

function Hurricane(props: {
  incident: Incident;
  index: number;
  geometry: THREE.BufferGeometry;
  shadow: THREE.Texture;
  live: Live;
  policy: Policy;
  selected: boolean;
  still: boolean;
  onSelect: () => void;
}) {
  const { incident: inc, index, still } = props;
  const centre = useMemo(() => seat(index), [index]);
  const tone = incidentTone(inc);
  const last = inc.decisions[inc.decisions.length - 1];
  const p = last?.pMajor ?? 0;
  const reports = inc.memberIds.length;
  const declared = inc.status === 'declared';
  const wasDeclared = useRef(declared);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime: { value: hash(inc.id) * 40 },
          uRadius: { value: 0.3 },
          uGrow: { value: 0 },
          uSpeed: { value: 0.3 },
          uSize: { value: 30 },
          uFlash: { value: 0 },
          uCore: { value: new THREE.Color(PALETTE.blue[0]) },
          uRim: { value: new THREE.Color(PALETTE.blue[1]) },
        },
      }),
    [inc.id],
  );
  const core = useMemo(() => new THREE.Color(), []);
  const rim = useMemo(() => new THREE.Color(), []);
  const floor = useRef<THREE.Group>(null);
  const shade = useRef<THREE.Mesh>(null);
  const wave = useRef<THREE.Mesh>(null);
  const tag = useRef<THREE.Group>(null);
  const waveAt = useRef(-1);

  useFrame((state, dt) => {
    const u = material.uniforms;
    const k = still ? 1 : 1 - Math.exp(-dt * 2.2);
    const pal = PALETTE[tone === 'slate' ? 'slate' : tone] ?? PALETTE.blue;
    core.set(pal[0]);
    rim.set(pal[1]);
    (u.uCore.value as THREE.Color).lerp(core, k);
    (u.uRim.value as THREE.Color).lerp(rim, k);
    u.uRadius.value += (radiusFor(reports) - u.uRadius.value) * k;
    u.uGrow.value += (Math.min(1, 0.07 + reports / 17) - u.uGrow.value) * k;
    const speed = inc.status === 'dismissed' ? 0.06 : 0.22 + p * 0.55;
    u.uSpeed.value = speed;
    if (!still) u.uTime.value += dt;
    u.uSize.value = 105 * state.gl.getPixelRatio() * (state.size.height / 900);
    if (declared && !wasDeclared.current) {
      u.uFlash.value = 0.7;
      waveAt.current = state.clock.elapsedTime;
    }
    wasDeclared.current = declared;
    u.uFlash.value *= Math.exp(-dt * 2.6);
    const r = u.uRadius.value as number;
    props.live.set(inc.id, { radius: r, speed });
    if (floor.current) floor.current.scale.setScalar(r + 0.22);
    if (shade.current) shade.current.scale.setScalar(r * 3.1);
    if (tag.current) tag.current.position.y = r * 0.5 + 0.75;
    if (wave.current) {
      const m = wave.current.material as THREE.MeshBasicMaterial;
      const age = waveAt.current < 0 ? 9 : state.clock.elapsedTime - waveAt.current;
      const loop = declared && !still ? (state.clock.elapsedTime * 0.3 + index * 0.37) % 1 : 1;
      const t = age < 1.6 ? age / 1.6 : loop;
      wave.current.visible = declared && !still;
      wave.current.scale.setScalar(r + 0.22 + t * (age < 1.6 ? 5 : 1.5));
      m.opacity = (1 - t) * (age < 1.6 ? 0.6 : 0.22);
    }
  });

  const arc = useMemo(() => {
    const len = Math.max(0.0001, Math.min(1, p)) * Math.PI * 2;
    return new THREE.RingGeometry(0.984, 1, 160, 1, Math.PI / 2 - len, len);
  }, [p]);
  useEffect(() => () => arc.dispose(), [arc]);
  const toneHex = PALETTE[tone]?.[0] ?? PALETTE.slate[0];

  return (
    <group position={centre}>
      <mesh ref={shade} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={props.shadow} transparent opacity={0.34} depthWrite={false} toneMapped={false} />
      </mesh>
      <group ref={floor} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
        <mesh>
          <ringGeometry args={[0.99, 1, 160]} />
          <meshBasicMaterial color={INK} transparent opacity={props.selected ? 0.22 : 0.1} depthWrite={false} toneMapped={false} />
        </mesh>
        {last && (
          <mesh geometry={arc}>
            <meshBasicMaterial color={toneHex} transparent opacity={0.95} depthWrite={false} toneMapped={false} />
          </mesh>
        )}
        {[props.policy.askManager, props.policy.autoDeclare].map((line) => {
          const a = Math.PI / 2 - line * Math.PI * 2;
          return (
            <mesh key={line} position={[Math.cos(a) * 1.02, Math.sin(a) * 1.02, 0]} rotation={[0, 0, a]}>
              <planeGeometry args={[0.09, 0.012]} />
              <meshBasicMaterial color={INK} transparent opacity={0.55} toneMapped={false} />
            </mesh>
          );
        })}
      </group>
      <mesh ref={wave} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]} visible={false}>
        <ringGeometry args={[0.99, 1, 128]} />
        <meshBasicMaterial color={toneHex} transparent opacity={0.4} depthWrite={false} toneMapped={false} />
      </mesh>
      <points geometry={props.geometry} material={material} frustumCulled={false} />
      <mesh
        visible={false}
        position={[0, 0.5, 0]}
        onClick={(e) => {
          e.stopPropagation();
          props.onSelect();
        }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <cylinderGeometry args={[radiusFor(reports) * 0.7, radiusFor(reports) * 0.7, 1.2, 12]} />
      </mesh>
      <group ref={tag} position={[0, 1.4, 0]}>
        <Html center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`tag3d t-${tone}`}>
            {last && <b>{pct(p)}</b>}
            <span>
              {inc.services[0] ?? inc.id}, {reports} reports
            </span>
          </div>
        </Html>
      </group>
    </group>
  );
}


/** Before the storm starts: one quiet hurricane behind the headline, so the stage is never empty. */
function Teaser({ geometry, shadow, on, still }: { geometry: THREE.BufferGeometry; shadow: THREE.Texture; on: boolean; still: boolean }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime: { value: 12 },
          uRadius: { value: 4.6 },
          uGrow: { value: on ? 1 : 0 },
          uSpeed: { value: 0.16 },
          uSize: { value: 30 },
          uFlash: { value: 0 },
          uCore: { value: new THREE.Color('#3b6dff') },
          uRim: { value: new THREE.Color('#c4d3f5') },
        },
      }),
    [],
  );
  const shade = useRef<THREE.Mesh>(null);
  useFrame((state, dt) => {
    const u = material.uniforms;
    if (!still) u.uTime.value += dt;
    u.uGrow.value += ((on ? 1 : 0) - u.uGrow.value) * (still ? 1 : 1 - Math.exp(-dt * 2.4));
    u.uSize.value = 105 * state.gl.getPixelRatio() * (state.size.height / 900);
    if (shade.current) (shade.current.material as THREE.MeshBasicMaterial).opacity = 0.3 * u.uGrow.value;
  });
  return (
    <group position={[0, 0, 3.4]}>
      <mesh ref={shade} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} scale={13}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={shadow} transparent opacity={0.3} depthWrite={false} toneMapped={false} />
      </mesh>
      <points geometry={geometry} material={material} frustumCulled={false} />
    </group>
  );
}

type DropKind = 'reading' | 'alone' | 'held' | 'joined';

function Drop(props: {
  registry: Registry;
  live: Live;
  id: string;
  kind: DropKind;
  incidentId: string | null;
  centre: THREE.Vector3 | null;
  slot: number;
  selected: boolean;
  still: boolean;
  onSelect: () => void;
}) {
  const { id, kind, centre, slot, still } = props;
  const ref = useRef<THREE.Group>(null);
  const [hover, setHover] = useState(false);
  const seed = useMemo(() => hash(id), [id]);
  const start = useMemo(() => {
    const a = seed * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * 3, 9, Math.sin(a) * 2.4);
  }, [seed]);
  const target = useMemo(() => new THREE.Vector3(), []);
  const scale = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const phase = useRef(seed * 50);

  useFrame((state, dt) => {
    const g = ref.current;
    if (!g) return;
    const t = still ? 0 : state.clock.elapsedTime;
    if (kind === 'reading') {
      target.set(start.x, 4.2 + Math.sin(t * 2.6 + seed * 6) * 0.14, start.z);
    } else if (kind === 'joined' && centre) {
      const cell = props.incidentId ? props.live.get(props.incidentId) : undefined;
      const R = cell?.radius ?? 1;
      const r = 0.22 + ((slot * 0.618034) % 1) * 0.66;
      if (!still) phase.current += dt * (cell?.speed ?? 0.3) * (1.35 - r * 0.25);
      const a = slot * 2.399 + phase.current;
      target.set(centre.x + Math.cos(a) * r * R, 0.2 + (1 - r) * 0.25, centre.z + Math.sin(a) * r * R);
    } else if (kind === 'held') {
      const a = seed * Math.PI * 2;
      target.set(HELD_AT.x + Math.cos(a) * 0.18, 0.1, HELD_AT.z + Math.sin(a) * 0.18);
    } else {
      const a = seed * Math.PI * 2 + t * 0.015;
      const r = 5.3 + ((seed * 7919) % 1) * 1.5;
      target.set(Math.cos(a) * r, 0.1, Math.sin(a) * r * 0.8);
    }
    if (g.userData.placed !== true) {
      g.position.copy(start);
      g.userData.placed = true;
    }
    g.position.lerp(target, still ? 1 : 1 - Math.exp(-dt * (kind === 'reading' ? 2 : 3)));
    props.registry.set(id, g.position);
    const s = props.selected ? 1.9 : hover ? 1.6 : 1;
    g.scale.lerp(scale.set(s, s, s), 0.22);
  });

  const size = kind === 'alone' ? 0.05 : 0.058;
  return (
    <group
      ref={ref}
      onClick={(e) => {
        e.stopPropagation();
        if (kind !== 'reading') props.onSelect();
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
      {kind === 'held' ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.07, 0.1, 24]} />
          <meshBasicMaterial color="#f0364a" side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      ) : (
        <mesh>
          <sphereGeometry args={[size, 20, 20]} />
          <meshBasicMaterial color={kind === 'alone' ? '#9aa4b5' : INK} toneMapped={false} />
        </mesh>
      )}
      {props.selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.13, 0.155, 32]} />
          <meshBasicMaterial color="#2563ff" side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      )}
      <mesh visible={false}>
        <sphereGeometry args={[0.28, 8, 8]} />
      </mesh>
      {(hover || props.selected) && kind !== 'reading' && (
        <Html center position={[0, 0.34, 0]} zIndexRange={[12, 0]} style={{ pointerEvents: 'none' }}>
          <div className="tag3d">
            <span>{id}</span>
          </div>
        </Html>
      )}
    </group>
  );
}

type LinkSpec = { key: string; a: string; b: string; color: string; lasting: boolean };

/** A flash of ink between two tickets when Compare merges them; an orange line that stays when they disagree. */
function Link({ registry, spec, still }: { registry: Registry; spec: LinkSpec; still: boolean }) {
  const born = useRef<number | null>(null);
  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(28 * 3), 3));
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: spec.color, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
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
    m.opacity = spec.lasting ? 0.85 : still ? 0 : Math.max(0, 0.8 - age / 2.2);
    if (m.opacity <= 0) return;
    const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const lift = 0.3 + a.distanceTo(b) * 0.24;
    for (let i = 0; i < 28; i++) {
      const t = i / 27;
      pos.setXYZ(i, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + Math.sin(t * Math.PI) * lift, a.z + (b.z - a.z) * t);
    }
    pos.needsUpdate = true;
  });
  return <primitive object={line} />;
}

function Floor({ held }: { held: boolean }) {
  const rings = useMemo(
    () =>
      [3.2, 6.4, 9.6].map((r) => {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 128; i++) {
          const a = (i / 128) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r * 0.8));
        }
        return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.07, depthWrite: false }));
      }),
    [],
  );
  const pen = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push(new THREE.Vector3(HELD_AT.x + Math.cos(a) * 0.5, 0.005, HELD_AT.z + Math.sin(a) * 0.5));
    }
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: '#f0364a', dashSize: 0.1, gapSize: 0.09, transparent: true, opacity: 0.8 }));
    l.computeLineDistances();
    return l;
  }, []);
  return (
    <group>
      {rings.map((l, i) => (
        <primitive key={i} object={l} />
      ))}
      {held && (
        <>
          <primitive object={pen} />
          <Html center position={[HELD_AT.x, 0.75, HELD_AT.z]} zIndexRange={[8, 0]} style={{ pointerEvents: 'none' }}>
            <div className="tag3d t-red">
              <span>Held by Guard</span>
            </div>
          </Html>
        </>
      )}
    </group>
  );
}

/** Eases the orbit target toward the selected incident. */
function Focus({ target }: { target: THREE.Vector3 }) {
  const goal = useMemo(() => new THREE.Vector3(), []);
  useFrame((state, dt) => {
    const controls = state.controls as unknown as { target: THREE.Vector3 } | null;
    if (!controls) return;
    goal.set(target.x * 0.35 + 0.55, 0.2, target.z * 0.35 + 0.9);
    controls.target.lerp(goal, 1 - Math.exp(-dt * 1.5));
    // sway, never a full orbit: nothing should end up behind a panel for long
    const c = controls as unknown as { getAzimuthalAngle: () => number; autoRotateSpeed: number };
    const az = c.getAzimuthalAngle();
    if (az > 0.38) c.autoRotateSpeed = 0.22;
    else if (az < -0.38) c.autoRotateSpeed = -0.22;
  });
  return null;
}

export type StageProps = {
  tickets: TicketRecord[];
  pending: RawTicket | null;
  incidents: Incident[];
  selected: Sel | null;
  onSelect: (s: Sel) => void;
  still: boolean;
  /** True before the storm starts. */
  idle: boolean;
  policy: Policy;
};

function Scene({ tickets, pending, incidents, selected, onSelect, still, idle, policy }: StageProps) {
  const geometry = useHurricaneGeometry();
  const shadow = useShadowTexture();
  const registry = useMemo<Registry>(() => new Map(), []);
  const live = useMemo<Live>(() => new Map(), []);
  const centres = useMemo(() => incidents.map((_, i) => seat(i)), [incidents.length]);
  const drops = useMemo(() => {
    const list: (Pick<TicketRecord, 'id' | 'status' | 'incidentId'> & { reading?: boolean })[] = [...tickets];
    if (pending && !tickets.some((t) => t.id === pending.id)) list.push({ id: pending.id, status: 'alone', incidentId: null, reading: true });
    return list;
  }, [tickets, pending]);
  const links = useMemo(() => {
    const out: LinkSpec[] = [];
    for (const t of tickets) {
      if (t.status !== 'joined') continue;
      const best = t.pairs.find((p) => p.relation === 'same' || p.relation === 'conflicting');
      if (best) out.push({ key: `m-${t.id}`, a: t.id, b: best.with, color: INK, lasting: false });
    }
    for (const inc of incidents) for (const c of inc.conflicts) out.push({ key: `c-${c.a}-${c.b}`, a: c.a, b: c.b, color: '#f97316', lasting: true });
    return out;
  }, [tickets, incidents]);
  const focusIndex = selected?.kind === 'incident' ? incidents.findIndex((i) => i.id === selected.id) : -1;
  const focus = useMemo(() => (focusIndex >= 0 ? seat(focusIndex) : new THREE.Vector3()), [focusIndex]);
  const anyHeld = tickets.some((t) => t.status === 'held' || t.status === 'unscreened');

  return (
    <>
      <Floor held={anyHeld} />
      <Teaser geometry={geometry} shadow={shadow} on={idle} still={still} />
      {incidents.map((inc, i) => (
        <Hurricane
          key={inc.id}
          incident={inc}
          index={i}
          geometry={geometry}
          shadow={shadow}
          live={live}
          policy={policy}
          still={still}
          selected={selected?.kind === 'incident' && selected.id === inc.id}
          onSelect={() => onSelect({ kind: 'incident', id: inc.id })}
        />
      ))}
      {drops.map((t) => {
        const idx = t.incidentId ? incidents.findIndex((i) => i.id === t.incidentId) : -1;
        const inc = idx >= 0 ? incidents[idx] : null;
        const kind: DropKind = t.reading ? 'reading' : t.status === 'joined' && inc ? 'joined' : t.status === 'held' || t.status === 'unscreened' ? 'held' : 'alone';
        return (
          <Drop
            key={t.id}
            registry={registry}
            live={live}
            id={t.id}
            kind={kind}
            incidentId={inc?.id ?? null}
            centre={idx >= 0 ? centres[idx] : null}
            slot={inc ? inc.memberIds.indexOf(t.id) : 0}
            selected={selected?.kind === 'ticket' && selected.id === t.id}
            still={still}
            onSelect={() => onSelect({ kind: 'ticket', id: t.id })}
          />
        );
      })}
      {links.map((l) => (
        <Link key={l.key} registry={registry} spec={l} still={still} />
      ))}
      <Focus target={focus} />
      <OrbitControls makeDefault enablePan={false} enableDamping minDistance={8} maxDistance={30} minPolarAngle={0.5} maxPolarAngle={1.28} autoRotate={!still} autoRotateSpeed={0.22} />
    </>
  );
}

export default function Stage(props: StageProps) {
  return (
    <Canvas camera={{ position: [0, 9.8, 17.4], fov: 33 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}>
      <Scene {...props} />
    </Canvas>
  );
}
