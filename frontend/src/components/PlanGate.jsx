/**
 * Frontend: src/components/PlanGate.jsx — PlanGate
 * 
 * Tổng quan:
 * - Cổng kiểm soát truy cập dựa trên gói đăng ký (plan).
 * - Kiểm tra moduleKey qua isAllowed() hoặc featureKey qua hasFeature().
 * - Nếu không được phép → hiển thị UpgradePrompt thay vì children.
 * 
 * Props:
 * - moduleKey: string — key module cần kiểm tra
 * - featureKey: string (optional) — key tính năng cụ thể
 * - moduleName: string — tên hiển thị khi bị chặn
 * - children: ReactNode — nội dung được render nếu được phép
 * 
 * Hàm/Exports:
 * - PlanGate: Component chặn theo gói
 */
import usePlan from '../hooks/usePlan'
import UpgradePrompt from './UpgradePrompt'
import { Spin } from 'antd'

export default function PlanGate({ moduleKey, featureKey, moduleName, children }) {
  const { isAllowed, hasFeature, loading } = usePlan()

  if (loading) return <Spin style={{ display: 'block', margin: '48px auto' }} />

  if (featureKey) {
    if (!hasFeature(featureKey)) {
      return <UpgradePrompt moduleName={moduleName} />
    }
    return children
  }

  if (!isAllowed(moduleKey)) {
    return <UpgradePrompt moduleName={moduleName} />
  }

  return children
}
