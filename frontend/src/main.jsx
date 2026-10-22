/**
 * Frontend: src/main.jsx — Entry point của ứng dụng ERP
 *
 * Tổng quan:
 * - File khởi tạo React root, mount ứng dụng vào DOM
 * - Import i18n, styles (variable.css, global.css, layout.css, pages.css)
 * - Cấu hình Sentry (error tracking) nếu có VITE_SENTRY_DSN
 * - Bọc App trong StrictMode + Sentry.ErrorBoundary với FallbackUI
 *
 * Components/Hooks/Exports:
 * - FallbackUI: Component hiển thị khi Sentry bắt được lỗi, có nút tải lại trang
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './i18n'
import './styles/variable.css'
import './styles/global.css'
import './styles/layout.css'
import './styles/pages.css'
import App from './App.jsx'
import { initOfflineMode } from './utils/offlineQueue'
import axios from './api/axios'

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 0,
    integrations: [Sentry.browserTracingIntegration()],
    // H1 (security): dọn PII/credential trước khi gửi lên Sentry.
    // Access token của dự án chỉ nằm trong memory (Zustand), nên đây là biện pháp
    // bảo vệ duy nhất chống việc token bị lộ qua telemetry. `event.request.headers`
    // chứa Authorization/Cookie; `event.extra` là nơi SDK chép các property
    // enumerable của Error — với AxiosError đó là `config` (kèm headers + data),
    // `request`, `response`. Xoá cả ba trước khi event rời browser.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.headers;
        delete event.request.cookies;
        delete event.request.data;
      }
      delete event.extra;
      return event;
    },
  });
}

// Initialize offline mode
initOfflineMode(axios);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={() => (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 32, textAlign: 'center' }}>
        <div>
          <h2 style={{ marginBottom: 8 }}>Đã xảy ra lỗi</h2>
          <p style={{ color: '#64748b', marginBottom: 16 }}>Vui lòng tải lại trang hoặc liên hệ hỗ trợ.</p>
          <button onClick={() => window.location.reload()} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#0f766e', color: '#fff', cursor: 'pointer' }}>
            Tải lại trang
          </button>
        </div>
      </div>
    )}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
