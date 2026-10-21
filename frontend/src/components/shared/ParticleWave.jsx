import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * 3D Glowing Particle Wave (Three.js)
 * - Lưới hạt 3D dập dềnh theo thời gian (sóng sin + pseudo-noise)
 * - Additive blending + texture mềm → glow tự nhiên
 * - Depth of field qua fog + sizeAttenuation
 * - Tương tác chuột nhẹ + resize an toàn + cleanup đầy đủ
 */
export default function ParticleWave() {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const COLS = 130;
    const ROWS = 78;
    const COUNT = COLS * ROWS;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0b1220, 0.0022);

    const camera = new THREE.PerspectiveCamera(55, 1, 1, 1000);
    camera.position.set(0, 52, 135);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    // Texture hạt tròn mềm (soft alpha) để glow khi chồng lên nhau
    const texCanvas = document.createElement("canvas");
    texCanvas.width = 64;
    texCanvas.height = 64;
    const tctx = texCanvas.getContext("2d");
    const grad = tctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.7)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    tctx.fillStyle = grad;
    tctx.fillRect(0, 0, 64, 64);
    const particleTexture = new THREE.CanvasTexture(texCanvas);

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const baseX = new Float32Array(COUNT);
    const baseY = new Float32Array(COUNT);

    const widthScale = 260;
    const heightScale = 150;

    for (let yi = 0; yi < ROWS; yi++) {
      for (let xi = 0; xi < COLS; xi++) {
        const i = yi * COLS + xi;
        const x = (xi / (COLS - 1) - 0.5) * widthScale;
        const y = (yi / (ROWS - 1) - 0.5) * heightScale;
        baseX[i] = x;
        baseY[i] = y;
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = 0;
      }
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 2.6,
      map: particleTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      vertexColors: true,
      opacity: 0.95,
    });

    const points = new THREE.Points(geometry, material);
    const group = new THREE.Group();
    group.add(points);
    scene.add(group);

    // Mouse interaction (normalized -1..1)
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

    // Màu Cyan (#00f0ff) → Emerald (#10b981) theo độ cao z
    const cyan = new THREE.Color("#00f0ff");
    const emerald = new THREE.Color("#10b981");
    const tmpColor = new THREE.Color();

    let raf = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      const t = clock.getElapsedTime();

      // Lerp mouse
      mouse.x += (mouse.tx - mouse.x) * 0.06;
      mouse.y += (mouse.ty - mouse.y) * 0.06;

      group.rotation.y = mouse.x * 0.18;
      group.rotation.x = -mouse.y * 0.12;

      const pos = geometry.attributes.position.array;
      const col = geometry.attributes.color.array;

      for (let i = 0; i < COUNT; i++) {
        const x = baseX[i];
        const y = baseY[i];

        // Multi-layered undulation (sin + pseudo-noise)
        let z =
          Math.sin(x * 0.035 + t * 0.9) * 14 +
          Math.cos(y * 0.045 + t * 0.7) * 12 +
          Math.sin((x + y) * 0.02 + t * 0.5) * 8 +
          Math.sin(x * 0.012 + y * 0.018 + t * 0.35) * 16 +
          // gợn theo chuột
          Math.sin((x * 0.02 + mouse.x * 2) + (y * 0.02 + mouse.y * 2) + t * 0.6) * 6;

        pos[i * 3 + 2] = z;

        // Màu theo độ cao (depth)
        const n = (z + 40) / 80; // 0..1
        tmpColor.copy(cyan).lerp(emerald, Math.min(1, Math.max(0, n)));
        // xa hơn (y lớn) tối/mờ hơn một chút
        const fade = 1 - Math.abs(y) / (heightScale * 0.9);
        tmpColor.multiplyScalar(0.7 + 0.3 * Math.max(0, fade));
        col[i * 3] = tmpColor.r;
        col[i * 3 + 1] = tmpColor.g;
        col[i * 3 + 2] = tmpColor.b;
      }

      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;

      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMouseMove);
      ro.disconnect();
      geometry.dispose();
      material.dispose();
      particleTexture.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="login-particle-wave"
      aria-hidden="true"
    />
  );
}
