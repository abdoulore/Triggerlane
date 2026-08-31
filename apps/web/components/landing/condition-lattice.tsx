"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

export function ConditionLattice({ stage, reducedMotion }: { stage: number; reducedMotion: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); }
    catch { setFallback(true); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x080a0a, 0);
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.dataset.scene = "condition-lattice";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x080a0a, 0.055);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 1.1, 11.5);
    const mint = new THREE.Color(0x70f2cc), quiet = new THREE.Color(0x34403d), amber = new THREE.Color(0xe5bb68);
    const group = new THREE.Group(); scene.add(group);
    const grid = new THREE.GridHelper(28, 28, 0x1e2926, 0x101615);
    grid.position.y = -3.2; grid.rotation.z = 0.02; scene.add(grid);

    const gates: THREE.LineSegments[] = [];
    const positions = [new THREE.Vector3(-4.4, 2.25, 0), new THREE.Vector3(-4.9, 0, -1), new THREE.Vector3(-4.1, -2.15, 0.4)];
    positions.forEach((position, index) => {
      const gate = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.55, 0.86, 0.36)), new THREE.LineBasicMaterial({ color: quiet, transparent: true, opacity: 0.75 }));
      gate.position.copy(position); gate.rotation.y = -0.18 + index * 0.14; group.add(gate); gates.push(gate);
    });
    const paths = positions.map((position) => {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([position, new THREE.Vector3(-1.2, position.y * 0.24, -0.8), new THREE.Vector3(1.1, 0, 0)]), new THREE.LineBasicMaterial({ color: quiet, transparent: true, opacity: 0.55 }));
      group.add(line); return line;
    });
    const coreMaterial = new THREE.MeshBasicMaterial({ color: quiet, wireframe: true, transparent: true, opacity: 0.85 });
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.76), coreMaterial); core.position.set(1.25, 0, 0); group.add(core);
    const executionPath = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(2.05, 0, 0), new THREE.Vector3(7.5, 0, -1.4)]), new THREE.LineBasicMaterial({ color: quiet, transparent: true, opacity: 0.65 })); group.add(executionPath);
    const packet = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial({ color: mint })); packet.visible = false; group.add(packet);

    const resize = () => { const { width, height } = host.getBoundingClientRect(); renderer.setSize(Math.max(width, 1), Math.max(height, 1), false); camera.aspect = Math.max(width, 1) / Math.max(height, 1); camera.updateProjectionMatrix(); };
    resize(); const observer = new ResizeObserver(resize); observer.observe(host);
    let request = 0; const clock = new THREE.Clock();
    const render = () => {
      const elapsed = clock.getElapsedTime();
      gates.forEach((gate, index) => { (gate.material as THREE.LineBasicMaterial).color.copy(stage >= index + 1 ? mint : stage === 0 ? amber : quiet); gate.rotation.z = reducedMotion ? 0 : Math.sin(elapsed * 0.7 + index) * 0.035; });
      paths.forEach((path, index) => (path.material as THREE.LineBasicMaterial).color.copy(stage >= index + 1 ? mint : quiet));
      coreMaterial.color.copy(stage >= 3 ? mint : quiet); core.rotation.x = reducedMotion ? 0.55 : elapsed * 0.26; core.rotation.y = reducedMotion ? 0.7 : elapsed * 0.34;
      (executionPath.material as THREE.LineBasicMaterial).color.copy(stage >= 4 ? mint : quiet); packet.visible = stage >= 4;
      if (packet.visible) packet.position.lerpVectors(new THREE.Vector3(2.05, 0, 0), new THREE.Vector3(7.5, 0, -1.4), reducedMotion ? 0.72 : (elapsed * 0.28) % 1);
      group.rotation.y = reducedMotion ? -0.05 : Math.sin(elapsed * 0.17) * 0.055; renderer.render(scene, camera); request = requestAnimationFrame(render);
    }; render();
    return () => { cancelAnimationFrame(request); observer.disconnect(); scene.traverse((object) => { if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => material.dispose()); } }); renderer.dispose(); renderer.domElement.remove(); };
  }, [stage, reducedMotion]);

  if (fallback) return <div className="lattice-fallback" aria-label="Three market conditions converging into one execution"><span>PRICE</span><span>FUNDING</span><span>P&amp;L</span><i /><strong>EXECUTE</strong></div>;
  return <div ref={hostRef} className="condition-lattice" data-testid="condition-lattice" />;
}
