# Aduu ERP

> Hệ thống hoạch định nguồn lực (ERP) **SaaS multi-tenant** cho doanh nghiệp bán lẻ + F&B + dịch vụ + sản xuất nhỏ và vừa, tối ưu cho thị trường Việt Nam.
> Giúp chủ shop mới mở quản lý sản phẩm, kho, đơn hàng, khách hàng, kế toán, nhân sự — **không cần biết kế toán**.

**Stack chính**: Node.js 20 + Express 4 · Prisma 7 + PostgreSQL · Redis · Socket.IO · React 19 + Vite + Ant Design 6 · Docker · Jest

---

## Stack & kiến trúc

| Thành phần | Công nghệ |
| --- | --- |
| **Backend** | Node.js 20, Express 4 (CommonJS), Zod validation, Helmet/HPP/rate-limit |
| **Database** | PostgreSQL 15/16, Prisma 7 (multi-tenant auto-scoping qua `$extends` + AsyncLocalStorage), 18 migrations |
| **Real-time** | Socket.IO 4 + Redis adapter (fallback in-memory), Web Push (PWA) |
| **Frontend** | React 19 + Vite 8, Ant Design 6, Zustand, React Router 7, Recharts, i18next (vi/en), PWA (Workbox) |
| **AI** | OpenAI SDK / Ollama (LLM local), AI agent 20+ tool, RAG, dự báo bán hàng |
| **CI/CD** | `.gitlab-ci.yml` (test → build → deploy), Docker (`Dockerfile`, `docker-compose.prod.yml`), PM2 (`ecosystem.config.js`), Railway (`railway.json`) |
| **Tài liệu API** | Swagger UI tại `/api-docs` (chỉ môi trường dev) |
| **Test** | Jest (`jest.config.js`), chạy `npm test` (`--runInBand`) |

---

## Tính năng chính

- **Bán hàng & POS**: POS đa chế độ (tại bàn / mang đi / giao hàng), quét barcode, in bill nhiệt Bluetooth (ESC/POS), bán ngoại tuyến (hàng chờ IndexedDB tự đồng bộ khi online), tách hóa đơn 3 chế độ (chia đều / theo món / tùy chỉnh), trả hàng & hoàn tiền, khuyến mãi (giảm % / giảm tiền / mua X tặng Y / giảm theo danh mục / theo sản phẩm / happy-hour), combo & modifier.
- **F&B**: sơ đồ bàn kéo-thả (Floor canvas, zoom/fit), KDS (station + ticket bump/recall/void), QR self-ordering cho khách không cần đăng nhập, menu modifier/variant/combo, công thức món (Recipe/COGS tự trừ kho), thẻ tích điểm (stamp card), tích hợp GrabFood / ShopeeFood / BeFood.
- **Kho & sản xuất**: đa kho, nhập–xuất–điều chỉnh, kiểm kê theo kho, chuyển kho, serial/lot/hạn dùng, BOM đa cấp (resolver chống vòng lặp), lệnh sản xuất, Work Center, Routing, Quality Check.
- **CRM & marketing**: khách hàng 360°, hạng tier, tích điểm loyalty, store credit, phân khúc, chiến dịch Email + Zalo OA, webhook bắt lead, dự báo churn / CLV / RFM.
- **Kế toán kép (double-entry)**: Chart of Accounts, autopost tự động cho 12 sự kiện nghiệp vụ, sổ nhật ký / sổ cái / bảng CĐSPS, báo cáo B01–B03, báo cáo thuế HTKK (01/GTGT, 05/TNCN, D02), hóa đơn điện tử VNPT, khấu hao TSCĐ, đối soát ngân hàng (import sao kê VCB/TCB + auto-match), kết chuyển cuối kỳ, đa tiền tệ, quỹ tiền mặt nhỏ (HKD).
- **Nhân sự**: nhân viên, chấm công 3 ca, tính lương (PIT/BHXH), nghỉ phép, làm thêm giờ, vi phạm nội bộ.
- **Thanh toán**: CASH / BANK_TRANSFER / CARD + **MoMo, VNPay, ZaloPay, PayOS, VietQR** (verify HMAC trên raw body webhook), đối soát ngân hàng tự động.
- **AI**: chatbot trợ lý, AI agent 20+ công cụ (tạo đơn/PO/nhắc nợ) kèm **human-gate** duyệt theo ngưỡng chi tiêu, morning briefing + anomaly detection, dự báo nhu cầu (AI Forecast), Smart Guide (giá bán / nhập hàng / sức khỏe doanh nghiệp), DB Agent truy vấn dữ liệu bằng ngôn ngữ tự nhiên.
- **Nền tảng**: multi-tenant isolation, 7 vai trò, kế hoạch dịch vụ (subscription + plan enforcement), quy trình duyệt (workflow), audit log, mask PII, sao lưu dữ liệu mã hóa, PWA offline + push notification, i18n tiếng Việt/Anh.

---

## Số liệu hiện tại

> Đếm trực tiếp từ source ngày **2026-09-27**.

| Hạng mục | Số lượng | Nguồn |
| --- | --- | --- |
| Model Prisma / Enum | **145 / 65** | `prisma/schema.prisma` |
| Migration | **18** | `prisma/migrations/` |
| Module backend | **58** | `src/modules/` |
| Prefix API `/api/*` | **70** | `src/app.js` |
| File test Jest | **42** (39 trong `tests/`, 3 trong `src/`) | `tests/`, `src/**/*.test.js` |
| Trang frontend | **108** | `frontend/src/pages/` |
| Route React (lazy) | ~101 route / 96 trang lazy | `frontend/src/App.jsx` |
| Cron jobs | **29** | `src/jobs/cron.js` |
| Model tự scoping theo tenant | **132** | `TENANT_SCOPED_MODELS` trong `src/config/prisma.js` |
| Ngôn ngữ i18n | 2 (vi, en) | `frontend/src/locales/` |

**Cổng mặc định**: backend `4000` (tự tăng khi bị chiếm, tối đa 10 lần) · frontend `5173` · PostgreSQL `5432` · Redis `6379` · Prisma Studio `5555` · Swagger `/api-docs`.

---

## Cấu trúc dự án

```
erp-system/
├── src/                          # Backend Express
│   ├── app.js                    # Entry point — 70 prefix /api, rate-limit, Swagger, Socket.IO, cron, CDC
│   ├── config/                   # prisma (auto-scope tenant), tenantContext, swagger, cloudinary, payos, redis, business-templates
│   ├── middleware/               # auth (authenticate/authorize/requireSuperOmega), error, plan, tenant, sanitize, permission
│   ├── modules/                  # 58 module (xem danh sách bên dưới)
│   ├── jobs/
│   │   ├── cron.js               # 29 cron jobs: hủy đơn, nhắc nợ, payroll, backup 02:00, kết chuyển...
│   │   └── agent.cdc.js          # CDC PostgreSQL LISTEN/NOTIFY → cảnh báo tồn kho / đơn COMPLETED / thanh toán
│   ├── realtime/socket.js        # Socket.IO + Redis adapter, room theo tenant/role
│   └── utils/                    # response, logger (Winston), apiError, email, sms, zalo, piiMask, vietqr,
│                                 # warehouse.helper, thermalPrinter, offlineQueue, vietnameseMoneyWords, exporter
├── prisma/
│   ├── schema.prisma             # 145 models, 65 enums — single source of truth
│   ├── migrations/               # 18 migrations (deployable từ DB sạch lẫn drifted)
│   ├── startup.js                # start production: migrate deploy + seed (nếu SEED_ON_START=1) + chạy app
│   ├── seed.js                   # 11 tài khoản mẫu (mật khẩu 123456) + SP/KH/đơn hàng demo
│   ├── seed_accounting.js        # Chart of Accounts ~40 TK + thuế VAT + danh mục chi phí
│   ├── seed_accounting_demo.js   # Dữ liệu kế toán demo (12 kỳ, NCC, PO, bút toán lương...)
│   ├── seed_permissions.js       # RBAC Permission/RolePermission
│   └── sql/fulltext_search.sql   # GIN/pg_trgm index cho Customer/Product/Vendor
├── tests/                        # 39 file test + setup.js (mock warehouse.helper, env test)
├── frontend/
│   └── src/
│       ├── App.jsx               # ~101 route, lazy load 96 trang, ProtectedRoute + RequireRole + HkdGate
│       ├── api/                  # 21 file API (axios instance + interceptor refresh token)
│       ├── stores/authStore.js   # Zustand: user/token/theme/beginnerMode/businessTemplate/support-mode
│       ├── components/           # layout (AppShell/Sidebar/TopBar), shared, pos, agent-ui, camera scanner
│       ├── pages/                # 108 trang — admin/, fnb/, hr/, production/, projects/, onboarding/
│       ├── locales/              # vi.json, en.json
│       ├── sw.js                 # Service Worker (PWA injectManifest) + utils/offlineQueue.js
│       └── styles/               # variable.css (design tokens), global.css (dark mode)
├── docs/, plans/                 # tài liệu nội bộ (được gitignore, không push)
├── Dockerfile                    # backend image (node:20-alpine, migrate deploy + start)
├── docker-compose.yml            # PostgreSQL 15 cho dev
├── docker-compose.prod.yml       # db + redis + ollama + app + frontend (nginx 80/443)
├── .gitlab-ci.yml                # CI: test → build → deploy (manual)
├── ecosystem.config.js           # PM2 cluster (4 instances)
└── railway.json                  # Railway start command
```

