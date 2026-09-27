/**
 * modules/delivery/delivery.service.js — Service quản lý Giao hàng
 *
 * Tổng quan:
 * - Cung cấp logic nghiệp vụ cho module giao hàng: tạo, cập nhật, theo dõi vận đơn
 * - Hỗ trợ webhook từ các đơn vị vận chuyển (GHTK, GHN, VNPOST...)
 * - Tích hợp auditService để ghi log thao tác
 * - Khi trạng thái DELIVERED, tự động cập nhật đơn hàng sang COMPLETED
 *
 * Hàm:
 * - createForOrder(orderId, data, userId): Tạo thông tin giao hàng cho đơn hàng, kiểm tra delivery chưa tồn tại, tạo kèm sự kiện PENDING
 * - updateDelivery(id, data, userId): Cập nhật thông tin giao hàng. Nếu chuyển DELIVERED → cập nhật order status
 * - addEvent(deliveryId, data, userId): Thêm sự kiện cho vận đơn, cập nhật trạng thái delivery. Nếu DELIVERED → cập nhật order
 * - getTrack(id): Lấy thông tin theo dõi vận đơn kèm danh sách sự kiện và thông tin đơn hàng
 * - verifyGhtkSignature(rawBody, signature): Xác thực chữ ký HMAC-SHA256 webhook từ GHTK
 * - handleWebhook(provider, payload, signature, rawBody): Xử lý webhook từ ĐVVC: verify chữ ký, map status, tránh duplicate event
 */
const crypto = require("crypto");
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const orderService = require("../orders/order.service");
const logger = require("../../utils/logger");

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

    if (data.status === "DELIVERED") {
      const order = await tx.order.findUnique({ where: { id: delivery.orderId }, select: { status: true } });
      if (order?.status === "SHIPPING") {
        await orderService.updateStatus(delivery.orderId, "COMPLETED", userId);
      }
    }

    return ev;
  });

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

const timingSafeEqualStr = (a, b) => {
  const x = Buffer.from(String(a || ""), "utf8");
  const y = Buffer.from(String(b || ""), "utf8");
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
};

const verifyProviderWebhook = (provider, headers = {}, rawBody, signature) => {
  const p = String(provider || "").toLowerCase();

  if (p === "ghtk") {
    return verifyGhtkSignature(rawBody, signature);
  }

  // GHN: token trong header "Token" (chuẩn GHN)
  if (p === "ghn") {
    const secret = process.env.GHN_WEBHOOK_SECRET || "";
    const token = headers["token"] || headers["x-token"];
    return Boolean(secret && timingSafeEqualStr(token, secret));
  }

  // VNPOST / ViettelPost / J&T / SELF / OTHER: dùng chung cơ chế bearer/token
  const secret = process.env.DELIVERY_WEBHOOK_SECRET || "";
  const auth = headers["authorization"] || "";
  const token =
    headers["x-webhook-token"] ||
    (auth.startsWith("Bearer ") ? auth.slice(7) : auth);
  return Boolean(secret && timingSafeEqualStr(token, secret));
};

const handleWebhook = async (provider, payload, signature, rawBody, headers = {}) => {
  const verified = verifyProviderWebhook(provider, headers, rawBody, signature);
  if (!verified) {
    if (process.env.NODE_ENV === "production") {
      throw { status: 401, message: "Chữ ký webhook không hợp lệ" };
    }
    logger.warn(
      `[delivery] webhook ${provider} thiếu secret — chấp nhận ở môi trường dev (chặn khi production)`,
    );
  }

  const trackingCode = payload.tracking_code || payload.trackingCode;
  if (!trackingCode) {
    throw { status: 400, message: "Thiếu tracking_code" };
  }
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

  const providerKey = (String(provider || "").toUpperCase() || "OTHER").replace(/-/g, "_");
  const delivery = await prisma.delivery.findFirst({
    where: {
      trackingCode,
      provider: providerKey,
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
