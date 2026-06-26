/**
 * modules/subscriptions/subscription.controller.js — Controller cho subscription
 * 
 * Tổng quan:
 - Nhận request từ routes, gọi service xử lý, trả response chuẩn
 * 
 * Hàm:
 * - listPlans(req, res, next): Danh sách gói active
 * - getPlan(req, res, next): Chi tiết gói theo id
 * - createPlan(req, res, next): Tạo gói mới (ADMIN)
 * - updatePlan(req, res, next): Cập nhật gói
 * - deletePlan(req, res, next): Xoá mềm gói
 * - mySubscription(req, res, next): Subscription của user hiện tại
 * - myPlanFeatures(req, res, next): Features của gói đang dùng
 * - myInvoices(req, res, next): Hoá đơn của user
 * - payInvoice(req, res, next): Thanh toán hoá đơn
 * - requestUpgrade(req, res, next): Yêu cầu nâng gói
 * - handleWebhook(req, res, next): Xử lý webhook PAYOS
 * - listAllTenantSubscriptions(req, res, next): Tất cả subscription (ADMIN)
 * - assignPlan(req, res, next): Gán gói cho tenant (ADMIN)
 * - listAllInvoices(req, res, next): Tất cả hoá đơn (ADMIN)
 * - createInvoice(req, res, next): Tạo hoá đơn (ADMIN)
 * - updateInvoice(req, res, next): Cập nhật hoá đơn (ADMIN)
 */
const service = require("./subscription.service");
const { success } = require("../../utils/response");

const listPlans = async (req, res, next) => {
  try {
    const plans = await service.getPlans(true);
    success(res, plans);
  } catch (err) { next(err); }
};

const getPlan = async (req, res, next) => {
  try {
    const plan = await service.getPlanById(req.params.id);
    if (!plan) return next({ status: 404, message: "Không tìm thấy gói" });
    success(res, plan);
  } catch (err) { next(err); }
};

const parseFeatures = (body) => {
  if (typeof body.features === "string") {
    try { body.features = JSON.parse(body.features); } catch { throw { status: 400, message: "Features không đúng định dạng JSON" }; }
  }
  return body;
};

const createPlan = async (req, res, next) => {
  try {
    const plan = await service.createPlan(parseFeatures(req.body), req.user.id);
    success(res, plan, "Tạo gói thành công", 201);
  } catch (err) { next(err); }
};

const updatePlan = async (req, res, next) => {
  try {
    const plan = await service.updatePlan(req.params.id, parseFeatures(req.body), req.user.id);
    success(res, plan, "Cập nhật gói thành công");
  } catch (err) { next(err); }
};

const deletePlan = async (req, res, next) => {
  try {
    await service.deletePlan(req.params.id, req.user.id);
    success(res, null, "Đã xóa gói");
  } catch (err) { next(err); }
};

const mySubscription = async (req, res, next) => {
  try {
    const sub = await service.getTenantSubscription(req.user.tenantId);
    success(res, sub || {});
  } catch (err) { next(err); }
};

const myPlanFeatures = async (req, res, next) => {
  try {
    const features = await service.getMyPlanFeatures(req.user.tenantId);
    success(res, features || {});
  } catch (err) { next(err); }
};

const myInvoices = async (req, res, next) => {
  try {
    const invoices = await service.getTenantInvoices(req.user.tenantId);
    success(res, invoices);
  } catch (err) { next(err); }
};

const payInvoice = async (req, res, next) => {
  try {
    const invoice = await service.updateInvoiceStatus(
      req.params.id, "PAID", req.user.id, req.body
    );
    success(res, invoice, "Thanh toán thành công");
  } catch (err) { next(err); }
};

const requestUpgrade = async (req, res, next) => {
  try {
    const result = await service.requestUpgrade(
      req.user.tenantId, req.body.planId, req.user.id
    );
    success(res, result, "Đã tạo link thanh toán");
  } catch (err) { next(err); }
};

const handleWebhook = async (req, res, next) => {
  try {
    const rawBody = req.body instanceof Buffer ? req.body.toString("utf8") : JSON.stringify(req.body);
    const payload = JSON.parse(rawBody);
    const result = await service.handlePaymentWebhook(payload);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      message: err.message || "Webhook error",
    });
  }
};

const listAllTenantSubscriptions = async (req, res, next) => {
  try {
    const subs = await service.getAllTenantSubscriptions();
    success(res, subs);
  } catch (err) { next(err); }
};

const assignPlan = async (req, res, next) => {
  try {
    const sub = await service.assignPlanToTenant(
      req.params.tenantId, req.body.planId, req.user.id, req.body
    );
    success(res, sub, "Gán gói thành công");
  } catch (err) { next(err); }
};

const listAllInvoices = async (req, res, next) => {
  try {
    const invoices = await service.getAllInvoices(req.query);
    success(res, invoices);
  } catch (err) { next(err); }
};

const createInvoice = async (req, res, next) => {
  try {
    const invoice = await service.generateInvoice(req.body.subscriptionId, req.user.id);
    success(res, invoice, "Tạo hóa đơn thành công", 201);
  } catch (err) { next(err); }
};

const updateInvoice = async (req, res, next) => {
  try {
    const invoice = await service.updateInvoiceStatus(
      req.params.id, req.body.status, req.user.id, req.body
    );
    success(res, invoice, "Cập nhật hóa đơn thành công");
  } catch (err) { next(err); }
};

module.exports = {
  listPlans, getPlan, createPlan, updatePlan, deletePlan,
  mySubscription, myPlanFeatures, myInvoices, payInvoice, requestUpgrade,
  listAllTenantSubscriptions, assignPlan,
  listAllInvoices, createInvoice, updateInvoice, handleWebhook,
};