**58 module backend** (`src/modules/`):

```
accounting, admin, ai, ai-forecast, analytics, audit, auth, automation, bank-reco,
bulk, categories, crm, currency, customers, dashboard, debt, delivery, documents,
einvoice, fixed-assets, food-delivery, hr, import, integrations, inventory, kds,
loyalty, marketplace, menu, notifications, orders, payment-gateway, payments,
petty-cash, portal, pos, printers, production, products, projects, promotions,
push, qr-ordering, recipe, report-builder, reports, returns, search, settings,
smart-guide, stamp-card, subscriptions, tables, tax-report, users, vietqr,
warehouses, workflow
```

---

## 🚀 HƯỚNG DẪN CHẠY DỰ ÁN (Tutorial chi tiết)

> Phần này hướng dẫn từ A → Z cách chạy dự án trên máy local. Làm đúng theo thứ tự là chạy được.

### Bước 0 — Yêu cầu cài đặt sẵn

| Phần mềm           | Phiên bản tối thiểu | Ghi chú                                                                          |
| ------------------ | ------------------- | -------------------------------------------------------------------------------- |
| **Node.js**        | 20 LTS hoặc 22 LTS  | Project hiện chưa khoá engine, nhưng nên tránh Node 25 (Prisma Studio cảnh báo). |
| **npm**            | 10+                 | Đi kèm Node.js.                                                                  |
| **Docker Desktop** | mới nhất            | Dùng cho PostgreSQL + Redis (khuyến nghị).                                       |
| **Git**            | bất kỳ              | Để clone repo.                                                                   |

Kiểm tra nhanh:

```bash
node -v
npm -v
docker -v
```

---

### Bước 1 — Clone & cài dependencies

```bash
git clone <repo-url> erp-system
cd erp-system

# Cài deps cho backend (chạy ở root)
npm install

# Cài deps cho frontend
cd frontend
npm install
cd ..
```

---

### Bước 2 — Tạo file `.env` (ở root)

Copy từ mẫu rồi điền giá trị:

```bash
# Windows PowerShell
Copy-Item .env.example .env

# Linux / macOS
cp .env.example .env
```

Mở `.env` và **điền tối thiểu các biến sau** (những biến còn lại có thể để trống nếu chưa dùng):

```env
# --- Bắt buộc ---
PORT=4000
NODE_ENV=development
DATABASE_URL="postgresql://postgres:uit@localhost:5432/erp_db?schema=public"
# Production: thêm ?sslmode=require vào DATABASE_URL để mã hóa kết nối DB
JWT_SECRET=hay_doi_thanh_chuoi_ngau_nhien_dai_32_ky_tu_tro_len
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_DAYS=7
BCRYPT_ROUNDS=10

# --- CORS / Frontend ---
CORS_ORIGIN=http://localhost:5173
CLIENT_URL=http://localhost:5173

# --- Redis (cho Socket.IO real-time) ---
# Nếu không có Redis, code sẽ fallback sang in-memory nhưng log sẽ spam ECONNREFUSED.
REDIS_URL=redis://127.0.0.1:6379

# --- Encryption key cho Integration Center (≥ 32 ký tự ngẫu nhiên) ---
# BẮT BUỘC ở production. Sinh key: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=hay_doi_thanh_chuoi_ngau_nhien_dai_32_ky_tu_tro_len

# --- Tuỳ chọn: Cloudinary (chỉ cần khi upload ảnh sản phẩm) ---
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# --- Tuỳ chọn: OpenAI (chỉ cần khi dùng AI Assistant) ---
OPENAI_API_KEY=

# --- Tuỳ chọn: Sentry (monitoring) ---
SENTRY_DSN=
```

> 💡 Từ phiên bản này, các biến VNPT / Cloudinary / SMTP / SMS đã có **UI cấu hình tại `/integrations`** (cần role ADMIN). Giá trị nhập trong UI sẽ được lưu vào DB (mã hóa AES-256-GCM) và **ưu tiên hơn `.env`** — không cần redeploy khi đổi credentials.

> ⚠️ Lưu ý mật khẩu DB: `docker-compose.yml` mặc định dùng `postgres / uit / erp_db`. Nếu bạn sửa ở `docker-compose.yml` thì phải đồng bộ lại `DATABASE_URL` trong `.env`.

> 💡 **SMTP**: Cấu hình SMTP trong `.env` đã có sẵn. Khi đăng ký tài khoản mới, hệ thống sẽ gửi email xác minh qua Gmail App Password. Nếu chưa cấu hình, link xác minh sẽ được in ra console server (chế độ dev).

Tương tự, tạo `.env` cho frontend:

```bash
cd frontend
Copy-Item .env.example .env   # hoặc cp .env.example .env
cd ..
```

Mặc định frontend trỏ tới `http://localhost:4000` qua biến `VITE_API_URL` — chỉnh nếu backend đổi port.

---

### Bước 3 — Khởi động PostgreSQL + Redis bằng Docker

Cách đơn giản nhất là chạy cả 2 dịch vụ qua Docker. `docker-compose.yml` hiện có sẵn PostgreSQL; bạn có thể thêm Redis tạm thời bằng lệnh:

```bash
# 1. Khởi động PostgreSQL (theo docker-compose.yml)
docker compose up -d

# 2. Khởi động Redis (chạy tách riêng, port 6379)
docker run -d --name erp-redis -p 6379:6379 redis:7-alpine
```

Kiểm tra:

```bash
docker ps
# Phải thấy 2 container: erp-postgres (5432) và erp-redis (6379)
```

> 💡 Nếu **không muốn cài Redis**, vẫn chạy được — nhưng log backend sẽ spam `connect ECONNREFUSED 127.0.0.1:6379`. Socket.IO sẽ tự fallback sang in-memory adapter (xem `src/realtime/socket.js`).

---

### Bước 4 — Migrate database & seed dữ liệu mẫu

```bash
# Áp 18 migration — an toàn cho cả DB sạch lẫn DB đã có dữ liệu/bảng RAG
npm run db:migrate:deploy

# Tạo dữ liệu mẫu: tài khoản + sản phẩm + đơn hàng + kế toán demo
npm run db:seed

# (tuỳ chọn) Full-text search: GIN/pg_trgm index cho Customer/Product/Vendor
# Prisma không hỗ trợ @@fulltext với postgresql → index tạo bằng raw SQL
psql "$DATABASE_URL" -f prisma/sql/fulltext_search.sql
```

> ⚠️ Chỉ dùng `npm run db:migrate` (`prisma migrate dev`) khi bạn **đang phát triển schema mới**. Prisma 7 không biểu diễn được cột `real[]`/`vector` của bảng RAG → `migrate dev` trên DB đã có bảng RAG có thể sinh lệnh ALTER phá dữ liệu. Trường hợp khác đều dùng `db:migrate:deploy`.

Sau bước này DB đã có (xem `prisma/seed.js` — **mật khẩu tất cả tài khoản mẫu: `123456`**):

| Tài khoản | Vai trò |
| --- | --- |
| `super_omega_ultra_admin@gmail.com` | SUPER_OMEGA_ULTRA_ADMIN (quản trị nền tảng, `/admin`) |
| `superadmin@candory.com` | SUPER_ADMIN |
| `admin@candory.com` | ADMIN |
| `manager@candory.com`, `quocan@gmail.com` | MANAGER |
| `cashier@candory.com`, `phatlun@gmail.com` | CASHIER |
| `warehouse@candory.com` | WAREHOUSE |

Kèm theo: sản phẩm, danh mục, kho, khách hàng, đơn hàng mẫu · Chart of Accounts ~40 tài khoản · dữ liệu kế toán demo (PO, bút toán, lương).

Mở Prisma Studio để xem trực quan dữ liệu (tuỳ chọn):

```bash
npm run db:studio
# Mở trình duyệt: http://localhost:5555
```

---

### Bước 5 — Chạy backend

Mở **terminal 1** tại root của repo:

```bash
npm run dev
```

Khi thành công bạn sẽ thấy log kiểu:

```
[server] listening on http://localhost:4000
[socket] redis adapter attached
```

Kiểm tra:

- Gọi thử `POST /api/auth/login` với `admin@candory.com` / `123456`
- Swagger UI: <http://localhost:4000/api-docs>

---

### Bước 6 — Chạy frontend

Mở **terminal 2** (giữ terminal backend đang chạy):

```bash
cd frontend
npm run dev
```

Vite sẽ in ra:

```
  ➜  Local:   http://localhost:5173/
```

Mở trình duyệt vào <http://localhost:5173>, đăng nhập bằng tài khoản seed:

