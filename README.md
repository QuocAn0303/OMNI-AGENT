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

**Cấu trúc thư mục chi tiết**

```
erp-system/
│
│── .env                         # Biến môi trường (DB, JWT, Cloudinary, ...)
│── .env.example                 # Mẫu biến môi trường
│── .gitignore                   # Danh sách file/thư mục không track bởi Git
│── docker-compose.yml           # Docker Compose — chạy PostgreSQL container
│── package.json                 # Dependencies & scripts backend
│── jest.config.js               # Cấu hình Jest cho unit test
│── prisma.config.ts             # Cấu hình Prisma CLI
│── README.md                    # Tài liệu dự án (file này)
│
├── .github/
│   └── workflows/
│       └── ci.yml               # GitHub Actions — CI pipeline (lint, test, build)
│
├── .vscode/                     # Cấu hình VS Code (settings, extensions gợi ý)
│
├── docs/                        # Tài liệu thiết kế & kế hoạch phát triển
│   ├── deep-dive-plan.md        # Kế hoạch phát triển chuyên sâu các module
│   └── frontend-redesign.md     # Kế hoạch redesign giao diện frontend
│
├── logs/                        # File log runtime của server (tự sinh khi chạy)
│
├── uploads/                     # Thư mục lưu file upload tạm thời trên server
│
├── tests/                       # Unit tests (Jest)
│   ├── setup.js                 # Cấu hình chung cho toàn bộ test suite
│   ├── debt.service.test.js     # Test nghiệp vụ công nợ (tạo, thanh toán, quá hạn)
│   ├── hr.payroll.test.js       # Test tính lương nhân viên
│   ├── loyalty.service.test.js  # Test tích điểm khách hàng thân thiết
│   ├── promotion.engine.test.js # Test engine tính khuyến mãi
│   └── stock-transfer.service.test.js  # Test chuyển kho giữa các warehouse
│
├── prisma/                      # Prisma ORM — schema, migration, seeder
│   ├── schema.prisma            # Định nghĩa toàn bộ mô hình dữ liệu
│   ├── seed.js                  # Seeder chính — tạo admin (admin@erp.com / admin123)
│   ├── seed_accounting.js       # Seeder hệ thống tài khoản kế toán (Chart of Accounts)
│   ├── seed_accounting_demo.js  # Seeder dữ liệu demo bút toán, giao dịch kế toán
│   ├── seed_comprehensive.js    # Seeder toàn diện — tạo dữ liệu mẫu đầy đủ các module
│   ├── inspect_prices.js        # Script kiểm tra giá sản phẩm trong DB
│   ├── spread_orders.js         # Script phân bổ đơn hàng theo thời gian (test/demo)
│   └── migrations/              # Các file migration tự động sinh bởi Prisma
│       ├── 20260317153935_init/                                  # Migration khởi tạo ban đầu
│       ├── 20260326143504_them_is_active_cho_customer/           # Thêm field isActive cho Customer
│       ├── 20260414140610_them_refresh_token/                    # Thêm bảng RefreshToken
│       ├── 20260417091720_test_lan_1/                            # Migration test
│       ├── 20260419055509_add_hr_models/                         # Thêm bảng HR (Employee, Attendance, Payroll)
│       ├── 20260508010000_deep_dive_orders_inventory/            # Mở rộng Orders & Inventory
│       ├── 20260514180000_priority_high_debt_notifications/      # Thêm Debt & Notifications
│       ├── 20260516120000_low_priority_features/                 # Thêm tính năng ưu tiên thấp
│       └── 20260516120000_medium_priority_promo_return_expense/  # Thêm Promotion, Return, Expense
│
├── src/                         # ===== BACKEND (Node.js + Express) =====
│   ├── app.js                   # Entry point — khởi tạo Express, mount routes, Socket.IO, cron
│   │
│   ├── config/                  # Cấu hình hệ thống
│   │   ├── prisma.js            # Khởi tạo Prisma Client (kết nối PostgreSQL)
│   │   ├── swagger.js           # Cấu hình Swagger UI (API docs tại /api-docs)
│   │   └── cloudinary.config.js # Cấu hình Cloudinary (upload ảnh sản phẩm)
│   │
│   ├── middleware/              # Express middleware
│   │   ├── auth.middleware.js   # Xác thực JWT, kiểm tra role (ADMIN/MANAGER/CASHIER/WAREHOUSE)
│   │   └── error.middleware.js  # Bắt lỗi chung, trả response lỗi chuẩn hóa
│   │
│   ├── jobs/                    # Tác vụ chạy nền định kỳ (node-cron)
│   │   └── cron.js              # Hủy đơn PENDING >24h, nhắc công nợ quá hạn, nhắc lương, đóng kỳ
│   │
│   ├── realtime/                # WebSocket real-time
│   │   └── socket.js            # Socket.IO server — push thông báo real-time tới client
│   │
│   ├── utils/                   # Hàm tiện ích dùng chung
│   │   ├── apiError.js          # Class ApiError — tạo lỗi HTTP chuẩn hóa (400, 401, 404, ...)
│   │   ├── logger.js            # Winston logger — ghi log ra console + file
│   │   ├── response.js          # Helper trả response thành công chuẩn hóa
│   │   ├── vietnameseMoneyWords.js  # Chuyển số tiền thành chữ tiếng Việt (cho hóa đơn)
│   │   └── warehouse.helper.js  # Helper nghiệp vụ kho (tính tồn, kiểm tra stock)
│   │
│   └── modules/                 # ===== CÁC MODULE NGHIỆP VỤ =====
│       │
│       ├── auth/                        # Xác thực & phiên đăng nhập
│       │   ├── auth.routes.js           #   Routes: POST /login, /refresh, /logout
│       │   ├── auth.controller.js       #   Controller: xử lý request/response
│       │   ├── auth.service.js          #   Service: logic đăng nhập, tạo JWT, refresh token
│       │   └── auth.validation.js       #   Validation: Zod schema cho input login
│       │
│       ├── users/                       # Quản lý tài khoản người dùng
│       │   ├── user.routes.js           #   Routes: CRUD /api/users
│       │   └── user.service.js          #   Service: tạo/sửa/xóa user, phân quyền role
│       │
│       ├── products/                    # Quản lý sản phẩm
│       │   ├── product.routes.js        #   Routes: CRUD /api/products, upload ảnh
│       │   ├── product.service.js       #   Service: CRUD sản phẩm, tìm kiếm, upload Cloudinary
│       │   └── product.service.test.js  #   Unit test cho product service
│       │
│       ├── categories/                  # Quản lý danh mục sản phẩm
│       │   ├── category.routes.js       #   Routes: CRUD /api/categories
│       │   └── category.service.js      #   Service: tạo/sửa/xóa danh mục, cây danh mục
│       │
│       ├── inventory/                   # Quản lý tồn kho & kiểm kê
│       │   ├── inventory.routes.js      #   Routes: /api/inventory — nhập/xuất/điều chỉnh
│       │   ├── inventory.service.js     #   Service: giao dịch kho (import/export/adjustment/return)
│       │   ├── inventory.service.test.js#   Unit test cho inventory service
│       │   ├── cyclecount.routes.js     #   Routes: /api/cycle-counts — kiểm kê định kỳ
│       │   └── cyclecount.service.js    #   Service: tạo phiên kiểm kê, đối chiếu, điều chỉnh chênh lệch
│       │
│       ├── orders/                      # Quản lý đơn hàng & hóa đơn
│       │   ├── order.routes.js          #   Routes: CRUD /api/orders
│       │   ├── order.service.js         #   Service: tạo đơn, cập nhật trạng thái, tính tổng tiền
│       │   ├── invoice.routes.js        #   Routes: /api/invoices — xuất hóa đơn
│       │   └── invoice.service.js       #   Service: sinh hóa đơn PDF, số tiền bằng chữ
│       │
│       ├── customers/                   # Quản lý khách hàng
│       │   ├── customer.routes.js       #   Routes: CRUD /api/customers
│       │   └── customer.service.js      #   Service: tạo/sửa khách hàng, lịch sử mua hàng
│       │
│       ├── returns/                     # Xử lý trả hàng
│       │   ├── return.routes.js         #   Routes: /api/returns
│       │   └── return.service.js        #   Service: tạo phiếu trả, hoàn tiền, cập nhật tồn kho
│       │
│       ├── payments/                    # Quản lý thanh toán
│       │   ├── payment.routes.js        #   Routes: /api/payments
│       │   └── payment.service.js       #   Service: ghi nhận thanh toán (cash/card/transfer/momo)
│       │
│       ├── debt/                        # Quản lý công nợ
│       │   ├── debt.routes.js           #   Routes: /api/debts
│       │   └── debt.service.js          #   Service: tạo công nợ, thanh toán từng phần, nhắc quá hạn
│       │
│       ├── promotions/                  # Khuyến mãi
│       │   ├── promotion.routes.js      #   Routes: CRUD /api/promotions
│       │   ├── promotion.service.js     #   Service: tạo/sửa chương trình khuyến mãi
│       │   └── promotion.engine.js      #   Engine: tính toán giảm giá (%, fixed, buy X get Y)
│       │
│       ├── loyalty/                     # Khách hàng thân thiết
│       │   ├── loyalty.routes.js        #   Routes: /api/loyalty
│       │   └── loyalty.service.js       #   Service: tích điểm, đổi điểm, xếp hạng thành viên
│       │
│       ├── delivery/                    # Quản lý giao hàng
│       │   ├── delivery.routes.js       #   Routes: /api/deliveries
│       │   └── delivery.service.js      #   Service: tạo phiếu giao, theo dõi trạng thái giao hàng
│       │
│       ├── warehouses/                  # Quản lý kho & chuyển kho
│       │   ├── warehouse.routes.js      #   Routes: CRUD /api/warehouses
│       │   ├── warehouse.service.js     #   Service: tạo/sửa kho, xem tồn kho theo kho
│       │   ├── stock-transfer.routes.js #   Routes: /api/stock-transfers — chuyển hàng giữa kho
│       │   └── stock-transfer.service.js#   Service: tạo phiếu chuyển, xác nhận nhận hàng
│       │
│       ├── hr/                          # Nhân sự (HR)
│       │   ├── hr.routes.js             #   Routes: /api/hr — nhân viên, chấm công, lương
│       │   ├── hr.controller.js         #   Controller: xử lý request HR
│       │   ├── hr.service.js            #   Service: CRUD nhân viên, chấm công, nghỉ phép
│       │   ├── hr.validation.js         #   Validation: Zod schema cho input HR
│       │   └── payroll.calc.js          #   Tính lương: lương cơ bản, phụ cấp, khấu trừ, thuế TNCN
│       │
│       ├── accounting/                  # Kế toán & Tài chính
│       │   ├── accounting.routes.js     #   Routes: /api/accounting — sổ cái, bút toán, báo cáo
│       │   ├── account.service.js       #   Service: quản lý hệ thống tài khoản (Chart of Accounts)
│       │   ├── journal.service.js       #   Service: tạo bút toán (journal entry), ghi sổ nhật ký
│       │   ├── autopost.service.js      #   Service: tự động hạch toán khi phát sinh giao dịch
│       │   ├── fiscal-period.service.js #   Service: quản lý kỳ kế toán (mở/đóng kỳ)
│       │   ├── financial-report.service.js  # Service: báo cáo tài chính (P&L, Balance Sheet, Cash Flow)
│       │   ├── expense.service.js       #   Service: quản lý chi phí hoạt động
│       │   ├── expense-auto.service.js  #   Service: tự động ghi nhận chi phí định kỳ
│       │   ├── tax.service.js           #   Service: tính thuế VAT, thuế TNCN
│       │   ├── posting-error.service.js #   Service: xử lý lỗi hạch toán, retry
│       │   ├── founder-dashboard.service.js # Service: dashboard tổng quan cho chủ doanh nghiệp
│       │   ├── purchase-order.routes.js #   Routes: /api/purchase-orders — đơn mua hàng
│       │   ├── purchase.service.js      #   Service: tạo/duyệt đơn mua hàng từ nhà cung cấp
│       │   └── vendor.service.js        #   Service: quản lý nhà cung cấp
│       │
│       ├── reports/                     # Báo cáo tổng hợp
│       │   ├── report.routes.js         #   Routes: /api/reports
│       │   └── report.service.js        #   Service: xuất báo cáo doanh thu, sản phẩm, khách hàng
│       │
│       ├── dashboard/                   # Dashboard tổng quan
│       │   └── dashboard.routes.js      #   Routes: /api/dashboard — dữ liệu thống kê cho trang chủ
│       │
│       ├── analytics/                   # Phân tích dữ liệu
│       │   ├── analytics.routes.js      #   Routes: /api/analytics
│       │   └── analytics.service.js     #   Service: phân tích xu hướng, top sản phẩm, RFM khách hàng
│       │
│       ├── audit/                       # Nhật ký hệ thống (Audit Trail)
│       │   ├── audit.routes.js          #   Routes: /api/audit
│       │   └── audit.service.js         #   Service: ghi log mọi thao tác (ai, làm gì, lúc nào)
│       │
│       ├── notifications/               # Thông báo
│       │   ├── notification.routes.js   #   Routes: /api/notifications
│       │   └── notification.service.js  #   Service: tạo/đọc thông báo, đếm chưa đọc, push real-time
│       │
│       └── ai/                          # AI Assistant
│           ├── ai.routes.js             #   Routes: /api/ai
│           └── ai.service.js            #   Service: chatbot AI hỗ trợ tra cứu nghiệp vụ ERP
│
└── frontend/                    # ===== FRONTEND (React + Vite + Ant Design) =====
    ├── index.html               # HTML entry point
    ├── vite.config.js           # Cấu hình Vite (proxy API, port dev server)
    ├── package.json             # Dependencies & scripts frontend
    ├── eslint.config.js         # Cấu hình ESLint
    ├── .env                     # Biến môi trường frontend (VITE_API_URL, ...)
    ├── .env.example             # Mẫu biến môi trường frontend
    │
    └── src/
        ├── main.jsx             # Entry point React — mount App vào DOM
        ├── App.jsx              # Root component — định nghĩa routes (React Router)
        ├── index.css            # CSS reset / global styles
        │
        ├── api/                         # Gọi API backend
        │   ├── axios.js                 #   Axios instance: base URL, interceptor JWT auto-refresh
        │   ├── accounting.js            #   API kế toán: sổ cái, bút toán, báo cáo tài chính
        │   ├── debts.js                 #   API công nợ: danh sách, thanh toán, nhắc nợ
        │   └── notifications.js         #   API thông báo: đọc, đếm chưa đọc
        │
        ├── stores/                      # Zustand — quản lý state toàn cục
        │   └── authStore.js             #   State đăng nhập: user, token, login(), logout()
        │
        ├── hooks/                       # Custom React hooks
        │   └── useBarcodeScanner.js     #   Hook quét mã vạch qua camera/scanner cho POS
        │
        ├── assets/                      # Tài nguyên tĩnh
        │   ├── hero.png                 #   Ảnh trang chủ / banner
        │   ├── react.svg                #   Logo React
        │   └── vite.svg                 #   Logo Vite
        │
        ├── styles/                      # CSS tùy chỉnh
        │   ├── variable.css             #   CSS variables (màu sắc, font, spacing)
        │   ├── global.css               #   Style toàn cục (reset, typography)
        │   ├── layout.css               #   Style cho layout (sidebar, topbar, content)
        │   └── pages.css                #   Style riêng cho từng trang
        │
        ├── components/                  # React components dùng chung
        │   ├── ProtectedRoute.jsx       #   HOC bảo vệ route — kiểm tra đăng nhập & role
        │   ├── Receipt.jsx              #   Component in hóa đơn / phiếu thu
        │   ├── ERPAssistantWidget.jsx   #   Widget chatbot AI — hỏi đáp nghiệp vụ ERP
        │   ├── TransferQrCode.jsx       #   Sinh QR code cho phiếu chuyển kho
        │   │
        │   ├── layout/                  #   Bố cục chung của ứng dụng
        │   │   ├── AppShell.jsx         #     Khung app chính (sidebar + topbar + content area)
        │   │   ├── Sidebar.jsx          #     Menu điều hướng bên trái
        │   │   ├── TopBar.jsx           #     Thanh trên: thông báo, user info, logout
        │   │   └── PageHeader.jsx       #     Header trang: tiêu đề, breadcrumb, nút hành động
        │   │
        │   └── shared/                  #   Component UI tái sử dụng
        │       ├── StatCard.jsx         #     Thẻ thống kê (doanh thu, đơn hàng, ...)
        │       ├── StatusTag.jsx        #     Tag trạng thái có màu (PENDING, COMPLETED, ...)
        │       ├── MoneyDisplay.jsx     #     Hiển thị số tiền định dạng VNĐ
        │       └── EmptyState.jsx       #     Placeholder khi không có dữ liệu
        │
        └── pages/                       # Các trang chính của ứng dụng
            ├── Login.jsx                #   Trang đăng nhập
            ├── Dashboard.jsx            #   Trang chủ — tổng quan doanh thu, đơn hàng, biểu đồ
            ├── Products.jsx             #   Danh sách sản phẩm — tìm kiếm, lọc, phân trang
            ├── ProductEdit.jsx          #   Tạo mới / chỉnh sửa sản phẩm
            ├── Orders.jsx               #   Danh sách đơn hàng — trạng thái, lọc theo ngày
            ├── Pos.jsx                  #   Màn hình bán hàng (POS) — quét barcode, thanh toán
            ├── Inventory.jsx            #   Quản lý tồn kho — nhập/xuất, lịch sử giao dịch
            ├── CycleCount.jsx           #   Kiểm kê hàng hóa — tạo phiên, đối chiếu
            ├── Customers.jsx            #   Quản lý khách hàng — thông tin, lịch sử mua
            ├── Returns.jsx              #   Quản lý trả hàng — tạo phiếu trả, hoàn tiền
            ├── Debts.jsx                #   Quản lý công nợ — theo dõi, thanh toán từng phần
            ├── Vendors.jsx              #   Quản lý nhà cung cấp
            ├── PurchaseOrders.jsx       #   Danh sách đơn mua hàng (PO)
            ├── PurchaseOrderNew.jsx     #   Tạo đơn mua hàng mới
            ├── PurchaseOrderDetail.jsx  #   Chi tiết đơn mua hàng
            ├── Finance.jsx              #   Tổng quan tài chính — doanh thu, chi phí, lợi nhuận
            ├── Expenses.jsx             #   Quản lý chi phí hoạt động
            ├── Journal.jsx              #   Sổ nhật ký kế toán — xem bút toán
            ├── FinancialReports.jsx     #   Báo cáo tài chính (P&L, Balance Sheet, Cash Flow)
            ├── Reports.jsx              #   Báo cáo tổng hợp — doanh thu, sản phẩm bán chạy
            ├── Analytics.jsx            #   Phân tích dữ liệu — biểu đồ xu hướng, RFM
            ├── Users.jsx                #   Quản lý tài khoản người dùng & phân quyền
            ├── Audit.jsx                #   Xem nhật ký thao tác hệ thống
            ├── NotificationsPage.jsx    #   Danh sách thông báo
            │
            └── hr/                      #   Module Nhân sự
                ├── HR.jsx               #     Layout chung cho HR (tabs điều hướng)
                ├── EmployeeList.jsx     #     Danh sách nhân viên — thêm, sửa, nghỉ việc
                ├── Attendance.jsx       #     Chấm công — check-in/out, thống kê
                └── Payroll.jsx          #     Bảng lương — tính lương, phụ cấp, khấu trừ
```

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
