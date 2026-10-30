import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * JarvisHologramCore — Arc Reactor / Jarvis style holographic core.
 * 4 layers: quantum sphere, orbital rings, ambient dust, proximity plexus.
 */
export default function JarvisHologramCore() {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
    camera.position.set(0, 0, 170);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    // Texture hạt mềm
    const texCanvas = document.createElement("canvas");
    texCanvas.width = 64; texCanvas.height = 64;
    const tctx = texCanvas.getContext("2d");
    const grad = tctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.3, "rgba(255,255,255,0.8)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    tctx.fillStyle = grad;
    tctx.fillRect(0, 0, 64, 64);
    const particleTex = new THREE.CanvasTexture(texCanvas);

    const group = new THREE.Group();
    group.position.x = 24;
    scene.add(group);

    // --- Layer 1: Quantum Particle Sphere ---
    const SPHERE_COUNT = 5000;
    const sphereGeo = new THREE.BufferGeometry();
    const spherePos = new Float32Array(SPHERE_COUNT * 3);
    const sphereCol = new Float32Array(SPHERE_COUNT * 3);
    const sphereBase = new Float32Array(SPHERE_COUNT * 3);

    const cyan = new THREE.Color("#00f0ff");
    const gold = new THREE.Color("#ffb703");

    for (let i = 0; i < SPHERE_COUNT; i++) {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / SPHERE_COUNT);
      const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5);
      const r = 46;
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      sphereBase[i * 3] = x; sphereBase[i * 3 + 1] = y; sphereBase[i * 3 + 2] = z;
      spherePos[i * 3] = x; spherePos[i * 3 + 1] = y; spherePos[i * 3 + 2] = z;
      const c = Math.random() < 0.25 ? gold.clone() : cyan.clone();
      c.multiplyScalar(1.2 + Math.random() * 0.6);
      sphereCol[i * 3] = c.r; sphereCol[i * 3 + 1] = c.g; sphereCol[i * 3 + 2] = c.b;
    }
    sphereGeo.setAttribute("position", new THREE.BufferAttribute(spherePos, 3));
    sphereGeo.setAttribute("color", new THREE.BufferAttribute(sphereCol, 3));
    const sphereMat = new THREE.PointsMaterial({
      size: 1.6, map: particleTex, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
      sizeAttenuation: true, vertexColors: true, opacity: 0.95,
    });
    const spherePoints = new THREE.Points(sphereGeo, sphereMat);
    group.add(spherePoints);

    // --- Layer 2: Orbital HUD Rings ---
    function makeRing(radius, color, dashed = false) {
      const segs = 128;
      const pts = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = dashed
        ? new THREE.LineDashedMaterial({ color, transparent: true, opacity: 0.7, dashSize: 3, gapSize: 2 })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 });
      const line = new THREE.LineLoop(geo, mat);
      if (dashed) line.computeLineDistances();
      return line;
    }
    const ring1 = makeRing(62, 0x00f0ff);
    ring1.rotation.x = Math.PI / 4;
    const ring2 = makeRing(74, 0x00ffa3);
    ring2.rotation.y = -Math.PI / 6;
    const ring3 = makeRing(86, 0xffb703, true);
    ring3.rotation.z = Math.PI / 3;
    group.add(ring1, ring2, ring3);

    // --- Layer 3: Ambient Constellation Dust ---
    const DUST_COUNT = 1800;
    const dustGeo = new THREE.BufferGeometry();
    const dustPos = new Float32Array(DUST_COUNT * 3);
    const dustVel = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < DUST_COUNT; i++) {
      const r = 60 + Math.random() * 120;
      const phi = Math.random() * Math.PI * 2;
      const costh = Math.random() * 2 - 1;
      const s = Math.sqrt(1 - costh * costh);
      dustPos[i * 3] = r * s * Math.cos(phi);
      dustPos[i * 3 + 1] = r * costh;
      dustPos[i * 3 + 2] = r * s * Math.sin(phi);
      dustVel[i * 3] = (Math.random() - 0.5) * 0.08;
      dustVel[i * 3 + 1] = (Math.random() - 0.5) * 0.08;
      dustVel[i * 3 + 2] = (Math.random() - 0.5) * 0.08;
    }
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({
      size: 1.1, map: particleTex, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
      sizeAttenuation: true, color: 0x99ddff, opacity: 0.55,
    });
    const dustPoints = new THREE.Points(dustGeo, dustMat);
    group.add(dustPoints);

    // --- Layer 4: Proximity Plexus (LineSegments) ---
    const MAX_LINES = 2500;
    const linePos = new Float32Array(MAX_LINES * 6);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
    lineGeo.setDrawRange(0, 0);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x00f0ff, transparent: true, opacity: 0.25,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const plexus = new THREE.LineSegments(lineGeo, lineMat);
    group.add(plexus);

    // Noise helper (pseudo-simplex)
    function noise3(x, y, z, t) {
      return (
        Math.sin(x * 0.08 + t * 0.9) * Math.cos(y * 0.07 + t * 0.7) * Math.sin(z * 0.06 + t * 0.5) +
        Math.sin(x * 0.03 - y * 0.05 + t * 0.4) * 0.6 +
        Math.cos(z * 0.04 + t * 0.3) * 0.4
      );
    }

    // Mouse
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMouseMove = (e) => {
      const rect = container.getBoundingClientRect();
      mouse.tx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      mouse.ty = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    window.addEventListener("mousemove", onMouseMove);

    const resize = () => {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    let raf = 0;
    const clock = new THREE.Clock();
    let frameCount = 0;

    const animate = () => {
      const t = clock.getElapsedTime();
      frameCount++;

      mouse.x += (mouse.tx - mouse.x) * 0.06;
      mouse.y += (mouse.ty - mouse.y) * 0.06;

      group.rotation.y = mouse.x * 0.25;
      group.rotation.x = -mouse.y * 0.18;

      // Layer 1: sphere breathing
      const sp = sphereGeo.attributes.position.array;
      for (let i = 0; i < SPHERE_COUNT; i++) {
        const bx = sphereBase[i * 3];
        const by = sphereBase[i * 3 + 1];
        const bz = sphereBase[i * 3 + 2];
        const n = noise3(bx, by, bz, t) * 0.35;
        const r = 1 + n;
        // mouse radiation repel
        const mx = mouse.x * 60;
        const my = -mouse.y * 60;
        const dx = bx * r - mx;
        const dy = by * r - my;
        const dz = bz * r;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const repel = dist < 25 ? (25 - dist) * 0.4 : 0;
        const scale = r + repel / 46;
        sp[i * 3] = bx * scale;
        sp[i * 3 + 1] = by * scale;
        sp[i * 3 + 2] = bz * scale;
      }
      sphereGeo.attributes.position.needsUpdate = true;

      // Layer 2: rings rotation
      ring1.rotation.z += 0.012;
      ring2.rotation.z -= 0.009;
      ring3.rotation.z += 0.015;

      // Layer 3: dust drift
      const dp = dustGeo.attributes.position.array;
      for (let i = 0; i < DUST_COUNT; i++) {
        dp[i * 3] += dustVel[i * 3];
        dp[i * 3 + 1] += dustVel[i * 3 + 1];
        dp[i * 3 + 2] += dustVel[i * 3 + 2];
        // wrap
        for (let k = 0; k < 3; k++) {
          if (Math.abs(dp[i * 3 + k]) > 160) dustVel[i * 3 + k] *= -1;
        }
      }
      dustGeo.attributes.position.needsUpdate = true;

      // Layer 4: proximity plexus (every 2 frames)
      if (frameCount % 2 === 0) {
        let lineIndex = 0;
        const threshold = 22;
        const thresholdSq = threshold * threshold;
        for (let i = 0; i < DUST_COUNT && lineIndex < MAX_LINES; i++) {
          for (let j = i + 1; j < DUST_COUNT && lineIndex < MAX_LINES; j++) {
            const dx = dp[i * 3] - dp[j * 3];
            const dy = dp[i * 3 + 1] - dp[j * 3 + 1];
            const dz = dp[i * 3 + 2] - dp[j * 3 + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < thresholdSq) {
              linePos[lineIndex * 6] = dp[i * 3];
              linePos[lineIndex * 6 + 1] = dp[i * 3 + 1];
              linePos[lineIndex * 6 + 2] = dp[i * 3 + 2];
              linePos[lineIndex * 6 + 3] = dp[j * 3];
              linePos[lineIndex * 6 + 4] = dp[j * 3 + 1];
              linePos[lineIndex * 6 + 5] = dp[j * 3 + 2];
              lineIndex++;
            }
          }
        }
        lineGeo.setDrawRange(0, lineIndex * 2);
        lineGeo.attributes.position.needsUpdate = true;
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMouseMove);
      ro.disconnect();
      sphereGeo.dispose();
      sphereMat.dispose();
      dustGeo.dispose();
      dustMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      ring1.geometry.dispose(); ring1.material.dispose();
      ring2.geometry.dispose(); ring2.material.dispose();
      ring3.geometry.dispose(); ring3.material.dispose();
      particleTex.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={containerRef} className="login-particle-wave" aria-hidden="true" />;
}