- **Email**: `admin@candory.com` (hoặc `super_omega_ultra_admin@gmail.com` để vào `/admin`)
- **Mật khẩu**: `123456`

---

### Bước 7 — Chạy test (tuỳ chọn)

```bash
# Chạy toàn bộ test
npm test

# Chạy 1 file test cụ thể
npx jest tests/debt.service.test.js
```

---

## 🛠️ Sự cố thường gặp (Troubleshooting)

| Triệu chứng | Nguyên nhân & Cách khắc phục |
| --- | --- |
| `Cannot find module '@socket.io/redis-adapter'` | Thiếu deps. Chạy lại `npm install`. Nếu vẫn lỗi: `npm install @socket.io/redis-adapter ioredis`. |
| `connect ECONNREFUSED 127.0.0.1:6379` (spam liên tục) | Chưa chạy Redis. Khởi động lại: `docker start erp-redis` hoặc tạo mới như Bước 3. App vẫn chạy được nhưng real-time bị giới hạn 1 instance. |
| `P1001: Can't reach database server at localhost:5432` | Postgres chưa chạy hoặc sai `DATABASE_URL`. Chạy `docker compose up -d` và kiểm tra user/pass trong `.env` khớp với `docker-compose.yml`. |
| `Error: P3009: migrate found failed migrations` | Migration cũ bị lỗi. Với DB rỗng: `npx prisma migrate reset` (sẽ xoá sạch DB rồi migrate + seed lại). |
| Login trả `401 Unauthorized` ngay sau seed | `JWT_SECRET` rỗng hoặc khác giữa các lần restart. Đặt một chuỗi cố định trong `.env`. |
| Frontend báo `Network Error` / CORS | Kiểm tra `CORS_ORIGIN` trong `.env` backend và `VITE_API_URL` trong `frontend/.env`. Đảm bảo backend đang chạy trước khi mở frontend. |
| Port 4000 / 5173 đã bị chiếm | Đổi `PORT` trong `.env` (mặc định 4000, tự tăng tối đa 10 lần nếu bị chiếm). Tìm tiến trình chiếm port: `netstat -ano &#124; findstr :4000` (Windows) hoặc `lsof -i :4000` (macOS/Linux). |
| Prisma Studio cảnh báo Node 25 | Hạ Node về 20 LTS hoặc 22 LTS (dùng `nvm` để chuyển nhanh). |

---

## 📋 Tóm tắt lệnh hay dùng

```bash
# Backend (chạy ở root)
npm install                 # cài deps
npm run dev                 # chạy dev server (nodemon)
npm start                   # production: migrate deploy + start (seed nếu SEED_ON_START=1)
npm run db:migrate:deploy   # áp migrations (an toàn cho DB sạch lẫn DB có dữ liệu)
npm run db:migrate          # DEV: tạo migration mới khi đổi schema.prisma
npm run db:seed             # nạp dữ liệu mẫu (TRUNCATE dữ liệu seed trước đó)
npm run db:studio           # mở Prisma Studio (GUI cho DB, port 5555)
npm test                    # chạy Jest (42 file, --runInBand)

# Frontend (chạy trong thư mục frontend/)
npm install
npm run dev                 # vite dev server (port 5173)
npm run build               # build production
npm run lint                # eslint
npm run preview             # preview bản build

# Docker hạ tầng
docker compose up -d        # khởi động Postgres (docker-compose.yml)
docker compose down         # dừng & giữ data
docker compose down -v      # dừng & XOÁ data (cẩn thận!)
docker start erp-redis      # khởi động lại Redis

# Production stack (docker-compose.prod.yml): db + redis + ollama + app + frontend
docker compose -f docker-compose.prod.yml up -d
```

---

## 🔐 Phân quyền (Role)

| Role                        | Phạm vi                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **SUPER_OMEGA_ULTRA_ADMIN** | Toàn quyền tối cao — giao diện admin riêng tại `/admin`, quản lý tenant (danh sách/thống kê), gói dịch vụ, hóa đơn subscription, tạo phiên hỗ trợ impersonate ADMIN tenant. Không thấy sidebar ERP trừ khi ở chế độ support. |
| **SUPER_ADMIN**             | Toàn quyền hệ thống + admin dashboard đa tenant                                                                   |
| **ADMIN**                   | Toàn quyền trong tenant — quản lý users, kế toán, audit                                                           |
| **MANAGER**                 | Hầu hết module trừ Users, Audit, Journal                                                                          |
| **ACCOUNTANT**              | Kế toán, báo cáo thuế, công nợ, đối soát ngân hàng, nhật ký/sổ cái (ít quyền trên POS & kho)                     |
| **CASHIER**                 | POS, Orders, Products, Customers, CRM tasks                                                                       |
| **WAREHOUSE**               | Inventory, Cycle count, Stock transfer, BOM/Work Orders                                                           |

---

## 🌐 API endpoints cơ bản

```plaintext
# --- Core & nền tảng ---
/api/auth                         # login, refresh, logout, 2FA (setup/enable/disable/verify), verify-email
/api/users                        # user CRUD (phân quyền theo ROLE_RANK)
/api/settings                     # company settings, onboarding, business-template, accounting-mode
/api/audit                        # nhật ký hoạt động
/api/notifications                # thông báo + unread-count
/api/admin                        # super admin đa tenant + phiên hỗ trợ (impersonate)
/api/admin/backup                 # sao lưu / phục hồi (chỉ SUPER_OMEGA_ULTRA_ADMIN)
/api/subscriptions                # gói dịch vụ, thuê bao, hóa đơn, webhook PayOS
/api/search                       # tìm kiếm toàn cục
/api/bulk                         # thao tác hàng loạt (bật/tắt SP, đổi giá, hủy đơn)
/api/documents                    # tài liệu nội bộ (upload có kiểm tra magic bytes)
/api/push                         # Web Push: config / subscribe / test

# --- Bán hàng & kho ---
/api/products, /api/categories    # sản phẩm (SKU, ảnh Cloudinary) + danh mục
/api/orders                       # đơn hàng (mã ORD-*) — thanh toán nằm dưới /api/orders/:orderId/payments
/api/invoices                     # hóa đơn PDF
/api/returns                      # trả hàng & hoàn tiền
/api/promotions                   # khuyến mãi
/api/pos                          # POS: quét barcode, in bill Bluetooth, offline queue
/api/import                       # import Excel sản phẩm / khách hàng / NCC
/api/inventory                    # tồn kho, giao dịch, định giá hàng tồn kho
/api/inventory/cycle-counts       # kiểm kê (từng kho)
/api/serial-numbers               # tracking số sê-ri
/api/warehouses, /api/stock-transfers
/api/deliveries                   # GHTK / GHN / VNPOST / Viettel / J&T + webhook

# --- CRM & loyalty ---
/api/customers                    # khách hàng 360°, hạng tier
/api/crm                          # campaigns, segments, tags, notes, tasks
/api/store-credits, /api/loyalty, /api/stamp-cards
/api/churn-alerts                 # cảnh báo khách rời bỏ
/api/webhook                      # webhook bắt lead public (xác thực X-Tenant-Key)

# --- Nhân sự ---
/api/hr                           # nhân viên, ca làm, lương, nghỉ phép, OT, vi phạm

# --- Kế toán & tài chính ---
/api/accounting                   # CoA, journal, autopost, sổ cái/B01–B03, kết chuyển, khấu hao, CIT
/api/accounting/expenses          # chi phí (duyệt theo workflow)
/api/purchase-orders, /api/grn, /api/purchase-invoices
/api/debts, /api/bank-reco, /api/bank-accounts, /api/petty-cash
/api/tax-reports, /api/einvoice, /api/fixed-assets, /api/currencies
/api/vietqr                       # VietQR + webhook Casso / SePay / PayOS

# --- F&B (hiện khi businessTemplate là F&B) ---
/api/menu, /api/tables, /api/kds, /api/printers
/api/qr-ordering                  # public, không cần đăng nhập (Zod validated)
/api/food-delivery                # GrabFood / ShopeeFood / BeFood inbox
/api/recipes, /api/payment-gateway

# --- Sản xuất & dự án ---
/api/production                   # BOM đa cấp, work-orders, lots, work-centers, routings, quality
/api/projects                     # dự án, công việc, timesheet

# --- Báo cáo, AI & tích hợp ---
/api/dashboard, /api/reports, /api/analytics, /api/report-builder
/api/ai, /api/agent, /api/db-agent, /api/llm, /api/ai-forecast, /api/smart-guide
/api/integrations, /api/webhooks, /api/marketplace, /api/portal, /api/workflows

# --- Khác ---
/api/health                       # health check public (bản chi tiết /api/health/full — chỉ SUPER_OMEGA_ULTRA_ADMIN)
```

Chi tiết tham số từng endpoint: xem Swagger tại `/api-docs`.

---

## ⏰ Cron jobs & Real-time

**Cron** (`src/jobs/cron.js`) — **29 tác vụ định kỳ** (trích các tác vụ chính):

