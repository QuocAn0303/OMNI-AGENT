# ERP System (Quản lý bán lẻ)

Tổng quan ngắn: Hệ thống ERP mẫu cho bán lẻ gồm backend (Node.js + Express + Prisma + PostgreSQL) và frontend (React + Vite + Ant Design). Mục tiêu: quản lý sản phẩm, tồn kho, khách hàng, đơn hàng, báo cáo và ghi nhận hoạt động (audit).

**Kiến trúc & Stack**

- Backend: Node.js, Express, Prisma (PostgreSQL), Zod, bcrypt, JWT
- Frontend: React, Vite, Ant Design, Zustand
- Storage: Cloudinary (ảnh sản phẩm)
- Docs: Swagger (mở tại `/api-docs`)
- Dev tooling: nodemon, prisma, vite

**Tính năng chính**

- Xác thực: JWT + refresh token, role-based (ADMIN, MANAGER, CASHIER, WAREHOUSE)
- Quản lý users (tài khoản, role, active)
- Quản lý sản phẩm & danh mục
- Quản lý tồn kho: inventory, giao dịch (import/export/adjustment/return)
- Quản lý khách hàng
- Quản lý đơn hàng + order items
- Báo cáo & Dashboard (API hỗ trợ xuất dữ liệu)
- Audit log: ghi lịch sử thay đổi
- Upload ảnh lên Cloudinary
- API docs (Swagger)

**Mô hình dữ liệu (tóm tắt)**

- User, Role enum
- Product, Category
- Inventory, InventoryTransaction, TransactionType enum
- Customer
- Order, OrderItem, OrderStatus enum, PaymentMethod, PaymentStatus
- RefreshToken
- AuditLog

**Các file/điểm quan trọng**

- Server entry: `src/app.js`
- Prisma schema: `prisma/schema.prisma`
- Seeder: `prisma/seed.js` (tạo user admin: `admin@erp.com` / `admin123`)
- API docs config: `src/config/swagger.js` (mở tại `/api-docs`)
- Cloudinary config: `src/config/cloudinary.config.js`
- Modules chính: `src/modules/` (auth, users, products, orders, inventory, customers, categories, reports, dashboard, audit)
- Frontend: `frontend/` (React + Vite)

**Biến môi trường (quan trọng)**
Tạo file `.env` ở root với tối thiểu các biến sau:

```
DATABASE_URL=postgresql://user:pass@host:5432/dbname
PORT=4000
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=7d
REFRESH_TOKEN_EXPIRES_DAYS=30
BCRYPT_ROUNDS=10
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
SWAGGER_SERVER_URL=http://localhost:4000
CLIENT_URL=http://localhost:5173
LOG_LEVEL=info
RATE_LIMIT_WINDOW_MINUTES=15
RATE_LIMIT_MAX=10
```

Ghi chú: code dùng `process.env` ở nhiều nơi; kiểm tra `src/config` và `src/modules` nếu cần thêm biến.

**Chạy nhanh (local)**

1. Cài đặt Docker (tuỳ chọn) và chạy PostgreSQL bằng `docker-compose`:

```bash
docker-compose up -d
```

2. Cài đặt deps (backend):

```bash
npm install
```

3. Migrate & seed (Prisma):

```bash
npm run db:migrate
npm run db:seed
# (mở Prisma Studio nếu cần)
npm run db:studio
```

4. Chạy backend (phát triển):

```bash
npm run dev
```

Server mặc định lắng nghe `PORT` (nếu không đặt sẽ dùng `4000`). Swagger UI: `http://localhost:4000/api-docs`

5. Chạy frontend (terminal khác):

```bash
cd frontend
npm install
npm run dev
```

Frontend mặc định: `http://localhost:5173` (vite).

**Docker / Database**

- `docker-compose.yml` cung cấp service `postgres` (image: `postgres:15`).
- Hoặc cấu hình PostgreSQL riêng và set `DATABASE_URL` tương ứng.

**Seeder & Test account**

- Seeder tạo admin: `admin@erp.com` / `admin123` (xem `prisma/seed.js`).

**API / Endpoints cơ bản**

- `/api/auth` — login, refresh, logout
- `/api/users` — user CRUD
- `/api/products` — danh sách, chi tiết, tạo, cập nhật
- `/api/orders` — tạo đơn, danh sách
- `/api/inventory` — import/export, transactions
- `/api/customers` — quản lý khách hàng
- `/api/reports` — xuất báo cáo
- `/api/dashboard` — thông tin tổng quan

**Cron & WebSocket (ưu tiên cao)**

- Cron (node-cron) khởi chạy cùng server trong `src/jobs/cron.js`: đơn PENDING > 24h (mỗi giờ), công nợ quá hạn 09:00, nhắc lương ngày 25 lúc 09:00, nhắc đóng kỳ ngày 28 lúc 09:00.
- Socket.IO: `src/realtime/socket.js` — client kết nối tới **origin** của API (bỏ hậu tố `/api`), xác thực qua `handshake.auth.token` (JWT giống header Bearer).
- Fallback: frontend gọi `GET /api/notifications/unread-count` mỗi 30 giây (xem TopBar).

**Testing**

- Chạy `npm test` (Jest). Ví dụ test đơn lẻ: `npx jest tests/debt.service.test.js`.

**Chú ý & Gợi ý**

- Kiểm tra và bảo mật `JWT_SECRET` và các khóa Cloudinary trước khi deploy.
- Cổng mặc định server trong code là `4000` (app.js) — tuỳ file `HOW_TO_TEST.md` có nhắc `3000` (cần đồng bộ nếu thay đổi).
- Nếu thay đổi schema Prisma, chạy `prisma migrate` và kiểm tra migrations trong `prisma/migrations`.

Nếu bạn muốn, tôi có thể:

- Thêm phần hướng dẫn triển khai (Heroku, DigitalOcean, Docker) vào README
- Tạo `.env.example` tóm tắt các biến môi trường
- Cấu hình test script và CI cơ bản

---

_Tài liệu được tự động tạo tóm tắt từ mã nguồn hiện có. Nếu bạn muốn nội dung chi tiết hơn (API reference từng endpoint, ví dụ request/response), cho tôi biết module nào cần mở rộng._
