ĐỌC HẾT CHO BỐ

# 📋 PHÂN CHIA CÔNG VIỆC — ERP BÁN LẺ

> **Sprint hiện tại:** Sprint 1 — Auth + Users  
> **Trạng thái:** Prisma schema + migrate ✅ xong  
> **Quy tắc:** Mỗi sáng gửi standup vào group theo template cuối file

---

## 👨‍💻 Dev A — Backend Lead

### 🔴 Làm ngay hôm nay

- [ ] `src/modules/auth/auth.service.js` → hàm `login()` — bcrypt.compare + jwt.sign
- [ ] `src/middleware/auth.middleware.js` → hàm `authenticate()` — verify JWT, attach `req.user`

### 🟡 Ngày mai

- [ ] `src/modules/auth/auth.service.js` → hàm `getProfile()`, `changePassword()`
- [ ] `src/modules/users/user.service.js` → hàm `getAll()` (paginate + search), `create()`

### 📅 Tuần 2

- [ ] `src/modules/users/user.service.js` → `update()`, `remove()` (soft delete `isActive=false`)
- [ ] `src/middleware/auth.middleware.js` → hàm `authorize(...roles)` — check `req.user.role`
- [ ] `src/modules/auth/auth.routes.js` → map routes: POST `/login`, GET `/me`, PUT `/change-password`
- [ ] `src/modules/users/user.routes.js` → map routes CRUD users

### 📅 Tuần 3

- [ ] `src/modules/customers/customer.service.js` → `getAll()`, `create()`, `update()`, `remove()`
- [ ] `src/modules/customers/customer.routes.js` → map routes CRUD customers
- [ ] `src/modules/orders/order.service.js` → `create()` dùng **Prisma `$transaction`** (quan trọng nhất)
- [ ] `src/modules/orders/order.service.js` → `getAll()` filter theo status/date, `getById()`, `updateStatus()`
- [ ] `src/modules/orders/order.routes.js` → map routes

### 📅 Tuần 4–5

- [ ] `src/modules/dashboard/dashboard.routes.js` → GET `/overview`, GET `/revenue` (7 ngày)
- [ ] Review + fix bugs khi Dev D bắt đầu kết nối FE
- [ ] Unit tests Auth + Orders (Jest + supertest) — coverage > 60%

### 📅 Tuần 9–11

- [ ] E2E integration tests (supertest end-to-end)
- [ ] Security review: kiểm tra toàn bộ input validation
- [ ] Tham gia UAT, fix bugs

---

## 🗃️ Dev B — Backend + Database

### 🔴 Làm ngay hôm nay

- [ ] `src/modules/categories/category.service.js` → `getAll()`, `create()`, `update()`, `remove()`
- [ ] `src/modules/categories/category.routes.js` → map routes CRUD
done
### 🟡 Ngày mai

- [ ] `src/modules/products/product.service.js` → `getAll()` với filter (search, categoryId) + paginate
- [ ] `src/modules/products/product.service.js` → `getById()` — include category + inventory
done
### 📅 Tuần 2

- [ ] `src/modules/products/product.service.js` → `create()` (tạo product + tự tạo Inventory record luôn)
- [ ] `src/modules/products/product.service.js` → `update()`, `remove()` (soft delete)
- [ ] `src/modules/products/product.routes.js` → map routes CRUD
done 
### 📅 Tuần 3

- [ ] Tích hợp **Multer + Cloudinary** upload ảnh sản phẩm
- [ ] `src/modules/products/product.routes.js` → thêm route `POST /products/:id/image`
- [ ] `src/modules/inventory/inventory.service.js` → `getByProduct()`, `importStock()` (tăng qty + ghi InventoryTransaction)
- [ ] `src/modules/inventory/inventory.service.js` → `adjustment()`, `getLowStock()`, `getTransactions()`
- [ ] `src/modules/inventory/inventory.routes.js` → map routes

### 📅 Tuần 4–5

- [ ] Viết Swagger JSDoc comments cho tất cả routes đã có
- [ ] Setup `swagger-jsdoc` + `swagger-ui-express` → UI tại `/api-docs`
- [ ] Unit tests cơ bản cho Products + Inventory
- [ ] Sync với Dev D — confirm format response để FE kết nối