- Mỗi phút: xử lý CRM campaigns đã đặt lịch
- Mỗi 5 phút: quét phiên hỗ trợ hết hạn (support sessions) + retry webhook thất bại
- Mỗi giờ: hủy đơn `PENDING` quá 24h
- 00:00 hằng ngày: expire khuyến mãi, loyalty points, subscription hết hạn
- 01:00 hằng ngày: tính CLV / build phân khúc RFM; 01:30 cập nhật danh sách khách tiềm năng
- 02:00 hằng ngày: **sao lưu database** (mã hoá, `BACKUP_DIR`)
- 07:00 hằng ngày: **Morning Briefing** (báo cáo sáng + anomaly alerts)
- 08:00 hằng ngày: **Anomaly Detection** (doanh thu giảm, chi phí tăng, KH dormant) + nhắc nhiệm vụ CRM sắp tới hạn
- 08:30 hằng ngày: cập nhật tỷ giá tự động
- 09:00 hằng ngày: **Debt Auto-Collection** (3 cấp: sắp hạn, quá 7 ngày, quá 30 ngày) + nhắc gia hạn subscription
- 10:00 hằng ngày: **Bank Reco Auto-Match** (tự động đối soát sao kê)
- Cảnh báo lot hết hạn + tự động lưu trữ đơn/phiếu cũ (hằng ngày)
- 01:00 ngày 1 hằng tháng: sinh chi phí định kỳ + phân bổ trả trước (242)
- 06:00 ngày 1 hằng tháng: **Vendor Scorecard** (OTIF, tỷ lệ lỗi, hạng NCC)
- 06:00 ngày 25: **Auto-Payroll** (tự động tính lương + bút toán kế toán)
- 01:00 ngày 28: chạy khấu hao TSCĐ tháng
- 08:00 thứ Hai hằng tuần: báo cáo P&L tuần
- 09:00 ngày 28: nhắc đóng kỳ kế toán

**Socket.IO** (`src/realtime/socket.js`):

- Client kết nối tới **origin của API** (bỏ hậu tố `/api`)
- Xác thực qua `handshake.auth.token` (JWT giống `Authorization: Bearer ...`)
- Có Redis adapter để scale ngang nhiều instance
- Fallback: frontend poll `GET /api/notifications/unread-count` mỗi 30s (xem TopBar)

---

## 🚢 Deploy production (Railway)

Dockerfile có sẵn — chỉ cần push lên GitHub, Railway tự build & deploy:

1. Push branch `main` lên GitHub
2. Railway auto trigger build từ `Dockerfile`
3. `Dockerfile CMD` chạy `npx prisma migrate deploy && node src/app.js` → tự áp dụng migration mới khi deploy
4. Set các biến môi trường tương ứng trong Railway dashboard:
   - `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`, `CLIENT_URL`, `REDIS_URL`
   - `CLOUDINARY_*`, `OPENAI_API_KEY`, `SENTRY_DSN` (tùy chọn)

---

## 🔐 Bảo mật & Bảo vệ dữ liệu doanh nghiệp

Hệ thống đã được hardening đầy đủ cho production với dữ liệu doanh nghiệp:

### Multi-tenant Isolation (CRITICAL)
- **Prisma `$extends` + AsyncLocalStorage**: tự động inject `tenantId` vào mọi query (findMany, create, update, delete) — **132 model** được auto-scope (`TENANT_SCOPED_MODELS` trong `config/prisma.js`)
- Tenant A **không thể** xem/sửa dữ liệu Tenant B qua API
- `SUPER_OMEGA_ULTRA_ADMIN` bypass scoping (xem tất cả tenant)
- Public routes (QR ordering) set tenant context thủ công từ resource's tenantId
- File: `config/prisma.js`, `config/tenantContext.js`, `middleware/auth.middleware.js`

### Auth & Session
- **JWT access token**: mặc định **15m** (`JWT_EXPIRES_IN`, HS256, algorithm restrict — không bypass "none")
- **Refresh token**: 7 ngày, **hash SHA256** trước khi lưu DB (không plaintext)
- **Refresh token rotation**: mỗi lần refresh → revoke token cũ + tạo mới; dùng lại token đã revoke → revoke cả family + 401
- **Refresh token trong httpOnly cookie** (`rt`, path `/api/auth`) — JS không đọc được
- **Password policy**: tối thiểu 8 ký tự, bắt buộc 1 chữ hoa + 1 chữ số (register + changePassword)
- **Bcrypt** hash password (`BCRYPT_ROUNDS` mặc định **12**)
- **DB check trong authenticate**: reject 503 nếu DB fail (không allow-through)
- **Login generic error**: "Email hoặc mật khẩu không đúng" (không user enumeration)
- File: `auth.service.js`, `auth.validation.js`, `auth.middleware.js`

### Webhook Security
- **X-Tenant-Key webhook CRM lead**: `POST /api/webhook/crm-lead` public, xác thực bằng API key của tenant (lưu `IntegrationConfig` category `LEAD_WEBHOOK`, rotate qua `POST /api/webhook/crm-lead-key`)
- **Idempotency-Key** (tùy chọn header): webhook retry trong 24h trả về kết quả đã ghi nhận (`duplicate: true`, HTTP 200) — không tạo trùng lead/customer
- **Raw body verification**: `express.raw` cho payment-gateway webhooks (Momo/VNPay/ZaloPay)
- **HMAC signature verify**: đúng thuật toán từng provider (Momo SHA256, VNPay SHA512, ZaloPay SHA256)
- **Reject khi chưa cấu hình**: production `return false` (không `return true` như cũ)
- File: `payment-gateway.routes.js`, `payments/providers/*.adapter.js`

### PII Protection
- **PII masking**: CASHIER/WAREHOUSE thấy `09***5678`, `n***@email.com` cho phone/email/taxCode
- ADMIN/MANAGER/ACCOUNTANT xem full (cần cho kế toán, CRM)
- File: `utils/piiMask.js`, `customer.routes.js`

### Infrastructure
- **ENCRYPTION_KEY**: AES-256-GCM cho IntegrationConfig secrets — crash nếu thiếu ở production
- **helmet**: security headers (X-Content-Type-Options, X-Frame-Options, etc.)
- **hpp**: HTTP Parameter Pollution protection
- **Rate limiting**: global 100 req/min, login 5/min, AI 10/min
- **Full-text search (PostgreSQL)**: bật preview `fullTextSearchPostgres` (Prisma 7) → filter `{ search: "..." }` compile thành `tsvector @@ tsquery`; GIN index (pg_trgm) cho Customer/Product/Vendor tạo bằng `prisma/sql/fulltext_search.sql` khi migrate (Prisma không hỗ trợ attribute `@@fulltext` cho connector postgresql)
- **Refresh token rotation**: access token mặc định **15m**, refresh 7d (`RefreshToken` table, revoke-all khi reuse)
- **Body limit**: 100kb
- **File upload**: multer fileFilter — chỉ ảnh (JPEG/PNG/WebP/SVG) hoặc Excel/CSV
- **CORS**: single-origin + credentials
- **No raw SQL injection**: 0 `$queryRawUnsafe` với user input (chỉ static "SELECT 1")
- **xss-clean removed**: deprecated, dựa vào Zod validation + helmet

### Audit Trail
- **AuditLog** cho: LOGIN, CHANGE_PASSWORD, REGISTER, CREATE/UPDATE/DELETE Order/Product/Customer/Vendor
- Tenant-scoped: user chỉ xem audit log của tenant mình
- File: `audit/audit.service.js`

### Lưu ý production
- **Không commit `.env`** — đã gitignored, kiểm tra `git log --all -- .env`
- **DB SSL**: thêm `?sslmode=require` vào DATABASE_URL
- **Rotate secrets**: `ENCRYPTION_KEY`, `JWT_SECRET` định kỳ
- **Backup DB**: setup `pg_dump` cron hoặc managed backup
- **HTTPS**: đảm bảo reverse proxy (nginx) terminate TLS

---

## 📖 Hướng dẫn sử dụng các module mở rộng

> Các module dưới đây là phần bổ sung sau giai đoạn nền tảng (Phase 1–4). Tất cả endpoint đều dùng JWT — gắn header `Authorization: Bearer <token>`. Các trang frontend tương ứng đều có sẵn ở `/einvoice`, `/tax-reports`, `/bank-reco`, `/fixed-assets`, `/currency`, `/marketplace`, `/report-builder`, `/workflows`, `/lot-tracking`.

---

### 🧾 1. Hóa đơn điện tử (E-Invoice — VNPT)

**Mục đích**: phát hành HĐĐT cho đơn hàng, lấy mã CQT, hủy hoặc tra cứu lại trạng thái.

**Frontend**: vào trang `E-Invoice` từ sidebar → chọn đơn hàng → bấm **Phát hành** → hệ thống gọi VNPT, trả về số hóa đơn + mã CQT.

**API**:

```http
GET    /api/einvoice                      # danh sách HĐĐT (filter: status, from, to)
GET    /api/einvoice/:id                  # chi tiết
POST   /api/einvoice/order/:orderId/issue # phát hành HĐĐT cho 1 Order
POST   /api/einvoice/:id/cancel           # hủy (chỉ ADMIN) — kèm lý do
POST   /api/einvoice/:id/sync             # đồng bộ lại trạng thái từ VNPT
```

