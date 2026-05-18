const crypto = require("crypto");
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const orderService = require("../orders/order.service");

const createForOrder = async (orderId, data, userId) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { customer: true, delivery: true },
  });
  if (!order) throw { status: 404, message: "Không tìm thấy đơn hàng" };
  if (order.delivery) throw { status: 400, message: "Đơn đã có thông tin giao hàng" };

  const delivery = await prisma.delivery.create({
    data: {
      orderId,
      provider: data.provider,
      trackingCode: data.trackingCode,
      shippingFee: data.shippingFee ?? 0,
      recipientName: data.recipientName || order.customer?.name || "Khách lẻ",
      recipientPhone: data.recipientPhone || order.customer?.phone || "-",
      recipientAddress: data.recipientAddress || order.customer?.address || "-",
      note: data.note,
      events: {
        create: {
          status: "PENDING",
          note: "Tạo đơn giao hàng",
          occurredAt: new Date(),
        },
      },
    },
    include: { events: true },
  });

  await auditService.log({
    userId,
    action: "CREATE_DELIVERY",
    entity: "Delivery",
    entityId: delivery.id,
    after: { orderId, provider: delivery.provider },
  });

  return delivery;
};

const updateDelivery = async (id, data, userId) => {
  const before = await prisma.delivery.findUnique({ where: { id } });
  if (!before) throw { status: 404, message: "Không tìm thấy giao hàng" };

  const delivery = await prisma.delivery.update({
    where: { id },
    data: {
      trackingCode: data.trackingCode,
      status: data.status,
      shippingFee: data.shippingFee,
      failedReason: data.failedReason,
      note: data.note,
      pickedUpAt: data.pickedUpAt,
      deliveredAt: data.deliveredAt,
    },
  });

  if (data.status === "DELIVERED" && before.status !== "DELIVERED") {
    const order = await prisma.order.findUnique({ where: { id: delivery.orderId } });
    if (order?.status === "SHIPPING") {
      await orderService.updateStatus(delivery.orderId, "COMPLETED", userId);
    }
  }

  await auditService.log({
    userId,
    action: "UPDATE_DELIVERY",
    entity: "Delivery",
    entityId: id,
    before: { status: before.status },
    after: { status: delivery.status },
  });

  return delivery;
};

const addEvent = async (deliveryId, data, userId) => {
  const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } });
  if (!delivery) throw { status: 404, message: "Không tìm thấy giao hàng" };

  const event = await prisma.$transaction(async (tx) => {
    const ev = await tx.deliveryEvent.create({
      data: {
        deliveryId,
        status: data.status,
        location: data.location,
        note: data.note,
        occurredAt: data.occurredAt ? new Date(data.occurredAt) : new Date(),
      },
    });
    await tx.delivery.update({
      where: { id: deliveryId },
      data: {
        status: data.status,
        ...(data.status === "DELIVERED" ? { deliveredAt: ev.occurredAt } : {}),
        ...(data.status === "PICKED_UP" ? { pickedUpAt: ev.occurredAt } : {}),
      },
    });
    return ev;
  });

  if (data.status === "DELIVERED") {
    const order = await prisma.order.findUnique({ where: { id: delivery.orderId } });
    if (order?.status === "SHIPPING") {
      await orderService.updateStatus(delivery.orderId, "COMPLETED", userId);
    }
  }

  return prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: { events: { orderBy: { occurredAt: "asc" } }, order: { select: { orderCode: true, status: true } } },
  });
};

const getTrack = async (id) => {
  const delivery = await prisma.delivery.findUnique({
    where: { id },
    include: {
      events: { orderBy: { occurredAt: "asc" } },
      order: { select: { orderCode: true, status: true, total: true } },
    },
  });
  if (!delivery) throw { status: 404, message: "Không tìm thấy mã vận đơn" };
  return delivery;
};

const verifyGhtkSignature = (rawBody, signature) => {
  const secret = process.env.GHTK_WEBHOOK_SECRET || "";
  if (!secret || !signature) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const handleWebhook = async (provider, payload, signature, rawBody) => {
  if (provider === "ghtk" && !verifyGhtkSignature(rawBody, signature)) {
    throw { status: 401, message: "Chữ ký webhook không hợp lệ" };
  }

  const trackingCode = payload.tracking_code || payload.trackingCode;
  const statusMap = {
    delivered: "DELIVERED",
    delivering: "IN_TRANSIT",
    picked: "PICKED_UP",
    cancel: "FAILED",
  };
  const mapped = statusMap[payload.status] || "IN_TRANSIT";
  const occurredAt = payload.action_time
    ? new Date(payload.action_time * 1000)
    : new Date();

  const providerKey = String(provider || "").toUpperCase();
  const delivery = await prisma.delivery.findFirst({
    where: {
      trackingCode,
      ...(providerKey === "GHTK" ? { provider: "GHTK" } : {}),
    },
  });
  if (!delivery) return { ok: true, skipped: true };

  const dup = await prisma.deliveryEvent.findFirst({
    where: {
      deliveryId: delivery.id,
      status: mapped,
      occurredAt,
    },
  });
  if (dup) return { ok: true, duplicate: true };

  await addEvent(
    delivery.id,
    {
      status: mapped,
      note: payload.reason || payload.message,
      location: payload.address,
      occurredAt,
    },
    null,
  );

  return { ok: true };
};

module.exports = {
  createForOrder,
  updateDelivery,
  addEvent,
  getTrack,
  handleWebhook,
};
