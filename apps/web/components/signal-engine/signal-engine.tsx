"use client";

import { ArrowCounterClockwise, Check, CursorClick, Play, SkipForward } from "@phosphor-icons/react";
import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

type SignalId = "price" | "funding" | "pnl";

interface SignalDatum {
  id: SignalId;
  label: string;
  shortLabel: string;
  value: string;
  target: string;
}

const SIGNALS: SignalDatum[] = [
  { id: "price", label: "SOL price", shortLabel: "PRICE", value: "$284.14", target: "AT LEAST $280" },
  { id: "funding", label: "Perp funding", shortLabel: "FUNDING", value: "+0.061%", target: "AT LEAST 0.050%" },
  { id: "pnl", label: "Position P&L", shortLabel: "POSITION P&L", value: "+12.8%", target: "AT LEAST 10.0%" },
];

const STAGE_COPY = [
  { state: "OBSERVING", title: "The market is still forming.", body: "Three independent signals are being read from one complete market frame." },
  { state: "SIGNAL 01 READY", title: "Price has crossed.", body: "One signal is true. Triggerlane keeps watching because the whole moment has not formed." },
  { state: "SIGNAL 02 READY", title: "Funding now agrees.", body: "Two signals are true. Position profit still has to confirm the same stored frame." },
  { state: "ALL THREE READY", title: "One complete moment.", body: "Price, funding, and position profit agree. The execution boundary is now open." },
  { state: "ACTION FIRED ONCE", title: "One moment. One action.", body: "The simulated action crossed the boundary once and settled into a final receipt state." },
] as const;

function makeLabel(lines: string[], accent: string, width = 560) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = 172;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "rgba(8, 12, 11, .92)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(157, 178, 170, .28)";
  context.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  context.fillStyle = accent;
  context.font = "600 28px monospace";
  context.fillText(lines[0] ?? "", 26, 45);
  context.fillStyle = "#edf3f0";
  context.font = "700 34px monospace";
  context.fillText(lines[1] ?? "", 26, 94);
  context.fillStyle = "#8d9a95";
  context.font = "22px monospace";
  context.fillText(lines[2] ?? "", 26, 137);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.65, 1.12, 1);
  return { sprite, texture, material };
}

function addPriceInstrument(group: THREE.Group, color: THREE.Color) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.54, .045, 10, 72), new THREE.MeshStandardMaterial({ color, metalness: .72, roughness: .28 }));
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  const needle = new THREE.Mesh(new THREE.BoxGeometry(.06, .54, .06), new THREE.MeshBasicMaterial({ color }));
  needle.position.y = .16;
  needle.rotation.z = -.52;
  group.add(needle);
  const pivot = new THREE.Mesh(new THREE.SphereGeometry(.1, 16, 16), new THREE.MeshBasicMaterial({ color }));
  group.add(pivot);
}

function addFundingInstrument(group: THREE.Group, color: THREE.Color) {
  [-.16, .16].forEach((offset, index) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.46, .04, 8, 64), new THREE.MeshStandardMaterial({ color, metalness: .65, roughness: .3 }));
    ring.position.z = offset;
    ring.rotation.set(index ? .78 : -.78, .35, 0);
    group.add(ring);
  });
  const axis = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, 1.16, 12), new THREE.MeshBasicMaterial({ color }));
  axis.rotation.z = Math.PI / 2;
  group.add(axis);
}

function addPnlInstrument(group: THREE.Group, color: THREE.Color) {
  const base = new THREE.Mesh(new THREE.OctahedronGeometry(.48, 0), new THREE.MeshStandardMaterial({ color, metalness: .72, roughness: .25, wireframe: true }));
  group.add(base);
  const positive = new THREE.Mesh(new THREE.BoxGeometry(.17, .72, .17), new THREE.MeshBasicMaterial({ color }));
  positive.position.set(.64, .1, 0);
  group.add(positive);
  const baseline = new THREE.Mesh(new THREE.BoxGeometry(1.45, .035, .035), new THREE.MeshBasicMaterial({ color }));
  baseline.position.x = .15;
  group.add(baseline);
}