**Cấu hình VNPT** (`.env`):

```env
VNPT_EINVOICE_URL=https://...        # endpoint VNPT (sandbox/production)
VNPT_USERNAME=...
VNPT_PASSWORD=...
VNPT_TAX_CODE=0312345678
VNPT_PATTERN=1/001                    # mẫu số HĐ
VNPT_SERIAL=K24TAA                    # ký hiệu HĐ
```

> Nếu để trống, adapter chạy ở **mock mode** (sinh mã giả) — dùng cho dev/demo.

---

### 📊 2. Báo cáo thuế HTKK (Tax Report)

**Mục đích**: xuất tờ khai thuế đúng schema HTKK, nộp lên Tổng cục Thuế.

**Frontend**: trang `Báo cáo thuế` → chọn năm + tháng → 3 tab: VAT / PIT / BHXH → bấm **Xuất XML** hoặc **Xuất Excel**.

**API**:

```http
GET /api/tax-reports/vat?year=2026&month=5         # tờ khai 01/GTGT + bảng kê bán/mua
GET /api/tax-reports/pit?year=2026&month=5         # tờ khai 05/KK-TNCN
GET /api/tax-reports/vat/excel?year=2026&month=5   # tải file Excel
GET /api/tax-reports/vat/xml?year=2026&month=5     # tải file XML HTKK
GET /api/tax-reports/bhxh/excel?year=2026&month=5  # D02-LT (BHXH)
```

**Lưu ý**: hệ thống lấy dữ liệu từ `Invoice`, `PurchaseOrder`, `Payroll`. Đảm bảo:

- Đã set `taxCode` trong `Company Settings`
- Mỗi nhân viên có `idNumber` (CCCD) + `pitCode` (MST cá nhân) để PIT chạy đúng
- Payroll kỳ tương ứng đã chạy `runPayroll` xong

---

### 💰 3. PIT / BHXH trong Payroll

**Mục đích**: tự động tính thuế TNCN (biểu lũy tiến 7 bậc) + BHXH (8%) + BHYT (1.5%) + BHTN (1%) khi chạy payroll.

**Frontend**: vào `Nhân sự → Bảng lương` → bấm **Tính lương kỳ** — kết quả hiện thêm cột PIT, BHXH, BHYT, BHTN, Net.

**Logic** (xem [payroll.calc.js](src/modules/hr/payroll.calc.js)):

- Lương đóng BH = min(lươngCơBản, 20×mức lương cơ sở)
- PIT theo bậc lũy tiến, đã trừ giảm trừ bản thân (11tr) + người phụ thuộc (4.4tr/người)
- Field cấu hình ở Employee: `dependents`, `pitCode`, `bhxhSalary` (nếu khác lương CB)

---

### 🏦 4. Đối soát ngân hàng (Bank Reconciliation)

**Mục đích**: import sao kê VCB/TCB → tự động match với JournalEntry → tạo bút toán điều chỉnh cho phần lệch.

**Frontend**: trang `Đối soát ngân hàng` → chọn tài khoản ngân hàng → **Upload sao kê** (.xlsx/.csv VCB hoặc TCB) → bấm **Auto-match** → review các dòng chưa match → **Match thủ công** hoặc **Tạo điều chỉnh**.

**API**:

```http
GET   /api/bank-reco/statements
GET   /api/bank-reco/statements/:id/lines?isMatched=false
POST  /api/bank-reco/statements/import     # multipart: file, bankAccountId, bank=VCB|TCB
POST  /api/bank-reco/statements/:id/auto-match
PATCH /api/bank-reco/lines/:lineId/match   # body: { entryId }
PATCH /api/bank-reco/lines/:lineId/unmatch
POST  /api/bank-reco/lines/:lineId/adjustment  # body: { bankAccountId, description, amount }
```

**Quy tắc auto-match**: cùng số tiền (±1đ) + cùng ngày (±3 ngày) + matching keyword trong description.

---

### 🏢 5. Tài sản cố định (Fixed Assets)

**Mục đích**: quản lý TSCĐ + tự động khấu hao straight-line hằng tháng.

**Frontend**: trang `Tài sản cố định` → tab **Categories** (thiết lập nhóm + thời gian khấu hao) → tab **Assets** (thêm TSCĐ, kèm ngày bắt đầu khấu hao, giá trị ban đầu) → tab **Lịch khấu hao** xem dự kiến.

**API**:

```http
GET  /api/fixed-assets/categories
POST /api/fixed-assets/categories          # { name, usefulLifeMonths, depreciationAccountId }
GET  /api/fixed-assets                     # ?categoryId=&status=ACTIVE|DISPOSED
GET  /api/fixed-assets/:id                 # chi tiết + lịch sử khấu hao
POST /api/fixed-assets                     # { code, name, categoryId, cost, startDate, ... }
POST /api/fixed-assets/:id/dispose         # thanh lý — body: { date, salePrice }
POST /api/fixed-assets/depreciation/run    # chạy thủ công 1 kỳ — body: { year, month }
```

**Cron tự động**: chạy 02:00 ngày cuối tháng → khấu hao toàn bộ TSCĐ `ACTIVE` + autopost bút toán **Nợ 642/Có 214**.

---

### 💱 6. Đa tiền tệ (Multi-currency)

**Mục đích**: quản lý nhiều loại tiền + tỷ giá theo ngày.

**Frontend**: trang `Tiền tệ` → thêm currency (USD, EUR…) → cập nhật tỷ giá hằng ngày.

**API**:

```http
GET  /api/currencies                       # list + tỷ giá hiện tại
GET  /api/currencies/:code/rates?limit=30  # lịch sử tỷ giá
POST /api/currencies                       # { code, name, symbol, isBase }
POST /api/currencies/:code/rates           # { rate, effectiveDate }
```

Khi tạo Order/PurchaseOrder, có thể chọn `currencyCode` → hệ thống tự quy đổi sang VND tại thời điểm phát sinh để hạch toán.

---

### 🛒 7. Marketplace (Shopee / Lazada / TikTok)

**Mục đích**: đồng bộ sản phẩm + đơn hàng giữa ERP và các sàn.

**Frontend**: trang `Marketplace` → **Kết nối shop** (chọn sàn + nhập API key) → tab **Listings** map sản phẩm ERP ↔ sản phẩm sàn → bấm **Push Inventory** (đẩy tồn lên sàn) / **Pull Orders** (kéo đơn về ERP).

**API**:

```http
GET   /api/marketplace/shops
POST  /api/marketplace/shops                 # { platform: SHOPEE|LAZADA|TIKTOK, name, apiKey, ... }
PATCH /api/marketplace/shops/:id/toggle      # { isActive: true|false }
GET   /api/marketplace/shops/:id/listings
POST  /api/marketplace/shops/:id/listings    # { productId, externalId, price, stock }
GET   /api/marketplace/shops/:id/logs        # ?limit=50
POST  /api/marketplace/shops/:id/push-inventory
POST  /api/marketplace/shops/:id/pull-orders
```

> Adapter hiện ở dạng **stub** — sẵn sàng plug API key thật của Shopee Open Platform / Lazada Open Platform / TikTok Shop API.

---

### 📐 8. Report Builder (Trình dựng báo cáo)

**Mục đích**: cho phép user tự kéo thả tạo báo cáo từ dữ liệu ERP — an toàn nhờ **whitelist** bảng và cột (không SQL injection).

**Frontend**: trang `Report Builder` → chọn bảng (Orders, Customers, …) → chọn cột → thêm filter → **Run** xem kết quả → **Save** để dùng lại.

**API**:

```http
GET    /api/report-builder/tables          # danh sách bảng + cột được phép
GET    /api/report-builder                 # báo cáo đã lưu của tôi
POST   /api/report-builder                 # tạo báo cáo — body: { name, table, columns, filters, groupBy }
PATCH  /api/report-builder/:id
DELETE /api/report-builder/:id             # ADMIN only
POST   /api/report-builder/run             # chạy ad-hoc, không lưu — body: { table, columns, filters }
POST   /api/report-builder/:id/run         # chạy báo cáo đã lưu
```

**Ví dụ body**:

```json
{
  "table": "Order",
  "columns": ["id", "total", "status", "createdAt", "customer.name"],
  "filters": [{ "field": "status", "op": "=", "value": "COMPLETED" }],
  "groupBy": "status",
  "orderBy": { "field": "createdAt", "dir": "desc" }
}
```

---

### ✅ 9. Workflow / Approval

**Mục đích**: bắt buộc duyệt nhiều cấp cho các nghiệp vụ vượt ngưỡng (chi phí, PO, nghỉ phép).

**Frontend**: trang `Workflows` → tạo rule (trigger + ngưỡng + người duyệt từng bước) → khi phát sinh giao dịch match rule, hệ thống tự tạo **WorkflowRun** + push notification cho người duyệt → người duyệt vào tab **Cần tôi duyệt** → **Approve** / **Reject**.

