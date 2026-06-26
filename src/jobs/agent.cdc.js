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
const { getIo } = require('../realtime/socket');

let pool = null;
let listening = false;

const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 5000,
};

const EVENT_HANDLERS = {
  LOW_STOCK: async (data) => {
    try {
      const inventoryService = require('../modules/inventory/inventory.service');
      const purchaseService = require('../modules/accounting/purchase.service');
      const prisma = require('../config/prisma');

      const alerts = await inventoryService.checkAlerts();
      if (!alerts?.critical?.length) return;

      for (const item of alerts.critical) {
        const product = await prisma.product.findUnique({ where: { id: item.productId } });
        if (!product) continue;

        // Auto-create draft PO
        const po = await purchaseService.create({
          vendorId: null,
          items: [{ productId: item.productId, quantity: Math.max(item.minStock * 2, 10), unitCost: 0 }],
          note: `AI auto-generated: ${item.name} out of stock`,
          createdById: 'system',
        }).catch(e => {
          console.error(`[CDC] PO creation error for ${item.name}:`, e.message);
          return null;
        });

        if (po) {
          const io = getIo();
          if (io) {
            io.to(`role:MANAGER`).emit('AI_ACTION', {
              type: 'AUTO_PO',
              message: `🤖 AI tự động tạo đơn nhập hàng cho "${item.name}" (hết tồn kho)`,
              data: po,
            });
          }
        }
      }
    } catch (e) {
      console.error('[CDC] LOW_STOCK handler error:', e.message);
    }
  },

  ORDER_COMPLETED: async (data) => {
    try {
      const tasksService = require('../modules/crm/tasks.service');
      const prisma = require('../config/prisma');

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
        if (io) {
          io.to(`role:SALE`).emit('AI_ACTION', {
            type: 'FOLLOW_UP_TASK',
            message: `🤖 Đã tạo task chăm sóc sau đơn hàng ${order.orderCode || ''}`,
            data: task,
          });
        }
      }
    } catch (e) {
      console.error('[CDC] ORDER_COMPLETED handler error:', e.message);
    }
  },

  PAYMENT_RECEIVED: async (data) => {
    try {
      const io = getIo();
      if (io) {
        io.to(`role:MANAGER`).emit('AI_ACTION', {
          type: 'PAYMENT_NOTIFY',
          message: `💳 Thanh toán ${data.amount ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(data.amount) : 'mới'} đã được ghi nhận.`,
          data,
        });
      }
    } catch (e) {
      console.error('[CDC] PAYMENT_RECEIVED handler error:', e.message);
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

    console.log('[CDC] Database triggers ensured');
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
      try {
        const event = JSON.parse(msg.payload);
        const handler = EVENT_HANDLERS[event.type];
        if (handler) {
          handler(event.data || event).catch((e) =>
            console.error(`[CDC] Handler error for ${event.type}:`, e.message)
          );
        }
      } catch (e) {
        console.error('[CDC] Parse error:', e.message);
      }
    });

    client.on('error', (e) => {
      console.error('[CDC] Connection error:', e.message);
      listening = false;
      setTimeout(startCDC, 5000);
    });

    console.log('[CDC] Listening for agent events...');
  } catch (e) {
    console.error('[CDC] Failed to start:', e.message);
    listening = false;
  }
}

function stopCDC() {
  if (pool) {
    pool.end().catch(() => {});
    pool = null;
  }
  listening = false;
  console.log('[CDC] Stopped');
}

module.exports = { startCDC, stopCDC, EVENT_HANDLERS };