### 📅 Tuần 10–12

- [ ] Hỗ trợ migrate DB lên production cùng DevOps
- [ ] Fix bugs từ UAT liên quan Products/Inventory

---

## 📊 Dev C — Backend + Reports

### 📅 Tuần 1–2 (học React — chưa có việc backend)

- [ ] Học React cơ bản: https://react.dev/learn — mỗi ngày 2 bài
- [ ] Mục tiêu cuối tuần 2: hiểu `useState`, `useEffect`, gọi API bằng `fetch`
- [ ] Hỗ trợ Dev A/B khi cần: test API bằng Postman, viết thêm seed data

### 📅 Tuần 4–5 (Reports API)

- [ ] `src/modules/reports/report.service.js` → `getRevenue(from, to)` — aggregate theo ngày
- [ ] `src/modules/reports/report.service.js` → `getRevenueMonthly()` — aggregate theo tháng
- [ ] `src/modules/reports/report.service.js` → `getTopProducts(limit)` — aggregate orderItems
- [ ] `src/modules/reports/report.service.js` → `getInventoryReport()` — tồn kho + giá trị
- [ ] `src/modules/reports/report.routes.js` → map routes

### 📅 Tuần 5–6 (Xuất file)

- [ ] `src/modules/reports/report.service.js` → `exportRevenueExcel()` dùng **ExcelJS**
- [ ] `src/modules/reports/report.service.js` → `exportInventoryExcel()`
- [ ] Test download file `.xlsx` từ Postman

### 📅 Tuần 6–9 (Hỗ trợ Frontend)

- [ ] Cùng Dev D làm `src/pages/Inventory.jsx` — list giao dịch, form nhập hàng
- [ ] Cùng Dev D làm `src/pages/Customers.jsx` — list + profile
- [ ] Cùng Dev D làm `src/pages/Reports.jsx` — date picker + table + nút xuất Excel

### 📅 Tuần 10–11

- [ ] Viết User Manual (Google Docs hoặc Notion) — hướng dẫn cho từng role
- [ ] Bổ sung FAQ sau khi UAT

---

## 🎨 Dev D — Frontend Lead

### 📅 Tuần 1–2 (setup — chưa code trang)

- [ ] Cài dependencies frontend:
  ```bash
  npm create vite@latest frontend -- --template react
  cd frontend
  npm install antd @ant-design/icons axios @tanstack/react-query zustand react-router-dom recharts react-hook-form
  ```
- [ ] Tạo cấu trúc thư mục: `src/pages/`, `src/api/`, `src/stores/`, `src/components/`
- [ ] `src/api/axios.js` — config `baseURL` + request interceptor thêm Bearer token
- [ ] `src/api/axios.js` — response interceptor: nếu 401 → redirect về `/login`
- [ ] Đọc Swagger docs (khi Dev B setup xong) để biết format API

### 📅 Tuần 4 (khi Dev A xong Auth API)

- [ ] `src/stores/authStore.js` — Zustand: lưu `token`, `user`, `isAuthenticated`
- [ ] `src/pages/Login.jsx` — Ant Design Form, gọi `POST /api/auth/login`, lưu token
- [ ] `src/components/ProtectedRoute.jsx` — check token, redirect nếu chưa đăng nhập
- [ ] `src/components/Layout.jsx` — Sidebar + Header, menu items theo role

### 📅 Tuần 5

- [ ] `src/pages/Dashboard.jsx` — 4 stat cards (doanh thu, đơn hàng, sản phẩm, khách hàng)
- [ ] `src/pages/Dashboard.jsx` — Recharts LineChart doanh thu 7 ngày

### 📅 Tuần 6

- [ ] `src/pages/Products.jsx` — Ant Table: list, search, filter category, paginate
- [ ] `src/pages/Products.jsx` — Modal thêm/sửa sản phẩm (Ant Form + Upload ảnh)
- [ ] `src/pages/Products.jsx` — confirm xóa sản phẩm

### 📅 Tuần 7

- [ ] `src/pages/Inventory.jsx` — cùng Dev C: list giao dịch, form nhập hàng, badge tồn kho thấp

### 📅 Tuần 8