- **Đã tích hợp** vào Expense (submit → EXPENSE_ABOVE trigger), PurchaseOrder (submit → PO_ABOVE trigger), Leave Request (POST /hr/leave → LEAVE_REQUEST trigger)
- **Auto-approve**: khi tất cả approval steps `APPROVED`, workflow tự approve entity gốc (expense/PO/leave)
- **Template workflows**: tự động seed 3 template (Duyệt chi phí >5M, Duyệt PO >10M, Duyệt nghỉ phép) qua `POST /api/settings/seed-demo`

**API**:

```http
GET   /api/workflows
POST  /api/workflows                  # ADMIN — { name, trigger, threshold, steps: [{ approverIds, order }] }
PATCH /api/workflows/:id
GET   /api/workflows/runs/:runId      # xem 1 instance
POST  /api/workflows/approvals/:approvalId/decide   # { decision: APPROVE|REJECT, comment }
```

**Triggers hỗ trợ**: `EXPENSE_ABOVE`, `PO_ABOVE`, `LEAVE_REQUEST`, `CUSTOM`.

---

### 👤 10. Customer Self-service Portal

**Mục đích**: khách hàng đăng nhập bằng OTP (gửi qua SMS/email) để tự xem đơn hàng / công nợ / hóa đơn / điểm thưởng — **không dùng JWT**, dùng `x-portal-token` riêng.

**Luồng**:

1. KH nhập SĐT → `POST /api/portal/otp/request` → nhận OTP 6 số
2. KH nhập OTP → `POST /api/portal/otp/verify` → trả về `token`
3. Các request sau gửi header `x-portal-token: <token>`

**API**:

```http
POST /api/portal/otp/request      # { phone }
POST /api/portal/otp/verify       # { phone, otp }  →  { token, customer }
GET  /api/portal/me               # profile + điểm loyalty + hạng
GET  /api/portal/orders           # đơn hàng của tôi
GET  /api/portal/debt             # công nợ
GET  /api/portal/invoices         # hóa đơn
POST /api/portal/orders           # tự đặt hàng (B2B) — body: { items, paymentMethod }
GET  /api/portal/debt/pay         # tạo VietQR thanh toán công nợ
GET  /api/portal/rewards          # điểm loyalty + rewards có thể đổi
POST /api/portal/rewards/redeem    # đổi điểm lấy ưu đãi
```

> Portal frontend riêng chưa kèm trong repo — có thể build SPA nhỏ hoặc nhúng vào website công ty. OTP mặc định log ra console khi chưa cấu hình SMS gateway. Khách có thể tự đặt hàng, thanh toán công nợ qua VietQR, xem và đổi điểm loyalty.

---

### 🏭 11. Sản xuất nâng cao — Lot / Routing / Work Center / QC

**Lot/Serial/Expiry** ([LotTracking.jsx](frontend/src/pages/LotTracking.jsx)):

```http
GET  /api/production/lots                # ?productId=&warehouseId=&hasStock=true
GET  /api/production/lots/expiring?days=30   # cảnh báo hết hạn
GET  /api/production/lots/:id            # chi tiết + lịch sử di chuyển
POST /api/production/lots/receive        # { productId, warehouseId, lotNumber, qty, expiryDate }
POST /api/production/lots/:id/consume    # { quantity, reason }
```

**Work Center** (máy/dây chuyền — gắn account chi phí để autopost):

```http
GET    /api/production/work-centers
POST   /api/production/work-centers      # { code, name, accountId, costPerHour }
PATCH  /api/production/work-centers/:id
DELETE /api/production/work-centers/:id  # ADMIN
```

**Routing** (định tuyến công đoạn cho mỗi BOM):

```http
GET   /api/production/routings           # ?productId=
POST  /api/production/routings           # { productId, name, steps: [{ workCenterId, sequence, runtimeMin }] }
PATCH /api/production/routings/:id
```

**Quality Check**: tự khởi tạo khi Work Order chuyển `IN_PROGRESS`. Khi `COMPLETE`, nếu QC chưa pass thì WO bị chặn. Endpoint nằm trong [work-order.service.js](src/modules/production/work-order.service.js) — gọi qua action complete.

---

### ⏱️ 12. Project Timesheet

**Mục đích**: log giờ làm theo task → tổng hợp cho payroll hoặc xuất hóa đơn dự án (T&M billing).

**API** (nested dưới `/api/projects/:id`):

```http
GET    /api/projects/:id/timesheet              # ?from=&to=&userId=
POST   /api/projects/:id/timesheet              # { taskId, date, hours, note }
PATCH  /api/projects/:id/timesheet/:entryId
DELETE /api/projects/:id/timesheet/:entryId     # MANAGER+

GET    /api/projects/:id/invoices
POST   /api/projects/:id/invoices/generate      # body: { from, to, rate }
PATCH  /api/projects/:id/invoices/:invId        # { status: DRAFT|SENT|PAID }
```

**Frontend**: vào `Dự án → Chi tiết` → tab **Timesheet** thêm giờ; tab **Hóa đơn dự án** generate theo khoảng thời gian.

---

### 💳 13. Subscription & Billing (Gói dịch vụ)

**Mục đích**: SUPER_OMEGA_ULTRA_ADMIN tạo các gói dịch vụ (Free/Pro/Enterprise), gán cho tenant, theo dõi hóa đơn thanh toán. Tenant có thể xem gói hiện tại + hạn mức + lịch sử hóa đơn.

**Frontend admin** (`/admin/plans`, `/admin/subscriptions`, `/admin/invoices`):

- `PlansManagement`: CRUD gói — tên, key, giá, số ngày, features JSON (maxUsers, maxWarehouses,...)
- `TenantSubscriptionManager`: danh sách thuê bao tenant + đổi gói
- `InvoiceManagement`: tất cả hóa đơn subscription, filter theo status, đánh dấu PAID/CANCELLED

**Frontend tenant** (`/subscription`):

- Thông tin gói hiện tại + ngày hết hạn + trạng thái (ACTIVE/TRIAL/EXPIRED)
- Danh sách tính năng được hưởng (số nhân viên, kho, sản phẩm...)
- Lịch sử hóa đơn + nút thanh toán

**API**:

```http
# Plans (public)
GET    /api/subscriptions/plans                     # danh sách gói
GET    /api/subscriptions/plans/:id                 # chi tiết 1 gói

# Plans (SUPER_OMEGA_ULTRA_ADMIN)
POST   /api/subscriptions/plans                     # tạo gói mới
PUT    /api/subscriptions/plans/:id                 # sửa gói
DELETE /api/subscriptions/plans/:id                 # xóa (soft)

# Tenant-facing
GET    /api/subscriptions/my                        # thuê bao hiện tại
GET    /api/subscriptions/my/invoices               # hóa đơn của tôi
POST   /api/subscriptions/my/invoices/:id/pay       # thanh toán hóa đơn

# SUPER_OMEGA_ULTRA_ADMIN: quản lý tenant
GET    /api/subscriptions/tenant                    # tất cả thuê bao
POST   /api/subscriptions/tenant/:tenantId          # gán/đổi gói

# SUPER_OMEGA_ULTRA_ADMIN: quản lý hóa đơn
GET    /api/subscriptions/admin/invoices            # tất cả hóa đơn (?status=)
POST   /api/subscriptions/admin/invoices            # tạo hóa đơn thủ công
PUT    /api/subscriptions/admin/invoices/:id        # cập nhật trạng thái
```

**Plan enforcement**: middleware `plan.middleware.js` kiểm tra 2 cấp độ:

1. **Quota checks** (số lượng):
   - `maxUsers`: chặn tạo user mới nếu vượt quota
   - `maxWarehouses`: chặn tạo kho mới
   - `maxProducts`: chặn tạo sản phẩm mới

2. **Module-level gating** (`requireModule("moduleKey")`):
   - Mỗi route backend được bảo vệ bằng middleware kiểm tra `allowedModules` trong `features` JSON
   - Frontend dùng `PlanGate` component + `usePlan` hook kiểm tra tương ứng, hiển thị `UpgradePrompt` nếu không được phép
   - Gói Enterprise dùng wildcard `['*']` — bỏ qua mọi kiểm tra module

3. **Feature-level gating** (`checkFeature("flag")`):
   - Một số module thuộc gói Free nhưng có tính năng nâng cao bị giới hạn (vd: HR cơ bản free, nhưng PIT/BHXH/violations tính phí)
   - Dùng `checkFeature("hrPit")` middleware trên các route cụ thể
   - Frontend có thể dùng `hasFeature("key")` từ `usePlan` hook để ẩn/hiện UI elements

**Chi tiết gói Miễn phí (Free) — 0₫/tháng | 5 users | 2 kho | 200 sản phẩm**

