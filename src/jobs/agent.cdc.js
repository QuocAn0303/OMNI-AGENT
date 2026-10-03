/**
 * jobs/agent.cdc.js — Change Data Capture cho AI Agent
 * 
 * Tổng quan:
 * - Dùng PostgreSQL LISTEN/NOTIFY để theo dõi thay đổi dữ liệu real-time
 * - Tạo database triggers trên bảng inventories, orders, payments
 * - Khi có sự kiện → handler tự động xử lý: tạo PO, tạo task follow-up, thông báo
 * - Chạy song song với cron, bổ sung cho real-time socket
 * 
 * Hàm:
 * - EVENT_HANDLERS: Object chứa handlers cho từng event type
 *     - LOW_STOCK: Tồn kho = 0 → tự tạo draft PO + emit AI_ACTION cho MANAGER
 *     - ORDER_COMPLETED: Đơn hoàn thành → tạo task follow-up cho customer
 *     - PAYMENT_RECEIVED: Thanh toán mới → thông báo real-time cho MANAGER
 * - ensureSchema(): Tạo/tái tạo PL/pgSQL trigger functions + triggers trên DB
 * - startCDC(): Kết nối PostgreSQL, LISTEN agent_events, xử lý notification
 * - stopCDC(): Ngắt kết nối, dọn dẹp pool
 */

const { Pool } = require('pg');
const logger = require('../utils/logger');
const { getIo } = require('../realtime/socket');
const { runWithTenant } = require('../config/tenantContext');

let pool = null;
let listening = false;

/**
 * Khoảng gộp ("debounce") cho đề xuất tồn kho, tính theo (tenant, SKU).
 *
 * Vì sao cần: trigger `notify_agent_inventory_change` bắn MỖI LẦN ghi vào
 * `inventories`. Một lần nhập hàng 500 dòng sẽ bắn hàng trăm sự kiện cho cùng
 * một SKU. Không gộp thì hệ thống quét lại lịch sử 28 ngày hàng trăm lần.
 *
 * Giá trị 60s là chọn có chủ đích: đủ để gom một đợt nhập hàng, và ngắn hơn đáng
 * kể so với TTL 24h của gate nên không ảnh hưởng độ trễ phát hiện.
 */
const LOW_STOCK_DEBOUNCE_MS = Number(process.env.CDC_LOW_STOCK_DEBOUNCE_MS) || 60_000;

/** key -> timer, chỉ giữ trong RAM. Mất khi restart — chấp nhận được. */
const lowStockTimers = new Map();

/**
 * Gộp sự kiện theo (tenant, SKU) trong `LOW_STOCK_DEBOUNCE_MS`.
 * Trả về true nghĩa là sự kiện này bị gộp (đã có hẹn giờ rồi).
 */
const shouldDebounce = (key) => {
  if (lowStockTimers.has(key)) return true;
  const timer = setTimeout(() => lowStockTimers.delete(key), LOW_STOCK_DEBOUNCE_MS);
  // Không giữ tiến trình sống chỉ vì một timer debounce.
  if (typeof timer.unref === 'function') timer.unref();
  lowStockTimers.set(key, timer);
  return false;
};

const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 5000,
};

