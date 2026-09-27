/**
 * Unit tests for offline order queue logic
 *
 * Tests the core logic without requiring browser IndexedDB.
 * Uses in-memory store to simulate the queue behavior.
 */

// ---- In-memory queue (replicates offlineQueue logic) ----
class InMemoryQueue {
  constructor() {
    this.orders = [];
    this.listeners = [];
    this.online = true;
  }

  async enqueue(orderData) {
    const record = {
      id: `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      orderData,
      status: 'pending',
      createdAt: new Date().toISOString(),
      retryCount: 0,
      error: null,
    };
    this.orders.push(record);
    return record;
  }

  async getPendingCount() {
    return this.orders.filter(r => r.status === 'pending' || r.status === 'failed').length;
  }

  async getPendingOrders() {
    return this.orders.filter(r => r.status === 'pending' || r.status === 'failed');
  }

  async removeOrder(id) {
    this.orders = this.orders.filter(r => r.id !== id);
  }

  async syncOrders(postFn) {
    if (!this.online) return { synced: 0, failed: 0, message: 'Offline' };

    const pending = await this.getPendingOrders();
    if (pending.length === 0) return { synced: 0, failed: 0 };

    let synced = 0;
    let failed = 0;

    for (const record of pending) {
      try {
        record.status = 'syncing';
        await postFn(record.orderData);
        this.orders = this.orders.filter(r => r.id !== record.id);
        synced++;
      } catch (err) {
        record.status = 'failed';
        record.retryCount++;
        record.error = err.message;
        failed++;
      }
    }
    return { synced, failed, total: pending.length };
  }

  isOnline() {
    return this.online;
  }

  onStatusChange(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  notifyOnline() {
    this.listeners.forEach(fn => fn(true));
  }

  notifyOffline() {
    this.listeners.forEach(fn => fn(false));
  }
}

// ---- Tests ----
describe('Offline Queue Logic', () => {
  let queue;

  beforeEach(() => {
    queue = new InMemoryQueue();
  });

  test('enqueue adds order with pending status', async () => {
    const order = { customerId: null, items: [], total: 100000 };
    const record = await queue.enqueue(order);

    expect(record.status).toBe('pending');
    expect(record.orderData).toEqual(order);
    expect(record.id).toMatch(/^offline_/);
    expect(record.retryCount).toBe(0);
  });

  test('getPendingCount returns correct count', async () => {
    expect(await queue.getPendingCount()).toBe(0);

    await queue.enqueue({ items: [] });
    expect(await queue.getPendingCount()).toBe(1);

    await queue.enqueue({ items: [] });
    await queue.enqueue({ items: [] });
    expect(await queue.getPendingCount()).toBe(3);
  });

  test('getPendingOrders returns only pending/failed', async () => {
    await queue.enqueue({ items: [1] });
    await queue.enqueue({ items: [2] });

    const orders = await queue.getPendingOrders();
    expect(orders.length).toBe(2);
    expect(orders[0].status).toBe('pending');
  });

  test('removeOrder deletes correctly', async () => {
    const record = await queue.enqueue({ items: [] });
    expect(await queue.getPendingCount()).toBe(1);

    await queue.removeOrder(record.id);
    expect(await queue.getPendingCount()).toBe(0);
  });

  test('syncOrders when online posts pending orders', async () => {
    const postFn = jest.fn().mockResolvedValue({ success: true });
    await queue.enqueue({ items: [1] });
    await queue.enqueue({ items: [2] });

    const result = await queue.syncOrders(postFn);

    expect(result.synced).toBe(2);
    expect(result.failed).toBe(0);
    expect(postFn).toHaveBeenCalledTimes(2);
    expect(await queue.getPendingCount()).toBe(0);
  });

  test('syncOrders marks failed on post error', async () => {
    const postFn = jest.fn()
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('Network error'));

    await queue.enqueue({ items: [1] });
    await queue.enqueue({ items: [2] });

    const result = await queue.syncOrders(postFn);

    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);
    const pending = await queue.getPendingOrders();
    expect(pending.length).toBe(1);
    expect(pending[0].status).toBe('failed');
    expect(pending[0].retryCount).toBe(1);
    expect(pending[0].error).toBe('Network error');
  });

  test('onStatusChange registers and notifies listeners', () => {
    const mockFn = jest.fn();
    const unsub = queue.onStatusChange(mockFn);

    queue.notifyOffline();
    expect(mockFn).toHaveBeenCalledWith(false);

    queue.notifyOnline();
    expect(mockFn).toHaveBeenCalledWith(true);

    mockFn.mockClear();
    unsub();
    queue.notifyOnline();
    expect(mockFn).not.toHaveBeenCalled();
  });

  test('syncOrders does nothing when empty', async () => {
    const postFn = jest.fn();
    const result = await queue.syncOrders(postFn);
    expect(result.synced).toBe(0);
    expect(result.failed).toBe(0);
    expect(postFn).not.toHaveBeenCalled();
  });
});
