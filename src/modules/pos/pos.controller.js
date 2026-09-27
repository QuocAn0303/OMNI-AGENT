const service = require("./pos.service");
const orderService = require("../orders/order.service");
const { success, created, error } = require("../../utils/response");

const listProducts = async (req, res, next) => {
  try {
    const products = await service.listProducts(req.query.warehouseId);
    success(res, products);
  } catch (err) { next(err); }
};

const findBySku = async (req, res, next) => {
  try {
    const product = await service.findBySku(req.params.sku);
    if (!product) return error(res, "Không tìm thấy sản phẩm", 404);
    success(res, product);
  } catch (err) { next(err); }
};

const listCategories = async (req, res, next) => {
  try {
    success(res, await service.listCategories());
  } catch (err) { next(err); }
};

const createOrder = async (req, res, next) => {
  try {
    const order = await orderService.create(req.body, req.user.id);
    created(res, order, "Tạo đơn hàng thành công");
  } catch (err) { next(err); }
};

module.exports = { listProducts, findBySku, listCategories, createOrder };
