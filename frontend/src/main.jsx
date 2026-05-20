import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './i18n'
import './styles/variable.css'
import './styles/global.css'
import './styles/layout.css'
import './styles/pages.css'
import App from './App.jsx'

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 0,
    integrations: [Sentry.browserTracingIntegration()],
  });
}

const FallbackUI = () => (
  <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 32, textAlign: 'center' }}>
    <div>
      <h2 style={{ marginBottom: 8 }}>Đã xảy ra lỗi</h2>
      <p style={{ color: '#64748b', marginBottom: 16 }}>Vui lòng tải lại trang hoặc liên hệ hỗ trợ.</p>
      <button onClick={() => window.location.reload()} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#0f766e', color: '#fff', cursor: 'pointer' }}>
        Tải lại trang
      </button>
    </div>
  </div>
);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={FallbackUI}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
