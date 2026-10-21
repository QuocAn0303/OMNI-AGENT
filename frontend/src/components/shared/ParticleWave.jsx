import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * 3D Glowing Particle Wave — diagonal flow, high glow, accent particles.
 * Dùng ShaderMaterial để có per-particle size + color variance.
 */
export default function ParticleWave() {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const COLS = 150;
    const ROWS = 78;
    const COUNT = COLS * ROWS;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x070b14, 0.0018);

    const camera = new THREE.PerspectiveCamera(60, 1, 1, 1200);
    camera.position.set(70, 62, 150);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    // Soft circular particle texture
    const texCanvas = document.createElement("canvas");
    texCanvas.width = 64;
    texCanvas.height = 64;
    const tctx = texCanvas.getContext("2d");
    const grad = tctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.3, "rgba(255,255,255,0.85)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    tctx.fillStyle = grad;
    tctx.fillRect(0, 0, 64, 64);
    const particleTexture = new THREE.CanvasTexture(texCanvas);

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const sizes = new Float32Array(COUNT);
    const baseX = new Float32Array(COUNT);
    const baseY = new Float32Array(COUNT);
    const baseColor = new Float32Array(COUNT * 3);
    const isAccent = new Uint8Array(COUNT);

    const widthScale = 300;
    const heightScale = 190;

    const cyan = new THREE.Color("#00f0ff");
    const emerald = new THREE.Color("#00ffa3");
    const gold = new THREE.Color("#ffb703");
    const orange = new THREE.Color("#ff7b00");
    const white = new THREE.Color("#ffffff");
    const accentPalette = [gold, orange, white];

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

        // 10-15% accent particles
        const accent = Math.random() < 0.13;
        isAccent[i] = accent ? 1 : 0;
        let c;
        if (accent) {
          c = accentPalette[Math.floor(Math.random() * accentPalette.length)].clone();
          c.multiplyScalar(1.35);
        } else {
          const mix = Math.random();
          c = cyan.clone().lerp(emerald, mix);
          c.multiplyScalar(1.05 + Math.random() * 0.25);
        }
        baseColor[i * 3] = c.r;
        baseColor[i * 3 + 1] = c.g;
        baseColor[i * 3 + 2] = c.b;

        // size variance
        sizes[i] = 1.4 + Math.random() * 2.6;
      }
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));

    const vertexShader = `
      attribute float aSize;
      attribute vec3 color;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (360.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `;
    const fragmentShader = `
      uniform sampler2D uMap;
      varying vec3 vColor;
      void main() {
        vec4 tex = texture2D(uMap, gl_PointCoord);
        if (tex.a < 0.02) discard;
        gl_FragColor = vec4(vColor * tex.a * 1.4, tex.a);
      }
    `;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: particleTexture },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    const group = new THREE.Group();
    group.add(points);
    scene.add(group);

    // Mouse interaction
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

    const animate = () => {
      const t = clock.getElapsedTime();

      mouse.x += (mouse.tx - mouse.x) * 0.07;
      mouse.y += (mouse.ty - mouse.y) * 0.07;

      group.rotation.y = mouse.x * 0.22;
      group.rotation.x = -mouse.y * 0.16 + 0.15;

      const pos = geometry.attributes.position.array;
      const col = geometry.attributes.color.array;

      for (let i = 0; i < COUNT; i++) {
        const x = baseX[i];
        const y = baseY[i];

        // Diagonal flow: wave travels from bottom-left to top-right
        const along = (x + y) * 0.022;
        const across = (x - y) * 0.018;

        let z =
          Math.sin(along + t * 1.05) * 20 +
          Math.cos(across + t * 0.85) * 14 +
          Math.sin((x * 0.015 - y * 0.012) + t * 0.45) * 12 +
          Math.sin(x * 0.008 + y * 0.006 + t * 0.3) * 10 +
          // mouse ripple
          Math.sin((x * 0.025 + mouse.x * 3) + (y * 0.025 + mouse.y * 3) + t * 0.7) * 7;

        pos[i * 3 + 2] = z;

        // Brightness boost at peaks
        const heightFactor = (z + 45) / 90; // 0..1
        const boost = 0.75 + 0.55 * Math.max(0, Math.min(1, heightFactor));
        const br = baseColor[i * 3] * boost;
        const bg = baseColor[i * 3 + 1] * boost;
        const bb = baseColor[i * 3 + 2] * boost;
        col[i * 3] = br;
        col[i * 3 + 1] = bg;
        col[i * 3 + 2] = bb;
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

  return <div ref={containerRef} className="login-particle-wave" aria-hidden="true" />;
}