function SignalEngineScene({ stage, focused, onFocus }: { stage: number; focused: SignalId | null; onFocus: (signal: SignalId) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);
  const reducedMotion = Boolean(useReducedMotion());

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    } catch {
      setFallback(true);
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x080a0a, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.dataset.scene = "signal-engine";
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x080a0a, .038);
    const camera = new THREE.PerspectiveCamera(41, 1, .1, 100);
    camera.position.set(.2, .1, 11.8);

    scene.add(new THREE.AmbientLight(0x9fcfc0, .62));
    const key = new THREE.DirectionalLight(0xd9fff3, 2.4);
    key.position.set(2, 5, 7);
    scene.add(key);
    const rim = new THREE.PointLight(0x70f2cc, 22, 18);
    rim.position.set(2.2, 0, 3.5);
    scene.add(rim);

    const world = new THREE.Group();
    scene.add(world);
    const mint = new THREE.Color(0x70f2cc);
    const softMint = new THREE.Color(0x55bfa2);
    const quiet = new THREE.Color(0x35413d);
    const dim = new THREE.Color(0x202825);
    const positions = [new THREE.Vector3(-3.75, 2.15, .2), new THREE.Vector3(-4.15, 0, -.35), new THREE.Vector3(-3.7, -2.15, .25)];
    const corePosition = new THREE.Vector3(1.05, 0, 0);
    const actionPosition = new THREE.Vector3(5.15, 0, -.3);

    const starGeometry = new THREE.BufferGeometry();
    const stars = new Float32Array(330);
    for (let index = 0; index < stars.length; index += 3) {
      stars[index] = (Math.random() - .5) * 22;
      stars[index + 1] = (Math.random() - .5) * 12;
      stars[index + 2] = -2 - Math.random() * 8;
    }
    starGeometry.setAttribute("position", new THREE.BufferAttribute(stars, 3));
    const starField = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0x597067, size: .022, transparent: true, opacity: .48 }));
    scene.add(starField);

    const grid = new THREE.GridHelper(28, 36, 0x26332f, 0x111715);
    grid.position.y = -3.55;
    grid.rotation.z = .018;
    scene.add(grid);

    const labelAssets: Array<{ sprite: THREE.Sprite; texture: THREE.Texture; material: THREE.SpriteMaterial }> = [];
    const signalGroups: THREE.Group[] = [];
    const signalHalos: THREE.Mesh[] = [];
    const paths: Array<{ curve: THREE.CatmullRomCurve3; mesh: THREE.Mesh; packet: THREE.Mesh; ready: boolean }> = [];

    SIGNALS.forEach((signal, index) => {
      const ready = stage >= index + 1;
      const active = focused === signal.id;
      const color = ready ? mint : active ? softMint : quiet;
      const node = new THREE.Group();
      node.position.copy(positions[index]!);
      if (signal.id === "price") addPriceInstrument(node, color);
      if (signal.id === "funding") addFundingInstrument(node, color);
      if (signal.id === "pnl") addPnlInstrument(node, color);
      world.add(node);
      signalGroups.push(node);

      const halo = new THREE.Mesh(new THREE.TorusGeometry(.82, .012, 5, 96), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: ready ? .7 : active ? .46 : .18 }));
      halo.position.copy(node.position);
      halo.rotation.set(Math.PI / 2, 0, index * .35);
      world.add(halo);
      signalHalos.push(halo);

      const curve = new THREE.CatmullRomCurve3([node.position.clone(), new THREE.Vector3(-1.7, node.position.y * .72, node.position.z - .35), new THREE.Vector3(-.25, node.position.y * .18, -.55), corePosition.clone()]);
      const path = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, .012, 5, false), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: ready ? .72 : .16 }));
      world.add(path);
      const packet = new THREE.Mesh(new THREE.SphereGeometry(.075, 12, 12), new THREE.MeshBasicMaterial({ color: ready ? mint : dim }));
      packet.visible = ready;
      world.add(packet);
      paths.push({ curve, mesh: path, packet, ready });

      const label = makeLabel([signal.shortLabel, signal.value, signal.target], ready ? "#70f2cc" : active ? "#a4f8de" : "#78847f");
      if (label) {
        label.sprite.position.set(node.position.x - .35, node.position.y + .77, node.position.z);
        world.add(label.sprite);
        labelAssets.push(label);
      }
    });

    const converged = stage >= 3;
    const coreShell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 2), new THREE.MeshStandardMaterial({ color: converged ? mint : quiet, emissive: converged ? 0x153f34 : 0x000000, metalness: .7, roughness: .24, wireframe: true, transparent: true, opacity: .95 }));
    coreShell.position.copy(corePosition);
    world.add(coreShell);
    const coreInner = new THREE.Mesh(new THREE.SphereGeometry(.65, 28, 28), new THREE.MeshBasicMaterial({ color: converged ? mint : dim, transparent: true, opacity: converged ? .2 : .07 }));
    coreInner.position.copy(corePosition);
    world.add(coreInner);
    const coreRings = [1.38, 1.68].map((radius, index) => {
      const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(radius, .012, 5, 110), new THREE.MeshBasicMaterial({ color: converged ? mint : quiet, transparent: true, opacity: converged ? .58 : .18 }));
      ringMesh.position.copy(corePosition);
      ringMesh.rotation.set(index ? 1.02 : .26, index ? -.42 : .6, 0);
      world.add(ringMesh);
      return ringMesh;
    });

    const actionCurve = new THREE.CatmullRomCurve3([corePosition.clone().add(new THREE.Vector3(1.2, 0, 0)), new THREE.Vector3(3.45, .2, -.2), actionPosition.clone()]);
    const actionPath = new THREE.Mesh(new THREE.TubeGeometry(actionCurve, 52, .018, 6, false), new THREE.MeshBasicMaterial({ color: stage >= 4 ? mint : quiet, transparent: true, opacity: stage >= 3 ? .72 : .16 }));
    world.add(actionPath);
    const executionPacket = new THREE.Mesh(new THREE.BoxGeometry(.2, .2, .2), new THREE.MeshBasicMaterial({ color: mint }));
    executionPacket.visible = stage >= 4;
    world.add(executionPacket);

    const gateMaterial = new THREE.MeshStandardMaterial({ color: stage >= 4 ? mint : 0x29332f, emissive: stage >= 4 ? 0x164738 : 0x000000, metalness: .58, roughness: .3, transparent: true, opacity: stage >= 3 ? .96 : .48 });
    const actionGate = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.12, .18), gateMaterial);
    actionGate.position.copy(actionPosition);
    world.add(actionGate);
    const actionLabel = makeLabel(["ONE-SHOT ACTION", "SELL 25% SOL", stage >= 4 ? "FILLED · RECEIPT STORED" : "WAITING FOR ALL TRUE"], stage >= 4 ? "#70f2cc" : "#8d9a95", 620);
    if (actionLabel) {
      actionLabel.sprite.position.set(actionPosition.x, actionPosition.y + 1.03, actionPosition.z);
      actionLabel.sprite.scale.set(3.8, 1.06, 1);
      world.add(actionLabel.sprite);
      labelAssets.push(actionLabel);
    }

    const pointer = { x: 0, y: 0 };
    const renderFrame = (elapsed: number) => {
      if (!reducedMotion) {
        signalGroups.forEach((node, index) => { node.rotation.y = elapsed * (.24 + index * .04) * (index % 2 ? -1 : 1); node.rotation.x = Math.sin(elapsed * .42 + index) * .08; });
        signalHalos.forEach((halo, index) => { halo.rotation.z = elapsed * (index % 2 ? -.12 : .14); });
        coreShell.rotation.x = elapsed * .16;
        coreShell.rotation.y = elapsed * .24;
        coreRings.forEach((ringMesh, index) => { ringMesh.rotation.z = elapsed * (index ? -.1 : .13); });
        paths.forEach(({ curve, packet, ready }, index) => { if (ready) packet.position.copy(curve.getPoint((elapsed * .14 + index * .23) % 1)); });
        if (converged && elapsed < 1.35) coreInner.scale.setScalar(1 + Math.sin(elapsed * 7) * .09 * (1 - elapsed / 1.35));
        if (stage >= 4) executionPacket.position.copy(actionCurve.getPoint(Math.min(1, elapsed * .62)));
      } else {
        signalGroups.forEach((node, index) => { node.rotation.set(.05 * index, -.12 + index * .1, 0); });
        paths.forEach(({ curve, packet, ready }, index) => { if (ready) packet.position.copy(curve.getPoint(.45 + index * .13)); });
        if (stage >= 4) executionPacket.position.copy(actionCurve.getPoint(1));
        coreShell.rotation.set(.35, .55, 0);
      }
      world.rotation.x += ((reducedMotion ? 0 : pointer.y) - world.rotation.x) * .035;
      world.rotation.y += ((reducedMotion ? -.025 : pointer.x - .025) - world.rotation.y) * .035;
      renderer.render(scene, camera);
    };

    const resize = () => {
      const bounds = host.getBoundingClientRect();
      const width = Math.max(bounds.width, 1);
      const height = Math.max(bounds.height, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      const compact = camera.aspect < .78;
      const intermediate = !compact && camera.aspect < 1.15;
      camera.position.z = compact ? 18 : intermediate ? 15.5 : 11.8;
      world.scale.setScalar(compact ? .86 : intermediate ? .82 : .9);
      world.position.set(compact ? 1 : intermediate ? .55 : .8, compact ? .4 : 0, 0);
      labelAssets.forEach(({ sprite }) => { sprite.visible = width >= 1700 && camera.aspect >= 1.5; });
      camera.updateProjectionMatrix();
      renderFrame(reducedMotion ? 1 : 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const pointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || reducedMotion) return;
      const bounds = host.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / Math.max(bounds.width, 1) - .5) * .15;
      pointer.y = ((event.clientY - bounds.top) / Math.max(bounds.height, 1) - .5) * .07;
    };
    const pointerLeave = () => { pointer.x = 0; pointer.y = 0; };
    const pointerDown = (event: PointerEvent) => {
      const bounds = host.getBoundingClientRect();
      if (event.clientX > bounds.left + bounds.width * .62) return;
      const normalized = (event.clientY - bounds.top) / Math.max(bounds.height, 1);
      onFocus(SIGNALS[Math.min(2, Math.max(0, Math.floor(normalized * 3)))]!.id);
    };
    host.addEventListener("pointermove", pointerMove);
    host.addEventListener("pointerleave", pointerLeave);
    host.addEventListener("pointerdown", pointerDown);

    const startedAt = performance.now();
    let request = 0;
    const loop = (timestamp: number) => { renderFrame(Math.max(0, (timestamp - startedAt) / 1000)); request = requestAnimationFrame(loop); };
    if (reducedMotion) renderFrame(1);
    else request = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(request);
      observer.disconnect();
      host.removeEventListener("pointermove", pointerMove);
      host.removeEventListener("pointerleave", pointerLeave);
      host.removeEventListener("pointerdown", pointerDown);
      labelAssets.forEach(({ sprite, texture, material }) => { world.remove(sprite); texture.dispose(); material.dispose(); });
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [focused, onFocus, reducedMotion, stage]);

  if (fallback) {
    return <div className="signal-engine-fallback" role="img" aria-label="Signal Engine fallback: price, funding, and position profit converge into one action.">
      <div className="fallback-signal-stack">{SIGNALS.map((signal, index) => <div className={stage >= index + 1 ? "ready" : ""} key={signal.id}><i>{stage >= index + 1 ? <Check size={15} weight="bold" /> : `0${index + 1}`}</i><span><b>{signal.label}</b><small>{signal.value} · {signal.target}</small></span></div>)}</div>
      <div className={`fallback-convergence ${stage >= 3 ? "ready" : ""}`}><span>ALL TRUE</span><i /></div>
      <div className={`fallback-action ${stage >= 4 ? "fired" : ""}`}><small>ONE-SHOT ACTION</small><strong>SELL 25% SOL</strong><span>{stage >= 4 ? "FILLED ONCE" : "WAITING"}</span></div>
    </div>;
  }

  return <div className="signal-engine-canvas" ref={hostRef} data-testid="signal-engine-scene" aria-hidden="true" />;
}

