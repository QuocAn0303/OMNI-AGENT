/**
 * config/cloudinary.config.js — Upload ảnh lên Cloudinary qua Multer
 * 
 * Tổng quan:
 * - Lazy-init: đọc cấu hình Cloudinary từ IntegrationConfig (DB) → fallback .env
 * - Nếu chưa cấu hình → dùng memory storage tạm (upload vào RAM, không lưu vĩnh viễn)
 * - Nếu đã cấu hình → dùng CloudinaryStorage (folder "IS207_Products")
 * - Cache middleware: chỉ tạo lại khi config thay đổi
 * 
 * Hàm:
 * - uploadCloud.single(field): Middleware upload 1 file
 * - uploadCloud.array(field, max): Middleware upload nhiều file
 * - testConnection(): Ping Cloudinary API để kiểm tra kết nối
 */

const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const config = require("../modules/integrations/integration-config.service");

let _configured = null; // { cloudName, apiKey, apiSecret } đã apply
let _middleware = null;

const _apply = async () => {
  const cfg = await config.getMany(["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]);
  const sig = JSON.stringify(cfg);
  if (_middleware && _configured === sig) return _middleware;

  if (!cfg.CLOUDINARY_CLOUD_NAME || !cfg.CLOUDINARY_API_KEY || !cfg.CLOUDINARY_API_SECRET) {
    // Chưa cấu hình → memory storage (upload vào RAM, không lưu được vĩnh viễn).
    _middleware = multer({ storage: multer.memoryStorage() });
    _configured = sig;
    return _middleware;
  }

  cloudinary.config({
    cloud_name: cfg.CLOUDINARY_CLOUD_NAME,
    api_key: cfg.CLOUDINARY_API_KEY,
    api_secret: cfg.CLOUDINARY_API_SECRET,
  });
  const storage = new CloudinaryStorage({
    cloudinary,
    params: { folder: "IS207_Products", allowed_formats: ["jpg", "jpeg", "png", "webp"] },
  });
  _middleware = multer({ storage });
  _configured = sig;
  return _middleware;
};

// Proxy middleware — gọi single(field) trên nó sẽ trả về handler resolve lazy.
const uploadCloud = {
  single(field) {
    return async (req, res, next) => {
      try {
        const mw = await _apply();
        return mw.single(field)(req, res, next);
      } catch (e) { next(e); }
    };
  },
  array(field, max) {
    return async (req, res, next) => {
      try {
        const mw = await _apply();
        return mw.array(field, max)(req, res, next);
      } catch (e) { next(e); }
    };
  },
};

const testConnection = async () => {
  const cfg = await config.getMany(["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]);
  if (!cfg.CLOUDINARY_CLOUD_NAME) throw { status: 400, message: "Chưa cấu hình Cloudinary" };
  cloudinary.config({
    cloud_name: cfg.CLOUDINARY_CLOUD_NAME,
    api_key: cfg.CLOUDINARY_API_KEY,
    api_secret: cfg.CLOUDINARY_API_SECRET,
  });
  const res = await cloudinary.api.ping();
  return { success: true, status: res.status };
};

module.exports = uploadCloud;
module.exports.testConnection = testConnection;
