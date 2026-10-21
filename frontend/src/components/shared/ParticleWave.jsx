import { useEffect, useRef } from "react";

/**
 * Nền "3D particle wave" bằng Canvas 2D (không cần thêm dependency).
 * Vẽ lưới điểm có độ sâu giả 3D + sóng động; tự co giãn theo container.
 */
export default function ParticleWave({ color = "rgba(20,184,166,0.9)" }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf = 0;
    let t = 0;
    let width = 0;
    let height = 0;
    const COLS = 70;
    const ROWS = 38;
    const FOV = 320;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const render = () => {
      t += 0.012;
      ctx.clearRect(0, 0, width, height);

      const spacing = Math.max(18, width / COLS);
      const originX = width / 2;
      const originY = height * 0.55;

      for (let yi = 0; yi < ROWS; yi++) {
        for (let xi = 0; xi < COLS; xi++) {
          const x = (xi - COLS / 2) * spacing;
          const y = (yi - ROWS / 2) * spacing;
          const wave =
            Math.sin(xi * 0.22 + t * 1.1) *
            Math.cos(yi * 0.28 + t * 0.9) *
            26 +
            Math.sin((xi + yi) * 0.15 + t * 0.7) * 10;
          const z = wave;

          const scale = FOV / (FOV + z + 120);
          const px = originX + x * scale;
          const py = originY + y * scale * 0.6;
          const size = Math.max(0.6, 1.6 * scale);
          const alpha = Math.max(0.05, Math.min(0.85, (scale - 0.5) * 1.4));

          ctx.beginPath();
          ctx.arc(px, py, size, 0, Math.PI * 2);
          ctx.fillStyle = color.replace(/[\d.]+\)$/, alpha + ")");
          ctx.fill();
        }
      }

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [color]);

  return (
    <canvas
      ref={canvasRef}
      className="login-particle-wave"
      aria-hidden="true"
    />
  );
}
