import { useEffect, useRef } from "react";

export default function useBarcodeScanner(onScan, options = {}) {
  const { minLength = 4, timeout = 50 } = options;
  const bufferRef = useRef("");
  const timerRef = useRef(null);
  const callbackRef = useRef(onScan);

  useEffect(() => {
    callbackRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    const reset = () => {
      bufferRef.current = "";
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };

    const onKeyDown = (event) => {
      const tag = event.target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || event.target?.isContentEditable) return;

      if (event.key === "Enter") {
        const code = bufferRef.current;
        reset();
        if (code.length >= minLength) callbackRef.current?.(code);
        return;
      }

      if (event.key.length !== 1) return;
      bufferRef.current += event.key;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(reset, timeout);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      reset();
    };
  }, [minLength, timeout]);
}
