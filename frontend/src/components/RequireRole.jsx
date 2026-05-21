import { Navigate, Outlet } from 'react-router-dom'
import useAuthStore from '../stores/authStore'

export default function RequireRole({ roles }) {
  const user = useAuthStore((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  if (!roles.includes(user.role)) return <Navigate to="/403" replace />
  return <Outlet />
}
