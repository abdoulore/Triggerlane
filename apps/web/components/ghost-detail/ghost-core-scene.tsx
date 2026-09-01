"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

export interface GhostCoreSceneCondition {
  metric: string;
  current: string;
  target: string;
  operator: "GTE" | "LTE";
  satisfied: boolean;
  distanceRatio: number;
  provider: string;
  observedAt: string;
}

interface GhostCoreSceneProps {
  conditions: GhostCoreSceneCondition[];
  blocked: boolean;
  lifecycleStage: number;
  status: string;
}

const threeConditionPositions = [
  new THREE.Vector3(-3.6, 1.85, 0.3),
  new THREE.Vector3(-4.15, -0.1, -0.4),
  new THREE.Vector3(-3.35, -2.05, 0.35),
];

function createLabel(lines: string[], color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 150;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(8, 12, 11, 0.88)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(102, 124, 117, 0.45)";
  context.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  context.fillStyle = color;
  context.font = "600 34px monospace";
  context.fillText(lines[0] ?? "", 24, 49);
  context.fillStyle = "#e7eeeb";
  context.font = "700 30px monospace";
  context.fillText(lines[1] ?? "", 24, 92);
  context.fillStyle = "#82908b";
  context.font = "22px monospace";
  context.fillText(lines[2] ?? "", 24, 127);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.35, 0.98, 1);
  return { sprite, texture, material };
}

