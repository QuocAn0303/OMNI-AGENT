import { useState, useEffect } from 'react';

export default function useTour(tourKey) {
  const storageKey = `tour_${tourKey}_done`;
  const [run, setRun] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(storageKey)) {
      // Delay nhỏ để page render xong
      const t = setTimeout(() => setRun(true), 800);
      return () => clearTimeout(t);
    }
  }, [storageKey]);

  const markDone = () => {
    localStorage.setItem(storageKey, 'true');
    setRun(false);
  };

  const restart = () => {
    localStorage.removeItem(storageKey);
    setRun(true);
  };

  return { run, markDone, restart };
}
