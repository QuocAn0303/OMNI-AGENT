/**
 * Frontend: src/utils/pushSubscribe.js — Web Push (PWA) subscribe helper
 *
 * Flow:
 * 1. Đợi service worker ready (sw.js đã precache + push listener)
 * 2. Lấy VAPID public key từ GET /api/push/config
 * 3. PushManager.subscribe → lưu subscription qua POST /api/push/subscribe
 * 4. Cờ localStorage `push_subscribed` tránh đăng ký lặp lại
 */
import api from '../api/axios';

const SUBSCRIBED_KEY = 'push_subscribed';

const urlBase64ToUint8Array = (base64) => {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

const bufToB64 = (buf) => {
  if (!buf) return null;
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
};

export const isPushSupported = () =>
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export const isSubscribed = () => localStorage.getItem(SUBSCRIBED_KEY) === '1';

export async function subscribeToPush() {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' };
  if (isSubscribed()) return { ok: true, cached: true };

  try {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.pushManager) return { ok: false, reason: 'unsupported' };

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const res = await api.get('/push/config');
      const publicKey = res.data?.data?.publicKey;
      if (!publicKey) return { ok: false, reason: 'no-config' };
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    await api.post('/push/subscribe', {
      subscription: {
        endpoint: sub.endpoint,
        keys: {
          p256dh: bufToB64(sub.getKey('p256dh')),
          auth: bufToB64(sub.getKey('auth')),
        },
      },
    });
    localStorage.setItem(SUBSCRIBED_KEY, '1');
    return { ok: true };
  } catch (e) {
    // NotAllowedError = user từ chối — không retry vô hạn
    if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
      localStorage.setItem(SUBSCRIBED_KEY, 'denied');
    }
    return { ok: false, reason: e?.name || 'error' };
  }
}

export async function unsubscribeFromPush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api.delete('/push/subscribe', { data: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
    }
  } catch {
    // bỏ qua — cleanup best-effort
  } finally {
    localStorage.removeItem(SUBSCRIBED_KEY);
  }
}