export function GhostCoreScene({ conditions, blocked, lifecycleStage, status }: GhostCoreSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);
  const reducedMotion = Boolean(useReducedMotion());

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch {
      setFallback(true);
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x080a0a, 0);
    renderer.domElement.dataset.scene = "ghost-core";
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x080a0a, 0.045);
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
    camera.position.set(0.1, 0.15, 11.5);
    const group = new THREE.Group();
    scene.add(group);

    const mint = new THREE.Color(0x70f2cc);
    const amber = new THREE.Color(0xe5bb68);
    const quiet = new THREE.Color(0x33403c);
    const paused = blocked || status === "PAUSED";
    const filled = status === "FILLED";
    const terminal = ["CANCELLED", "EXPIRED", "FAILED"].includes(status);
    const stateColor = blocked || status === "FAILED" ? amber : terminal ? quiet : mint;

    const grid = new THREE.GridHelper(22, 22, 0x23302d, 0x111816);
    grid.position.set(0, -3.45, 0);
    scene.add(grid);

    const coreShellMaterial = new THREE.MeshBasicMaterial({ color: lifecycleStage > 0 ? stateColor : quiet, wireframe: true, transparent: true, opacity: terminal && !filled ? 0.52 : 0.9 });
    const coreShell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.12, 1), coreShellMaterial);
    coreShell.position.set(1.1, 0, 0);
    group.add(coreShell);

    const coreInnerMaterial = new THREE.MeshBasicMaterial({ color: lifecycleStage >= 2 || filled ? stateColor : quiet, transparent: true, opacity: filled ? 0.22 : lifecycleStage >= 2 ? 0.13 : 0.06 });
    const coreInner = new THREE.Mesh(new THREE.SphereGeometry(0.72, 24, 24), coreInnerMaterial);
    coreInner.position.copy(coreShell.position);
    group.add(coreInner);

    const rings = [1.48, 1.78].map((radius, index) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.008, 4, 96),
        new THREE.MeshBasicMaterial({ color: lifecycleStage > index ? stateColor : quiet, transparent: true, opacity: 0.55 }),
      );
      ring.position.copy(coreShell.position);
      ring.rotation.set(index ? 1.08 : 0.3, index ? -0.35 : 0.64, 0);
      group.add(ring);
      return ring;
    });

    const nodes: THREE.Mesh[] = [];
    const halos: THREE.Mesh[] = [];
    const paths: THREE.Line[] = [];
    const labelAssets: Array<{ sprite: THREE.Sprite; texture: THREE.Texture; material: THREE.SpriteMaterial }> = [];

    const positions = conditions.length === 1
      ? [new THREE.Vector3(-3.9, 0, 0.1)]
      : conditions.length === 2
        ? [new THREE.Vector3(-3.75, 1.25, 0.2), new THREE.Vector3(-3.75, -1.25, -0.2)]
        : threeConditionPositions;
    conditions.slice(0, 3).forEach((condition, index) => {
      const distance = Math.min(Math.max(condition.distanceRatio, 0), 1.6);
      const observedAgeSeconds = Math.max(0, (Date.now() - new Date(condition.observedAt).getTime()) / 1000);
      const freshness = Math.max(0.38, 1 - observedAgeSeconds / 300);
      const position = (positions[index] ?? positions[0]!).clone();
      position.x -= distance * 0.7;
      const color = blocked ? amber : condition.satisfied ? mint : quiet;
      const node = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.42, 0),
        new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: (condition.satisfied || blocked ? 0.95 : 0.65) * freshness }),
      );
      node.position.copy(position);
      group.add(node);
      nodes.push(node);

      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.62, 0.012, 4, 64),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: (condition.satisfied || blocked ? 0.55 : 0.24) * freshness }),
      );
      halo.position.copy(position);
      halo.rotation.x = Math.PI / 2;
      group.add(halo);
      halos.push(halo);

      const bend = new THREE.Vector3(-0.8, position.y * 0.35, position.z - 0.25);
      const geometry = new THREE.BufferGeometry().setFromPoints([position, bend, coreShell.position]);
      const path = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: condition.satisfied || blocked ? 0.75 : 0.3 }));
      group.add(path);
      paths.push(path);

      const relation = `${condition.operator === "GTE" ? ">=" : "<="} ${condition.target}`;
      const labelColor = blocked ? "#e5bb68" : condition.satisfied ? "#70f2cc" : "#8f9b97";
      const label = createLabel([condition.metric, condition.current, relation], labelColor);
      if (label) {
        label.sprite.position.set(position.x - 0.55, position.y + 0.62, position.z);
        group.add(label.sprite);
        labelAssets.push(label);
      }
    });

    const exitMaterial = new THREE.LineBasicMaterial({ color: lifecycleStage >= 3 ? stateColor : quiet, transparent: true, opacity: 0.7 });
    const exitPath = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(2.3, 0, 0), new THREE.Vector3(4.1, 0.2, -0.1), new THREE.Vector3(6.6, 0.2, -0.9)]),
      exitMaterial,
    );
    group.add(exitPath);
    const packet = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.19, 0.19), new THREE.MeshBasicMaterial({ color: stateColor }));
    packet.visible = lifecycleStage >= 3 || filled;
    group.add(packet);

    const resize = () => {
      const bounds = host.getBoundingClientRect();
      renderer.setSize(Math.max(bounds.width, 1), Math.max(bounds.height, 1), false);
      camera.aspect = Math.max(bounds.width, 1) / Math.max(bounds.height, 1);
      camera.position.z = camera.aspect < 1 ? 20 : 11.5;
      group.position.x = camera.aspect < 1 ? 0.7 : 0;
      labelAssets.forEach(({ sprite }) => { sprite.visible = camera.aspect >= 1; });
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const pointerTarget = { x: 0, y: 0 };
    const pointerMove = (event: PointerEvent) => {
      const bounds = host.getBoundingClientRect();
      pointerTarget.y = ((event.clientX - bounds.left) / Math.max(bounds.width, 1) - 0.5) * 0.18;
      pointerTarget.x = ((event.clientY - bounds.top) / Math.max(bounds.height, 1) - 0.5) * 0.08;
    };
    host.addEventListener("pointermove", pointerMove);

    const clock = new THREE.Clock();
    let request = 0;
    const render = () => {
      const elapsed = clock.getElapsedTime();
      const still = reducedMotion || paused || terminal;
      coreShell.rotation.x = still ? 0.42 : elapsed * (filled ? 0.09 : 0.18);
      coreShell.rotation.y = still ? 0.62 : elapsed * (filled ? 0.13 : 0.26);
      coreInner.scale.setScalar(still ? 1 : 1 + Math.sin(elapsed * (filled ? 1.1 : 1.7)) * (filled ? 0.075 : 0.045));
      rings.forEach((ring, index) => { if (!still) ring.rotation.z = elapsed * (index ? -0.12 : 0.16); });
      nodes.forEach((node, index) => {
        if (!still) {
          node.rotation.x = elapsed * (0.24 + index * 0.03);
          node.rotation.y = elapsed * (0.32 + index * 0.04);
          const pulse = conditions[index]?.satisfied ? 1 + Math.sin(elapsed * 2.2 + index) * 0.07 : 1;
          node.scale.setScalar(pulse);
          const halo = halos[index];
          if (halo) halo.rotation.z = elapsed * (index % 2 ? -0.18 : 0.18);
        }
      });
      if (packet.visible) {
        const progress = filled || lifecycleStage >= 4 ? 1 : still ? 0.58 : (elapsed * 0.22) % 1;
        packet.position.lerpVectors(new THREE.Vector3(2.3, 0, 0), new THREE.Vector3(6.6, 0.2, -0.9), progress);
      }
      group.rotation.x += ((still ? 0 : pointerTarget.x) - group.rotation.x) * 0.035;
      group.rotation.y += ((still ? -0.04 : pointerTarget.y - 0.04) - group.rotation.y) * 0.035;
      renderer.render(scene, camera);
      request = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(request);
      observer.disconnect();
      host.removeEventListener("pointermove", pointerMove);
      labelAssets.forEach(({ sprite, texture, material }) => { group.remove(sprite); texture.dispose(); material.dispose(); });
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [blocked, conditions, lifecycleStage, reducedMotion, status]);

  if (fallback) {
    return <div className={`ghost-core-fallback ${blocked ? "blocked" : ""}`} role="img" aria-label={`Trigger visualization fallback. Status ${status}.`}>
      <div className="fallback-core"><strong>{conditions.filter((condition) => condition.satisfied).length}</strong><span>OF {conditions.length} READY</span></div>
      <div className="fallback-nodes">{conditions.map((condition) => <div className={condition.satisfied ? "ready" : ""} key={condition.metric}><b>{condition.metric}</b><span>{condition.current}</span><small>{condition.operator === "GTE" ? ">=" : "<="} {condition.target}</small></div>)}</div>
    </div>;
  }

  return <div className="ghost-core-visual" role="img" aria-label={`Interactive Triggerlane condition view. Status ${status}. ${conditions.filter((condition) => condition.satisfied).length} of ${conditions.length} conditions ready.`}>
    <div ref={hostRef} className="ghost-core-scene" data-testid="ghost-core-scene" aria-hidden="true" />
    <div className="ghost-scene-legend" aria-hidden="true">{conditions.map((condition) => <div className={condition.satisfied ? "ready" : ""} key={condition.metric}><b>{condition.metric}</b><span>{condition.current}</span><small>{condition.operator === "GTE" ? ">=" : "<="} {condition.target}</small></div>)}</div>
  </div>;
}
