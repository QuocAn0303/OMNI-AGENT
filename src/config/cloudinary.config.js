const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Cấu hình thông tin kết nối với Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Cấu hình kho lưu trữ (Storage)
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'IS207_Products', // Tên thư mục trên Cloudinary (bạn có thể đổi tên khác)
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'], // Chỉ cho phép up ảnh
  }
});

// Khởi tạo Multer với cấu hình storage ở trên
const uploadCloud = multer({ storage });

module.exports = uploadCloud;