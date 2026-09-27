/**
 * Offline Queue Service — Queues POS orders when offline, syncs when online
 *
 * Uses IndexedDB to store pending orders. When the network is restored,
 * orders are automatically synced to the server.
 *
 * Exports:
 * - enqueueOrder(orderData): Add order to offline queue
 * - syncOrders(): Try to sync all pending orders
 * - getPendingCount(): Get number of unsynced orders
 * - getPendingOrders(): Get all pending orders
 * - removeOrder(id): Remove a specific order
 * - isOnline(): Check current online status
 * - initOfflineMode(): Setup online/offline listeners
 */

const DB_NAME = 'aduu_offline';
const DB_VERSION = 1;
const STORE_NAME = 'pending_orders';

let db = null;
let onlineStatus = navigator.onLine;
let onlineListeners = [];

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: false,
        });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('status', 'status', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Add order to offline queue
 */
export async function enqueueOrder(orderData) {
  const database = await openDB();
  const id = `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const record = {
      id,
      orderData,
      status: 'pending', // pending | syncing | synced | failed
      createdAt: new Date().toISOString(),
      retryCount: 0,
      error: null,
    };

    const request = store.add(record);
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Sync all pending orders to server
 */
export async function syncOrders(axiosInstance) {
  if (!onlineStatus) {
    return { synced: 0, failed: 0, message: 'Offline' };
  }

  const database = await openDB();
  const pending = await getPendingOrders();

  if (pending.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  for (const record of pending) {
    try {
      // Mark as syncing
      const tx1 = database.transaction(STORE_NAME, 'readwrite');
      const store1 = tx1.objectStore(STORE_NAME);
      await new Promise((resolve) => {
        store1.get(record.id).onsuccess = (e) => {
          const r = e.target.result;
          if (r) {
            r.status = 'syncing';
            store1.put(r);
          }
          resolve();
        };
      });
      await new Promise(r => setTimeout(r, 10));

      // Send to server
      await axiosInstance.post('/orders', record.orderData);

      // Remove on success
      const tx2 = database.transaction(STORE_NAME, 'readwrite');
      const store2 = tx2.objectStore(STORE_NAME);
      store2.delete(record.id);

      synced++;
    } catch (err) {
      // Mark as failed
      const tx3 = database.transaction(STORE_NAME, 'readwrite');
      const store3 = tx3.objectStore(STORE_NAME);
      await new Promise((resolve) => {
        store3.get(record.id).onsuccess = (e) => {
          const r = e.target.result;
          if (r) {
            r.status = 'failed';
            r.retryCount = (r.retryCount || 0) + 1;
            r.error = err.response?.data?.message || err.message;
            store3.put(r);
          }
          resolve();
        };
      });

      failed++;
    }
  }

  return { synced, failed, total: pending.length };
}

/**
 * Get count of pending orders
 */
export async function getPendingCount() {
  const database = await openDB();
  return new Promise((resolve) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(0);
  });
}

/**
 * Get all pending orders (not yet synced)
 */
export async function getPendingOrders() {
  const database = await openDB();
  return new Promise((resolve) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const all = request.result || [];
      resolve(all.filter(r => r.status === 'pending' || r.status === 'failed'));
    };
    request.onerror = () => resolve([]);
  });
}

/**
 * Remove a specific order
 */
export async function removeOrder(id) {
  const database = await openDB();
  return new Promise((resolve) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve();
  });
}

/**
 * Current online status
 */
export function isOnline() {
  return onlineStatus;
}

/**
 * Register online/offline listener
 */
export function onStatusChange(fn) {
  onlineListeners.push(fn);
  return () => {
    onlineListeners = onlineListeners.filter(l => l !== fn);
  };
}

/**
 * Initialize offline mode
 */
export function initOfflineMode(axiosInstance) {
  const handleOnline = async () => {
    onlineStatus = true;
    onlineListeners.forEach(fn => fn(true));
    try {
      await syncOrders(axiosInstance);
    } catch {
      // Silent fail
    }
  };

  const handleOffline = () => {
    onlineStatus = false;
    onlineListeners.forEach(fn => fn(false));
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}
