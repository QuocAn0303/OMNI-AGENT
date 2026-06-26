/**
 * modules/admin/admin-campaign.controller.js — Controller cho chiến dịch admin
 * 
 * Tổng quan:
 * - Nhận request từ routes, gọi service xử lý, trả response
 * 
 * Hàm:
 * - list(req, res, next): Danh sách chiến dịch
 * - getById(req, res, next): Chi tiết chiến dịch
 * - listRecipients(req, res, next): Danh sách người nhận, phân trang
 * - create(req, res, next): Tạo chiến dịch mới
 * - update(req, res, next): Cập nhật chiến dịch
 * - remove(req, res, next): Xoá chiến dịch
 * - send(req, res, next): Gửi chiến dịch
 */
const service = require("./admin-campaign.service");
const { success, paginated } = require("../../utils/response");

const list = async (req, res, next) => {
  try {
    const campaigns = await service.listCampaigns(req.query);
    success(res, campaigns);
  } catch (err) { next(err); }
};

const getById = async (req, res, next) => {
  try {
    const campaign = await service.getCampaignById(req.params.id);
    success(res, campaign);
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const campaign = await service.createCampaign(req.body, req.user.id);
    success(res, campaign, "Tạo chiến dịch thành công", 201);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const campaign = await service.updateCampaign(req.params.id, req.body, req.user.id);
    success(res, campaign, "Cập nhật chiến dịch thành công");
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    await service.deleteCampaign(req.params.id, req.user.id);
    success(res, null, "Đã xóa chiến dịch");
  } catch (err) { next(err); }
};

const listRecipients = async (req, res, next) => {
  try {
    const { recipients, pagination } = await service.listRecipients(req.params.id, req.query);
    paginated(res, recipients, pagination);
  } catch (err) { next(err); }
};

const send = async (req, res, next) => {
  try {
    const campaign = await service.sendCampaign(req.params.id, req.user.id);
    success(res, campaign, "Chiến dịch đang được gửi");
  } catch (err) { next(err); }
};

module.exports = { list, getById, listRecipients, create, update, remove, send };