| Module | Tính năng được dùng | Giới hạn |
|---|---|---|
| **Dashboard** | Dashboard tổng quan: doanh thu hôm nay, đơn hàng mới, tồn kho thấp, top sản phẩm bán chạy | Không analytics nâng cao, không RFM |
| **Sản phẩm & Danh mục** | Tạo/sửa/xóa sản phẩm, quản lý danh mục, upload ảnh Cloudinary | Tối đa 200 sản phẩm |
| **Kho** | Xem tồn kho, nhập/xuất kho thủ công, điều chỉnh tồn kho | Tối đa 2 kho, không chuyển kho liên kho |
| **Đơn hàng** | Tạo/sửa/hủy đơn hàng, xem lịch sử đơn, in hóa đơn PDF, nhiều phương thức thanh toán (cash/card/transfer/momo) | — |
| **POS Barcode** | Bán hàng POS quét barcode cơ bản | — |
| **Trả hàng & Hoàn tiền** | Xử lý trả hàng, hoàn tiền cho khách | — |
| **Khách hàng** | Danh sách khách hàng, thêm/sửa thông tin, xem lịch sử mua hàng | — |
| **CRM cơ bản** | Ghi chú khách hàng (Note/Call/Email/Meeting), Tag phân loại khách hàng | Không segment nâng cao |
| **Loyalty cơ bản** | Tích điểm khách hàng, xem hạng thành viên (BRONZE/SILVER/GOLD/PLATINUM) | Không tùy chỉnh rule tích điểm |
| **Khuyến mãi** | Tạo chương trình giảm giá (%, fixed, buy X get Y) | — |
| **Nhân sự cơ bản** | Quản lý nhân viên, chấm công 3 ca, tính lương Payroll đơn giản | Không PIT/BHXH, không vi phạm, không khóa kỳ lương |
| **Kế toán cơ bản** | Xem Chart of Accounts, ghi Journal Entry thủ công, xem P&L đơn giản | Không autopost, không Balance Sheet/Cash Flow |
| **Công nợ cơ bản** | Xem công nợ phải thu/phải trả, ghi nhận thanh toán công nợ | — |
| **Nhà cung cấp & Mua hàng** | Quản lý danh sách vendor, tạo đơn mua hàng đơn giản | — |
| **Giao hàng** | Tích hợp GHTK / GHN / VNPOST / Viettel / J&T | — |
| **Báo cáo cơ bản** | Báo cáo doanh thu, sản phẩm bán chạy, khách hàng — xuất Excel | — |
| **Thông báo real-time** | Thông báo hệ thống qua Socket.IO | — |
| **Audit Log** | Xem lịch sử thao tác của tài khoản | — |
| **Import dữ liệu** | Bulk import sản phẩm, khách hàng từ Excel/CSV | — |
| **Onboarding Wizard** | Hướng dẫn thiết lập ban đầu cho doanh nghiệp mới | — |
| **Đăng ký & Nâng gói** | Xem gói hiện tại, so sánh gói, yêu cầu nâng cấp | — |

**Không được truy cập ở Free:** Chuyển kho liên kho, Kiểm kê (Cycle Count), Segment khách hàng nâng cao, Email/Zalo Marketing Campaign, HR nâng cao (PIT/BHXH/vi phạm/khóa kỳ), Kế toán nâng cao (Balance Sheet, Cash Flow, autopost), Hóa đơn điện tử VNPT, Báo cáo thuế HTKK, Đối soát ngân hàng, Tài sản cố định, Đa tiền tệ, Quản lý Dự án, Quản lý Sản xuất (BOM/WO/QC/Lot), Workflow/Approval, Portal khách hàng, Marketplace (Shopee/Lazada/TikTok), Report Builder, Trung tâm Tích hợp, AI Assistant, Analytics RFM

**So sánh với bản cũ:**

| Tính năng | Trước | Sau |
|---|---|---|
| Users | 3 | 5 |
| Kho | 1 | 2 |
| Sản phẩm | 50 | 200 |
| POS Barcode | ❌ | ✅ |
| Trả hàng & Hoàn tiền | ❌ | ✅ |
| CRM (Notes, Tag) | ❌ | ✅ |
| Loyalty | ❌ | ✅ |
| Khuyến mãi | ❌ | ✅ |
| Nhân sự cơ bản | ❌ | ✅ |
| Kế toán cơ bản | ❌ | ✅ |
| Công nợ | ❌ | ✅ |
| Nhà cung cấp & Mua hàng | ❌ | ✅ |
| Giao hàng | ❌ | ✅ |
| Báo cáo xuất Excel | ❌ | ✅ |
| Audit Log | ❌ | ✅ |
| Bulk Import | ❌ | ✅ |

**Cron** (`src/jobs/cron.js`): 00:00 hằng ngày quét subscription hết hạn → set status EXPIRED.

**Seed**: khi chạy `npm run db:seed` sẽ tạo sẵn 3 gói (free/pro/enterprise) + gán pro cho CANDORY tenant.

**Tài khoản SUPER_OMEGA_ULTRA_ADMIN**: `super_omega_ultra_admin@gmail.com` / `123456`

> **Quản lý tài khoản cho SUPER_OMEGA_ULTRA_ADMIN**: Vào trang `/users` để tạo/sửa tất cả tài khoản, bao gồm cả `SUPER_ADMIN` và `SUPER_OMEGA_ULTRA_ADMIN`. SUPER_OMEGA_ULTRA_ADMIN thấy toàn bộ user hệ thống (có cột tenant), ADMIN thường chỉ thấy user trong tenant của mình.

---

### 🔌 14. Trung tâm tích hợp (Integration Center)

**Mục đích**: thay vì chỉnh `.env` rồi redeploy mỗi khi đổi key VNPT/Cloudinary/SMTP/SMS, quản trị viên có thể cấu hình trực tiếp qua **UI tại `/integrations`** (cần role ADMIN). Giá trị được mã hóa **AES-256-GCM** trong DB và **ưu tiên hơn `process.env`**.

**Frontend**: trang `Trung tâm tích hợp` → 4 tab (VNPT / Cloudinary / SMS / SMTP):

- Mỗi tab có form cấu hình + nút **Test kết nối** (gửi SMS thật, verify SMTP, login VNPT, ping Cloudinary)
- Secret field hiển thị `••••••••` để không lộ giá trị cũ — nhập rỗng = giữ nguyên
- Tag xanh "Đã cấu hình X/Y" hiện trạng thái mỗi nhóm

**API**:

```http
GET   /api/integrations                    # toàn bộ cấu hình (secrets đã che)
GET   /api/integrations/:category          # 1 nhóm: VNPT | CLOUDINARY | SMS | EMAIL
PUT   /api/integrations/:category          # cập nhật key/value (giá trị "••••••••" sẽ bị bỏ qua)
POST  /api/integrations/:category/test     # thử kết nối — body tùy provider
```

**Các nhóm hỗ trợ**:

| Category     | Keys                                                                                                        | Provider hỗ trợ                  |
| ------------ | ----------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `VNPT`       | `VNPT_EINVOICE_URL`, `VNPT_USERNAME`, `VNPT_PASSWORD`, `VNPT_COM_CODE`, `VNPT_TEMPLATE_CODE`, `VNPT_SERIAL` | VNPT E-Invoice (mock fallback)   |
| `CLOUDINARY` | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`                                      | Cloudinary                       |
| `SMS`        | `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_API_SECRET`, `SMS_BRAND_NAME`                                           | ESMS, Twilio, LOG (dev)          |
| `EMAIL`      | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`                              | bất kỳ SMTP (Gmail, SendGrid, …) |

**Cấu hình mã hóa** (`.env`):

```env
ENCRYPTION_KEY=chuoi_ngau_nhien_dai_>=_32_ky_tu
```

> Nếu để trống, hệ thống tự derive key từ `JWT_SECRET` (chỉ dùng cho dev — production phải set riêng).

**Quy tắc đọc giá trị** (xem [integration-config.service.js](src/modules/integrations/integration-config.service.js)):

1. Đọc từ DB → giải mã nếu là secret
2. Fallback sang `process.env[KEY]` nếu DB trống
3. Cache in-memory TTL 60s, invalidate khi `set()`

**Provider SMS hỗ trợ** (xem [sms.js](src/utils/sms.js)):

- **ESMS** (`rest.esms.vn`): brandname SMS Việt Nam
- **Twilio**: SMS quốc tế
- **LOG** (mặc định khi chưa cấu hình): chỉ ghi log để dev

---

### 🍜 15. F&B — Chế độ nhà hàng / Cafe / Fast-food / Bar

**Mục đích**: chuyển ERP từ chế độ bán lẻ thuần (retail) sang F&B với sơ đồ bàn, order tại bàn, KDS, QR ordering, thanh toán đa kênh.

#### Chọn loại hình kinh doanh (Business Vertical)

Hệ thống hỗ trợ **13 loại hình** — 4 loại F&B và 9 loại retail. Khi chọn F&B, sidebar tự động hiện thêm menu F&B (Sơ đồ bàn, KDS, Đơn đa kênh, AI Dự báo). Retail thì ẩn các menu này.

