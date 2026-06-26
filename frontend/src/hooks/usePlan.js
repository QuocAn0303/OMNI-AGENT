/**
 * Frontend: src/hooks/usePlan.js — Hook quản lý gói subscription & feature flags
 *
 * Tổng quan:
 * - Gọi API /subscriptions/my/features để lấy thông tin gói, features, subscription
 * - Cung cấp isAllowed(moduleKey) để kiểm tra quyền truy cập module
 * - Cung cấp hasFeature(featureKey) để kiểm tra feature cụ thể
 * - isExpired kiểm tra gói đã hết hạn chưa
 * - allowedModules chứa danh sách module được phép ('*' = tất cả)
 *
 * Exports:
 * - usePlan (default): Trả về { plan, features, subscription, isExpired, isAllowed, hasFeature, loading, refetch }
 */
import { useState, useEffect, useCallback } from 'react'
import api from '../api/axios'

export default function usePlan() {
  const [planData, setPlanData] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/subscriptions/my/features')
      setPlanData(res.data.data)
    } catch {
      setPlanData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  const features = planData?.features || {}
  const plan = planData?.plan || null
  const subscription = planData?.subscription || null
  const isExpired = planData?.isExpired || false
  const allowedModules = features.allowedModules || []

  const isAllowed = (moduleKey) => {
    if (allowedModules.includes('*')) return true
    return allowedModules.includes(moduleKey)
  }

  const hasFeature = (featureKey) => {
    if (allowedModules.includes('*')) return true
    const val = features[featureKey]
    return val !== false && val !== 0
  }

  return { plan, features, subscription, isExpired, isAllowed, hasFeature, loading, refetch: fetch }
}