/**
 * Frontend: src/components/RequireRole.jsx — RequireRole
 * 
 * Tổng quan:
 * - Kiểm tra role của user hiện tại, chỉ cho phép truy cập nếu role nằm trong danh sách roles.
 * - Nếu chưa đăng nhập → redirect /login.
 * - Nếu không đủ quyền → redirect /403.
 * 
 * Props:
 * - roles: string[] — danh sách role được phép
 * 
 * Hàm/Exports:
 * - RequireRole: Component kiểm tra phân quyền
 */
import { Navigate, Outlet } from 'react-router-dom'
import useAuthStore from '../stores/authStore'

export default function RequireRole({ roles }) {
  const user = useAuthStore((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  if (!roles.includes(user.role)) return <Navigate to="/403" replace />
  return <Outlet />
}