export function SignalEnginePrototype() {
  const [stage, setStage] = useState(0);
  const [focused, setFocused] = useState<SignalId | null>(null);
  const [running, setRunning] = useState(false);
  const reducedMotion = Boolean(useReducedMotion());
  const copy = STAGE_COPY[stage]!;
  const readyCount = Math.min(stage, 3);
  const statusText = useMemo(() => `${readyCount} of 3 signals ready`, [readyCount]);

  useEffect(() => {
    if (!running) return;
    if (stage >= 4) { setRunning(false); return; }
    const delay = reducedMotion ? 120 : stage === 2 ? 1050 : 820;
    const timer = window.setTimeout(() => setStage((value) => Math.min(4, value + 1)), delay);
    return () => window.clearTimeout(timer);
  }, [reducedMotion, running, stage]);

  const reset = () => { setRunning(false); setStage(0); setFocused(null); };
  const run = () => { setStage(0); setFocused(null); setRunning(true); };
  const advance = () => { setRunning(false); setStage((value) => Math.min(4, value + 1)); };

  return <main className={`signal-engine-prototype stage-${stage}`}>
    <SignalEngineScene stage={stage} focused={focused} onFocus={setFocused} />
    <div className="signal-engine-vignette" aria-hidden="true" />
    <header className="signal-engine-header">
      <a href="/" aria-label="Return to Triggerlane"><span className="signal-engine-mark">TL</span><span><b>TRIGGERLANE</b><small>SIGNAL ENGINE · PROTOTYPE 23</small></span></a>
      <div className="signal-engine-state" aria-live="polite"><i /><span>{copy.state}</span><b>{statusText}</b></div>
    </header>
    <section className="signal-engine-story" aria-labelledby="signal-engine-title">
      <span>THREE SIGNALS · ONE STORED FRAME</span>
      <h1 id="signal-engine-title">{copy.title}</h1>
      <p>{copy.body}</p>
    </section>
    <aside className={`signal-engine-action-readout ${stage >= 4 ? "fired" : ""}`} aria-label="One-shot action">
      <small>ONE-SHOT ACTION</small><b>SELL 25% SOL</b><span>{stage >= 4 ? "FILLED ONCE" : stage >= 3 ? "READY" : "WAITING FOR ALL TRUE"}</span>
    </aside>
    <div className="signal-engine-hint"><CursorClick size={16} /><span>Focus a signal or move through the frame</span></div>
    <section className="signal-engine-dock" aria-label="Signal Engine controls">
      <div className="signal-engine-signals" role="group" aria-label="Market signals">
        {SIGNALS.map((signal, index) => {
          const ready = stage >= index + 1;
          return <button className={`${ready ? "ready" : ""} ${focused === signal.id ? "focused" : ""}`} aria-pressed={focused === signal.id} onClick={() => setFocused(signal.id)} key={signal.id}>
            <i>{ready ? <Check size={14} weight="bold" /> : `0${index + 1}`}</i><span><small>{signal.shortLabel}</small><b>{signal.value}</b></span><em>{ready ? "TRUE" : "WATCHING"}</em>
          </button>;
        })}
      </div>
      <div className="signal-engine-controls">
        <button className="engine-reset" onClick={reset} aria-label="Reset Signal Engine"><ArrowCounterClockwise size={18} /></button>
        <button className="engine-step" onClick={advance} disabled={stage >= 4}><SkipForward size={17} />STEP</button>
        <button className="engine-run" onClick={run} disabled={running}><Play size={16} weight="fill" />{running ? "RUNNING" : stage >= 4 ? "RUN AGAIN" : "RUN CONVERGENCE"}</button>
      </div>
    </section>
  </main>;
}