const EVENT_HANDLERS = {
  /**
   * Tồn thấp / hết hàng → SINH ĐỀ XUẤT, không tạo PO.
   *
   * Trước đây nhánh này gọi thẳng `purchaseService.create({ vendorId: null, ... })`
   * trong khi `purchase.service.js:116` chặn cứng `vendorId` rỗng ⇒ **mọi lần chạy
   * đều chỉ ghi log lỗi**, chưa bao giờ tạo được PO nào (phát hiện F1 ở
   * `00-scope.md`). Nay nó đi qua cùng cơ chế đề xuất của người dùng: công thức
   * tính số, agent soạn đề xuất, ADMIN/MANAGER duyệt, rồi mới có PO.
   */
  LOW_STOCK: async (data) => {
    // `tenantId` đến từ `row_to_json(NEW)` — tức từ DÒNG DỮ LIỆU HỆ THỐNG, không
    // phải từ dữ liệu người dùng. Thiếu thì bỏ qua và ghi log để lộ ra.
    const tenantId = data?.tenantId;
    if (!tenantId) {
      logger.error(
        '[CDC] LOW_STOCK thiếu tenantId trong payload trigger — bỏ qua ' +
        `(payload: ${JSON.stringify(data).slice(0, 200)})`,
      );
      return;
    }
    if (!data?.productId) {
      logger.error('[CDC] LOW_STOCK thiếu productId — bỏ qua');
      return;
    }
    if (shouldDebounce(`${tenantId}:${data.productId}`)) return;

    // Chạy NGOÀI request ⇒ không có tenant context ⇒ phải bọc, nếu không Prisma
    // extension không tiêm tenantId và ta sẽ đọc/ghi nhầm tenant.
    await runWithTenant(tenantId, async () => {
      const { suggestForProduct } = require('../modules/replenishment/replenishment.suggest');
      const result = await suggestForProduct({ tenantId, productId: data.productId });

      if (result?.needVendor) {
        logger.info(`[CDC] ${result.sku} cần nhập nhưng chưa có NCC — chờ người chọn, không tự đặt`);
      } else if (result?.gate) {
        const io = getIo();
        if (io) {
          io.to(`tenant:${tenantId}:role:MANAGER`).emit('AI_ACTION', {
            type: 'PO_PROPOSAL',
            message: `🤖 Có đề xuất nhập hàng mới cần bạn duyệt`,
            data: { gateId: result.gate.id, actionSummary: result.gate.actionSummary },
          });
        }
      }
    });
  },

  ORDER_COMPLETED: async (data) => {
    try {
      const tasksService = require('../modules/crm/tasks.service');
      const prisma = require('../config/prisma');
const logger = require('../utils/logger');

      const order = await prisma.order.findUnique({
        where: { id: data.id || data.id },
        include: { customer: true },
      });

      if (!order?.customerId) return;

      // Check if customer has recent negative feedback
      const recentNotes = await prisma.customerNote.count({
        where: { customerId: order.customerId, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      });

      if (recentNotes === 0) {
        // Create a follow-up task
        const task = await tasksService.create({
          customerId: order.customerId,
          priority: 'medium',
          description: `Follow up after order ${order.orderCode || order.id}`,
          assignedToId: null,
          tenantId: order.tenantId,
        });

        const io = getIo();
        if (io && order.tenantId) {
          io.to(`tenant:${order.tenantId}:role:SALE`).emit('AI_ACTION', {
            type: 'FOLLOW_UP_TASK',
            message: `🤖 Đã tạo task chăm sóc sau đơn hàng ${order.orderCode || ''}`,
            data: task,
          });
        }
      }
    } catch (e) {
      logger.error('[CDC] ORDER_COMPLETED handler error:', e.message);
    }
  },

  PAYMENT_RECEIVED: async (data) => {
    try {
      const io = getIo();
      if (io && data.tenantId) {
        io.to(`tenant:${data.tenantId}:role:MANAGER`).emit('AI_ACTION', {
          type: 'PAYMENT_NOTIFY',
          message: `💳 Thanh toán ${data.amount ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(data.amount) : 'mới'} đã được ghi nhận.`,
          data,
        });
      }
    } catch (e) {
      logger.error('[CDC] PAYMENT_RECEIVED handler error:', e.message);
    }
  },
};

async function ensureSchema() {
  if (!pool) {
    pool = new Pool(poolConfig);
  }

  const client = await pool.connect();
  try {
    // Create NOTIFY trigger function for inventory
    await client.query(`
      CREATE OR REPLACE FUNCTION notify_agent_inventory_change()
      RETURNS TRIGGER AS $$
      DECLARE
        available INTEGER;
      BEGIN
        available := NEW.quantity - COALESCE(NEW.reserved, 0);
        IF available <= 0 OR available <= COALESCE(NEW."minStock", 0) THEN
          PERFORM pg_notify('agent_events', json_build_object(
            'type', 'LOW_STOCK',
            'data', row_to_json(NEW)
          )::text);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create NOTIFY trigger function for orders
    await client.query(`
      CREATE OR REPLACE FUNCTION notify_agent_order_change()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.status = 'COMPLETED' AND OLD.status != 'COMPLETED' THEN
          PERFORM pg_notify('agent_events', json_build_object(
            'type', 'ORDER_COMPLETED',
            'data', row_to_json(NEW)
          )::text);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create NOTIFY trigger function for payments
    await client.query(`
      CREATE OR REPLACE FUNCTION notify_agent_payment_change()
      RETURNS TRIGGER AS $$
      BEGIN
        PERFORM pg_notify('agent_events', json_build_object(
          'type', 'PAYMENT_RECEIVED',
          'data', row_to_json(NEW)
        )::text);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Drop and recreate triggers (safe to run multiple times)
    await client.query('DROP TRIGGER IF EXISTS agent_inventory_trigger ON inventories');
    await client.query(`
      CREATE TRIGGER agent_inventory_trigger
      AFTER INSERT OR UPDATE ON inventories
      FOR EACH ROW EXECUTE FUNCTION notify_agent_inventory_change()
    `);

    await client.query('DROP TRIGGER IF EXISTS agent_order_trigger ON orders');
    await client.query(`
      CREATE TRIGGER agent_order_trigger
      AFTER UPDATE ON orders
      FOR EACH ROW EXECUTE FUNCTION notify_agent_order_change()
    `);

    await client.query('DROP TRIGGER IF EXISTS agent_payment_trigger ON payments');
    await client.query(`
      CREATE TRIGGER agent_payment_trigger
      AFTER INSERT ON payments
      FOR EACH ROW EXECUTE FUNCTION notify_agent_payment_change()
    `);

    logger.info('[CDC] Database triggers ensured');
  } finally {
    client.release();
  }
}

async function startCDC() {
  if (listening) return;
  listening = true;

  try {
    await ensureSchema();
    if (!pool) pool = new Pool(poolConfig);

    const client = await pool.connect();
    await client.query('LISTEN agent_events');

    client.on('notification', (msg) => {
      let event = null;
      try {
        event = JSON.parse(msg.payload);
      } catch (e) {
        logger.error('[CDC] Không parse được payload NOTIFY:', e.message);
        return;
      }

      const handler = EVENT_HANDLERS[event?.type];
      if (!handler) return;

      // Bọc bằng async IIFE + try/catch: handler là `async` nên lỗi bên trong
      // sẽ thành Promise rejection. Nếu không bắt ở đây thì một sự kiện hỏng có
      // thể kéo sập listener và CDC im lặng vĩnh viễn — tệ hơn nhiều so với bỏ
      // qua một sự kiện.
      Promise.resolve()
        .then(() => handler(event.data || event))
        .catch((e) =>
          logger.error(`[CDC] Handler lỗi cho ${event.type}: ${e.message}`)
        );
    });

    client.on('error', (e) => {
      logger.error('[CDC] Connection error:', e.message);
      listening = false;
      setTimeout(startCDC, 5000);
    });

    logger.info('[CDC] Listening for agent events...');
  } catch (e) {
    logger.error('[CDC] Failed to start:', e.message);
    listening = false;
  }
}

function stopCDC() {
  if (pool) {
    pool.end().catch(() => {});
    pool = null;
  }
  listening = false;
  logger.info('[CDC] Stopped');
}

/**
 * Xoá bộ nhớ debounce của LOW_STOCK.
 *
 * CHỈ dùng trong script kiểm chứng (`scripts/demo/demo-flow.js`) khi chạy luồng
 * demo nhiều lần liên tiếp trong cùng một tiến trình: mỗi lần chạy lại cách nhau
 * vài giây, còn `CDC_LOW_STOCK_DEBOUNCE_MS` mặc định 60 000 ms ⇒ lần thứ hai bị
 * gộp im lặng và **không** sinh đề xuất, dù dữ liệu đã về trạng thái ban đầu.
 *
 * Đây là khe hởng có chủ đích của bộ debounce chứ không phải lỗi: trong sản phẩm
 * thật thì gộp 60 giây là đúng (tránh spam đề xuất). Không có hàm này thì
 * `smoke:demo-flow` phải chờ 60 giây cho mỗi lần chạy — không chấp nhận được.
 * Không có đường nào trong mã sản phẩm gọi hàm này.
 */
const resetLowStockDebounce = () => lowStockTimers.clear();

module.exports = { startCDC, stopCDC, EVENT_HANDLERS, resetLowStockDebounce };
