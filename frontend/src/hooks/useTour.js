/**
 * Frontend: src/hooks/useTour.js — Hook quản lý hướng dẫn (Tour) cho người dùng mới
 *
 * Tổng quan:
 * - Kiểm tra localStorage với key 'tour_{tourKey}_done' để biết đã xem tour chưa
 * - Nếu chưa xem, tự động kích hoạt tour sau 800ms (để page render xong)
 * - markDone: đánh dấu đã xem xong tour (lưu localStorage)
 * - restart: xoá trạng thái đã xem và kích hoạt lại tour
 *
 * Exports:
 * - useTour (default): Trả về { run, markDone, restart }
 */
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
