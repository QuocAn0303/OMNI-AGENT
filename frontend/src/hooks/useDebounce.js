/**
 * Frontend: src/hooks/useDebounce.js — Hook debounce giá trị
 *
 * Tổng quan:
 * - Debounce một giá trị (value) trong khoảng thời gian delay (mặc định 300ms)
 * - Dùng cho search input, filter để tránh gọi API quá nhiều
 * - Sử dụng useState + useEffect với setTimeout, tự động cleanup
 *
 * Exports:
 * - useDebounce (default): Trả về giá trị đã được debounce
 */
import { useState, useEffect } from 'react'

export default function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