| Key | Label | Loại | Menu F&B? |
|---|---|---|---|
| `cafe` | Quán Cafe / Đồ uống | F&B | ✅ |
| `nha_hang` | Quán ăn / Nhà hàng | F&B | ✅ |
| `do_an_nhanh` | Đồ ăn nhanh / Fast-food | F&B | ✅ |
| `bar_pub` | Bar / Pub / Quán nước | F&B | ✅ |
| `quan_ao` | Quần áo / Thời trang | Retail | ❌ |
| `tap_hoa` | Tạp hóa / Siêu thị mini | Retail | ❌ |
| `dien_thoai` | Điện thoại / Điện tử | Retail | ❌ |
| `my_pham` | Mỹ phẩm / Spa | Retail | ❌ |
| `noi_that` | Nội thất / Đồ gia dụng | Retail | ❌ |
| `van_phong_pham` | Văn phòng phẩm / Sách | Retail | ❌ |
| `thuc_pham` | Thực phẩm sạch | Retail | ❌ |
| `qua_tang` | Quà tặng / Lưu niệm | Retail | ❌ |
| `dich_vu` | Dịch vụ / Khác | Retail | ❌ |

#### Cách chuyển loại hình

**Cách 1 — qua Onboarding Wizard** (cho tenant mới):
1. Đăng nhập → vào `/onboarding`
2. Bước 1: chọn card loại hình (vd: "Quán Cafe / Đồ uống")
3. Hệ thống tự seed danh mục + sản phẩm mẫu theo loại hình
4. Sidebar re-render ngay → hiện menu F&B

**Cách 2 — qua API** (đổi loại hình sau khi đã setup):
```http
PUT /api/settings/business-template
Authorization: Bearer <token>
Content-Type: application/json

{ "template": "cafe" }
```

**Cách 3 — qua UI Settings** (nếu có trang settings):
Vào `/settings` → chọn business template → save.

> Sau khi đổi, reload trang để Sidebar fetch lại `businessTemplate` từ `/api/settings`.

#### Tính năng F&B (chỉ hiện khi chọn vertical F&B)

| Tính năng | Route | Mô tả |
|---|---|---|
| **Sơ đồ bàn (Floor)** | `/floor` | Quản lý khu vực (Area) + bàn (DinerTable) — mở/đóng/ghép/tách bàn, chuyển bàn |
| **Màn hình bếp (KDS)** | `/kds` | Full-screen dark mode — bump/recall/void món, highlight stale ticket (>15ph) |
| **Đơn đa kênh** | `/order-inbox` | Inbox đơn từ GrabFood/ShopeeFood/BeFood — accept/reject |
| **AI Dự báo** | `/ai-forecast` | Dự báo nhu cầu theo giờ, menu engineering (stars/dogs), dynamic pricing |

#### API F&B

```http
# Menu (modifier/variant/combo/happy-hour)
GET    /api/menu/modifier-groups
POST   /api/menu/modifier-groups
GET    /api/menu/combos
POST   /api/menu/combos

# Tables
GET    /api/tables/areas
POST   /api/tables/areas
GET    /api/tables
POST   /api/tables
POST   /api/tables/:id/open          # mở bàn (tạo TableSession)
POST   /api/tables/:id/transfer      # chuyển bàn
POST   /api/tables/split             # tách bàn
POST   /api/tables/merge             # gộp bàn

# KDS
GET    /api/kds/stations
POST   /api/kds/stations
POST   /api/kds/tickets/:id/bump     # hoàn thành món
POST   /api/kds/tickets/:id/recall   # gọi lại
POST   /api/kds/tickets/:id/void     # hủy món

# QR Ordering (public, không auth)
GET    /api/qr-ordering/menu/:qrToken      # khách quét QR → xem menu
POST   /api/qr-ordering/order/:qrToken     # khách đặt món
GET    /api/qr-ordering/order/:publicToken # theo dõi trạng thái
POST   /api/qr-ordering/order/:publicToken/call-waiter
POST   /api/qr-ordering/feedback/:publicToken

# Payment Gateway
POST   /api/payment-gateway/create          # tạo QR/link (Momo/VNPay/ZaloPay)
POST   /api/payment-gateway/webhooks/momo   # webhook (verify HMAC)
POST   /api/payment-gateway/webhooks/vnpay
POST   /api/payment-gateway/webhooks/zalopay

# Recipe / COGS
GET    /api/recipes
POST   /api/recipes                        # định nghĩa nguyên liệu + định mức

# Stamp Card (loyalty F&B)
GET    /api/stamp-cards/templates
POST   /api/stamp-cards/templates
POST   /api/stamp-cards/earn               # tích stamp
POST   /api/stamp-cards/redeem             # đổi stamp

# AI Forecast
GET    /api/ai-forecast/demand             # dự báo theo giờ
GET    /api/ai-forecast/menu-engineering   # stars/dogs
GET    /api/ai-forecast/recommendations    # đề xuất (human-gate)
POST   /api/ai-forecast/recommendations/:id/approve

# Petty Cash (chế độ HKD)
GET    /api/petty-cash
POST   /api/petty-cash
```

#### Order F&B fields

Khi tạo Order F&B, thêm các field:

```json
{
  "orderType": "DINE_IN",        // DINE_IN | TAKEAWAY | DELIVERY | QR_SELF
  "tableId": "uuid",
  "tableSessionId": "uuid",
  "seatNumber": 4,
  "serviceChargePercent": 5,
  "tipAmount": 20000,
  "splitMode": "ITEM",           // ITEM | EVEN | CUSTOM
  "channel": "POS",              // POS | QR | GRABFOOD | SHAPEFOOD | BEFOOD
  "items": [
    {
      "productId": "uuid",
      "quantity": 2,
      "courseId": 1,             // lượt món (1 = món 1, 2 = món 2)
      "modifiers": [
        { "groupId": "uuid", "optionIds": ["uuid"] }
      ]
    }
  ]
}
```

#### Luồng F&B tiêu biểu

**Dine-in tại bàn:**
1. Mở bàn: `/api/tables/:id/open` → tạo TableSession
2. Order: `POST /api/orders` với `orderType: DINE_IN`, `tableId`, `tableSessionId`
3. Order CONFIRMED → tự động tạo KDS ticket cho từng station
4. Bếp bump: `POST /api/kds/tickets/:id/bump`
5. Thanh toán: `POST /api/payment-gateway/create` (QR Momo/VNPay) hoặc cash
6. Split bill: `POST /api/orders/:id/bill-split` (ITEM/EVEN/CUSTOM)
7. Đóng bàn: `/api/tables/:id/clear`

**QR self-ordering:**
1. Khách quét QR tại bàn → `GET /api/qr-ordering/menu/:qrToken`
2. Khách đặt món → `POST /api/qr-ordering/order/:qrToken` (Zod validated)
3. Theo dõi → `GET /api/qr-ordering/order/:publicToken`
4. Gọi nhân viên → `POST /api/qr-ordering/order/:publicToken/call-waiter`

---

## 🧪 Quy trình test nhanh các tính năng mới

```bash
# 1. Khởi động lại sau khi pull code mới
npm install
npm run db:migrate:deploy   # áp dụng các migration
npm run dev

# 2. Đăng nhập super_omega_ultra_admin@gmail.com / 123456, test:
#    - /admin → xem danh sách tenant + thống kê
#    - /admin/plans → tạo/sửa gói dịch vụ
#    - /admin/subscriptions → gán gói cho tenant
#    - /admin/invoices → tạo hóa đơn + đánh dấu đã thanh toán
#    - Nhấn "Hỗ trợ" để impersonate ADMIN của tenant
# 3. Đăng nhập admin@candory.com / 123456, sau đó test theo thứ tự:
#    - Cài VNPT mock → /einvoice → phát hành 1 HĐ từ Order
#    - /tax-reports → chọn tháng có Invoice → xuất XML 01/GTGT
#    - /fixed-assets → tạo category + asset → chạy depreciation manual
#    - /bank-reco → upload sao kê VCB mẫu → auto-match
#    - /currency → thêm USD + tỷ giá
#    - /marketplace → tạo shop mock → push inventory
#    - /report-builder → chọn Order → run thử
#    - /workflows → tạo rule EXPENSE_ABOVE 1tr → tạo expense 2tr → check tab Cần duyệt
#    - /production → BOM đa cấp → tạo WO → start → complete (kèm QC)
#    - /integrations → tab SMTP → điền Gmail App Password → Test → kiểm tra inbox
# 4. Test F&B (chuyển sang vertical F&B):
#    - PUT /api/settings/business-template { "template": "cafe" }  (hoặc qua /onboarding)
#    - Reload trang → sidebar hiện thêm group "F&B"
#    - /floor → tạo area + bàn → mở bàn → order DINE_IN
#    - /kds → xem ticket tự tạo → bump món
#    - /qr-ordering → quét QR bàn → đặt món (public, không cần login)
#    - /order-inbox → test nhận đơn GrabFood mock
#    - /ai-forecast → xem dự báo + menu engineering
```

---

> **Lịch sử thay đổi, báo cáo bảo mật và các phase phát triển**: xem [CHANGELOG.md](./CHANGELOG.md).

_Tài liệu cập nhật: 2026-09-27_