- [ ] `src/pages/POS.jsx` — layout 2 cột: danh sách SP (search) + giỏ hàng
- [ ] `src/pages/POS.jsx` — click SP → thêm giỏ, chỉnh số lượng, xóa
- [ ] `src/pages/POS.jsx` — tính tổng, chọn phương thức thanh toán, gọi `POST /api/orders`
- [ ] `src/pages/POS.jsx` — in hoá đơn (`window.print()`)

### 📅 Tuần 9

- [ ] `src/pages/Orders.jsx` — list đơn hàng, filter status + date range, tag màu theo status
- [ ] `src/pages/Customers.jsx` — cùng Dev C: list + profile + lịch sử mua
- [ ] `src/pages/Reports.jsx` — cùng Dev C: date picker + table + nút Download Excel

### 📅 Tuần 10–11

- [ ] E2E tests Cypress — happy paths: login, tạo đơn hàng
- [ ] Fix bugs từ UAT
- [ ] Kiểm tra responsive mobile cơ bản (Chrome DevTools)

---

## ⚙️ DevOps / PM

### 🔴 Làm ngay hôm nay

- [ ] Fix lỗi Prisma cho cả team (đang làm)
- [ ] Tạo **Notion board** — 5 cột: `Backlog / Todo / In Progress / Review / Done`
- [ ] Tạo ticket trên Notion cho từng task ở file này, assign đúng người

### 📅 Tuần 1

- [ ] `docker-compose.yml` — thêm volume để data không mất khi restart:
  ```yaml
  volumes:
    - postgres_data:/var/lib/postgresql/data
  volumes:
    postgres_data:
  ```
- [ ] Tạo nhánh `develop` trên GitHub
- [ ] Bật branch protection cho `main`: require PR + 1 approval trước khi merge
- [ ] `.github/workflows/ci.yml` — GitHub Actions: chạy `npm test` trên mọi PR

### 📅 Tuần 2

- [ ] Setup VPS staging (DigitalOcean $6/tháng hoặc AWS Free Tier)
- [ ] Deploy backend lên staging lần đầu (Docker + Nginx)
- [ ] `.github/workflows/cd.yml` — auto deploy khi merge vào `develop`

### 📅 Hàng ngày (cả dự án)

- [ ] Điều phối **daily standup 9:00 AM** — tối đa 15 phút
- [ ] Cập nhật Notion board sau standup
- [ ] Phát hiện blockers, assign người giải quyết trong ngày

### 📅 Tuần 10–11

- [ ] Tổ chức UAT với end-user (2–3 người)
- [ ] Tổng hợp bug list, assign cho Dev A + Dev D

### 📅 Tuần 12

- [ ] Setup production server: Nginx + SSL Let's Encrypt
- [ ] `docker-compose.prod.yml` — config production
- [ ] Migrate DB production + seed data thực tế
- [ ] Setup monitoring: UptimeRobot (free) + Grafana
- [ ] Setup backup: `pg_dump` cron job hàng ngày → S3
- [ ] Training người dùng cuối + Go-live 🚀

---

## 📐 Quy tắc chung

### Git workflow

```
main        ← production only, chỉ merge khi deploy
develop     ← staging, merge sau khi review xong
feat/xxx    ← feature branch, tạo từ develop
fix/xxx     ← hotfix branch
```

### Commit message

```
feat: thêm login API
fix: sửa lỗi trừ kho sai số lượng
chore: cài thêm package multer
```

### Pull Request

- Mỗi feature phải có PR vào `develop`
- Ít nhất **1 người review** trước khi merge
- PR không được để quá **24 giờ** không có ai review

---

## 📢 Template standup hàng ngày

Gửi vào group chat mỗi sáng trước 9:15 AM:

```
[Tên] - [Ngày]
✅ Hôm qua: viết xong hàm login() trong auth.service.js
🔨 Hôm nay: viết hàm authenticate() middleware
🚧 Blocked: chưa có gì / bị kẹt ở [vấn đề gì]
```

> ⚠️ Ai không gửi standup trước 11:30 AM → PM nhắn hỏi trực tiếp.

---

_Cập nhật lần cuối: Sprint 1 — Tuần 2_
