# Aduu

Tổng quan: **Aduu** là hệ thống ERP đa module cho doanh nghiệp bán lẻ + dịch vụ + sản xuất nhỏ và vừa. Backend Node.js + Express + Prisma + PostgreSQL, frontend React + Vite + Ant Design. Mục tiêu: quản lý sản phẩm, kho, đơn hàng, khách hàng, kế toán, nhân sự, marketing/CRM, dự án, sản xuất và báo cáo trong cùng 1 hệ thống.

**Kiến trúc & Stack**

- Backend: Node.js, Express, Prisma 7 (PostgreSQL), Zod, bcrypt, JWT, Socket.IO, node-cron, Winston, Sentry
- Frontend: React 19, Vite, Ant Design 6, Zustand, Axios, React Router 7
- Storage: Cloudinary (ảnh sản phẩm)
- Docs: Swagger (mở tại `/api-docs`)
- Test: Jest
- Deploy: Dockerfile (Railway auto deploy + migrate)

**Tính năng chính**

- Xác thực: JWT + refresh token, role-based (SUPER_ADMIN / ADMIN / MANAGER / CASHIER / WAREHOUSE)
- Quản lý sản phẩm & danh mục, upload ảnh Cloudinary
- Quản lý đa kho, tồn kho, giao dịch kho, chuyển kho, kiểm kê
- Quản lý đơn hàng + hóa đơn PDF, POS quét barcode
- Trả hàng + hoàn tiền, thanh toán (cash/card/transfer/momo)
- Khách hàng 360°, phân khúc (rule-based), tags, notes, nhiệm vụ CSKH
- Marketing: chiến dịch Email + Zalo OA, tracking delivery
- Loyalty: tích điểm, hạng thành viên (BRONZE/SILVER/GOLD/PLATINUM)
- Khuyến mãi: engine tính giảm giá (%, fixed, buy X get Y)
- Giao hàng: tích hợp GHTK / GHN / VNPOST / Viettel / J&T
- Nhân sự: nhân viên, chấm công 3 ca, payroll, vi phạm, khóa kỳ lương
- Kế toán: double-entry, Chart of Accounts, autopost, kỳ kế toán, P&L / Balance Sheet / Cash Flow
- Công nợ phải thu/phải trả, chi phí (+ định kỳ), thuế, nhà cung cấp, đơn mua hàng
- Quản lý dự án: dự án, công việc, thành viên, tiến độ
- Quản lý sản xuất: BOM, lệnh sản xuất, tự cập nhật kho khi hoàn thành
- Báo cáo & Dashboard, Analytics (xu hướng, RFM khách hàng)
- Audit log: ghi lịch sử thao tác đầy đủ (ai, làm gì, lúc nào, before/after)
- Thông báo real-time (Socket.IO + Redis adapter)
- AI Assistant chatbot hỗ trợ tra cứu nghiệp vụ
- Bulk import dữ liệu, onboarding wizard
- Cron jobs: hủy đơn quá hạn, nhắc công nợ, nhắc lương, nhắc đóng kỳ
- API docs (Swagger)

**Mô hình dữ liệu (tóm tắt)**

- User, Role enum, RefreshToken, Tenant
- Product, Category
- Warehouse, Inventory, InventoryTransaction, TransactionType enum, StockTransfer, StockTransferItem, CycleCount, CycleCountItem
- Order, OrderItem, OrderStatus, PaymentMethod, PaymentStatus, Invoice
- Return, ExchangeItem
- Payment
- Customer, CustomerTier enum, CustomerNote, CustomerTag, CustomerTask
- CustomerSegment, SegmentMember
- Campaign, CampaignChannel, CampaignRecipient
- LoyaltyPoint, LoyaltyTier
- Promotion, PromotionType
- Delivery, DeliveryEvent, DeliveryCarrier
- Employee, Shift, Attendance, Payroll, Violation, PayrollLock
- Account (CoA), JournalEntry, JournalLine, FiscalPeriod, Expense, RecurringExpense, Tax, JournalPostingError
- Vendor, PurchaseOrder, PurchaseItem
- Debt, DebtPayment
- Project, ProjectTask, ProjectMember, ProjectStatus enum, ProjectMemberRole
- Bom, BomItem, WorkOrder, WorkOrderItem, BomStatus enum, WorkOrderStatus enum
- AuditLog
- Notification, NotificationType, NotificationSeverity
- BankAccount, BankTransaction

**Cấu trúc thư mục chi tiết**

```
erp-system/
│
│── .env                         # Biến môi trường (DB, JWT, Cloudinary, Redis, Sentry, ...)
│── .env.example                 # Mẫu biến môi trường
│── .gitignore                   # Danh sách file/thư mục không track bởi Git
│── docker-compose.yml           # Docker Compose — chạy PostgreSQL container
│── Dockerfile                   # Production image cho Railway (auto migrate + start)
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
│   ├── schema.prisma            # Định nghĩa toàn bộ mô hình dữ liệu (~50 models)
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
│       ├── 20260516120000_medium_priority_promo_return_expense/  # Thêm Promotion, Return, Expense
│       ├── 20260521120000_add_crm_notes_tags/                    # CRM Phase 1: Notes + Tags
│       ├── 20260521130000_add_crm_tasks/                         # CRM Phase 2: Customer tasks
│       ├── 20260521140000_add_crm_segments/                      # CRM Phase 3: Customer segments
│       ├── 20260521150000_add_crm_campaigns/                     # CRM Phase 4: Email + Zalo campaigns
│       ├── 20260522120000_add_project_management/                # Module Quản lý dự án
│       └── 20260522130000_add_production_management/             # Module Quản lý sản xuất (BOM + WO)
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
│   │   └── socket.js            # Socket.IO server — push thông báo real-time tới client (redis adapter)
│   │
│   ├── utils/                   # Hàm tiện ích dùng chung
│   │   ├── apiError.js          # Class ApiError — tạo lỗi HTTP chuẩn hóa (400, 401, 404, ...)
│   │   ├── logger.js            # Winston logger — ghi log ra console + file
│   │   ├── response.js          # Helper trả response (success, created, paginated, error)
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
│       ├── admin/                       # Super admin (đa tenant)
│       │   └── admin.routes.js          #   Routes: /api/admin — quản lý tenant, thống kê
│       │
│       ├── settings/                    # Cấu hình hệ thống & onboarding
│       │   ├── settings.routes.js       #   Routes: /api/settings — cấu hình công ty, onboarding
│       │   └── settings.service.js      #   Service: lưu/đọc cấu hình tenant
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
│       │   ├── inventory.service.js     #   Service: giao dịch kho (import/export/adjustment/return/reservation)
│       │   ├── inventory.service.test.js#   Unit test cho inventory service
│       │   ├── cyclecount.routes.js     #   Routes: /api/cycle-counts — kiểm kê định kỳ
│       │   └── cyclecount.service.js    #   Service: tạo phiên kiểm kê, đối chiếu, điều chỉnh chênh lệch
│       │
│       ├── warehouses/                  # Quản lý kho & chuyển kho
│       │   ├── warehouse.routes.js      #   Routes: CRUD /api/warehouses
│       │   ├── warehouse.service.js     #   Service: tạo/sửa kho, xem tồn kho theo kho
│       │   ├── stock-transfer.routes.js #   Routes: /api/stock-transfers — chuyển hàng giữa kho
│       │   └── stock-transfer.service.js#   Service: tạo phiếu chuyển, xác nhận nhận hàng
│       │
│       ├── orders/                      # Quản lý đơn hàng & hóa đơn
│       │   ├── order.routes.js          #   Routes: CRUD /api/orders
│       │   ├── order.service.js         #   Service: tạo đơn, cập nhật trạng thái, tính tổng tiền
│       │   ├── invoice.routes.js        #   Routes: /api/invoices — xuất hóa đơn
│       │   └── invoice.service.js       #   Service: sinh hóa đơn PDF, số tiền bằng chữ
│       │
│       ├── customers/                   # Quản lý khách hàng (Customer 360)
│       │   ├── customer.routes.js       #   Routes: CRUD /api/customers + lịch sử mua hàng
│       │   └── customer.service.js      #   Service: tạo/sửa khách hàng, gắn tag, segment
│       │
│       ├── crm/                         # CRM & Email Marketing (Phase 1-4)
│       │   ├── index.js                 #   Router aggregator: /api/crm/{tasks,segments,campaigns,notes,tags}
│       │   ├── notes.routes.js          #   Routes: ghi chú KH (NOTE/CALL/EMAIL/MEETING/ZALO)
│       │   ├── notes.service.js         #   Service: CRUD note theo customer
│       │   ├── tags.routes.js           #   Routes: tag KH có màu sắc
│       │   ├── tags.service.js          #   Service: tạo tag, gắn/gỡ tag cho KH
│       │   ├── tasks.routes.js          #   Routes: nhiệm vụ CSKH (PENDING/IN_PROGRESS/DONE)
│       │   ├── tasks.service.js         #   Service: tạo task, giao việc, nhắc quá hạn, cron remind
│       │   ├── segments.routes.js       #   Routes: phân khúc KH (rule-based)
│       │   ├── segments.service.js      #   Service: định nghĩa rule + tính lại membership
│       │   ├── campaigns.routes.js      #   Routes: chiến dịch Email/Zalo OA
│       │   └── campaigns.service.js     #   Service: tạo campaign, gửi recipient, tracking delivery
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
│       │   ├── debt.routes.js           #   Routes: /api/debts — phải thu + phải trả
│       │   └── debt.service.js          #   Service: tạo công nợ, thanh toán từng phần, nhắc quá hạn
│       │
│       ├── promotions/                  # Khuyến mãi
│       │   ├── promotion.routes.js      #   Routes: CRUD /api/promotions
│       │   ├── promotion.service.js     #   Service: tạo/sửa chương trình khuyến mãi
│       │   └── promotion.engine.js      #   Engine: tính toán giảm giá (%, fixed, buy X get Y, category, product)
│       │
│       ├── loyalty/                     # Khách hàng thân thiết
│       │   ├── loyalty.routes.js        #   Routes: /api/loyalty
│       │   └── loyalty.service.js       #   Service: tích điểm, đổi điểm, xếp hạng (BRONZE/SILVER/GOLD/PLATINUM)
│       │
│       ├── delivery/                    # Quản lý giao hàng
│       │   ├── delivery.routes.js       #   Routes: /api/deliveries — tích hợp GHTK/GHN/VNPOST/Viettel/J&T
│       │   └── delivery.service.js      #   Service: tạo phiếu giao, theo dõi event giao hàng real-time
│       │
│       ├── hr/                          # Nhân sự (HR)
│       │   ├── hr.routes.js             #   Routes: /api/hr — nhân viên, chấm công, lương, vi phạm
│       │   ├── hr.controller.js         #   Controller: xử lý request HR
│       │   ├── hr.service.js            #   Service: CRUD nhân viên, chấm công 3 ca, nghỉ phép
│       │   ├── hr.validation.js         #   Validation: Zod schema cho input HR
│       │   └── payroll.calc.js          #   Tính lương: lương cơ bản + phụ cấp ca + phạt + hệ số chấm công
│       │
│       ├── accounting/                  # Kế toán & Tài chính (double-entry)
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
│       ├── projects/                    # Quản lý dự án
│       │   ├── index.js                 #   Router aggregator: /api/projects + /assignable-users
│       │   ├── project.routes.js        #   Routes: CRUD project + /overview + /:id/stats
│       │   ├── project.service.js       #   Service: tạo/sửa dự án (auto add người tạo làm OWNER)
│       │   ├── task.routes.js           #   Routes: /api/projects/:id/tasks — công việc trong dự án
│       │   ├── task.service.js          #   Service: CRUD task, gán assignee, thông báo real-time
│       │   ├── member.routes.js         #   Routes: /api/projects/:id/members — thành viên
│       │   └── member.service.js        #   Service: thêm/sửa role (OWNER/MEMBER/VIEWER), kiểm soát OWNER cuối
│       │
│       ├── production/                  # Quản lý sản xuất (BOM + Work Orders)
│       │   ├── index.js                 #   Router aggregator: /api/production + /overview
│       │   ├── bom.routes.js            #   Routes: CRUD BOM + activate/deactivate
│       │   ├── bom.service.js           #   Service: định mức nguyên liệu, version, kiểm tra tự tham chiếu
│       │   ├── work-order.routes.js     #   Routes: CRUD WO + start/complete/cancel
│       │   └── work-order.service.js    #   Service: lifecycle WO, atomic update kho khi complete
│       │                                #   (trừ NL + cộng thành phẩm + tạo InventoryTransaction trong 1 transaction)
│       │
│       ├── reports/                     # Báo cáo tổng hợp
│       │   ├── report.routes.js         #   Routes: /api/reports
│       │   └── report.service.js        #   Service: xuất báo cáo doanh thu, sản phẩm, khách hàng (Excel)
│       │
│       ├── dashboard/                   # Dashboard tổng quan
│       │   └── dashboard.routes.js      #   Routes: /api/dashboard — KPI cho trang chủ
│       │
│       ├── analytics/                   # Phân tích dữ liệu
│       │   ├── analytics.routes.js      #   Routes: /api/analytics
│       │   └── analytics.service.js     #   Service: phân tích xu hướng, top sản phẩm, RFM khách hàng
│       │
│       ├── import/                      # Bulk import dữ liệu
│       │   └── import.routes.js         #   Routes: /api/import — import từ Excel/CSV
│       │
│       ├── audit/                       # Nhật ký hệ thống (Audit Trail)
│       │   ├── audit.routes.js          #   Routes: /api/audit
│       │   └── audit.service.js         #   Service: ghi log mọi thao tác (ai, làm gì, lúc nào, before/after)
│       │
│       ├── notifications/               # Thông báo
│       │   ├── notification.routes.js   #   Routes: /api/notifications
│       │   └── notification.service.js  #   Service: tạo/đọc thông báo, đếm chưa đọc, push real-time
│       │
│       └── ai/                          # AI Assistant
│           ├── ai.routes.js             #   Routes: /api/ai
│           └── ai.service.js            #   Service: chatbot AI hỗ trợ tra cứu nghiệp vụ ERP (OpenAI)
│
└── frontend/                    # ===== FRONTEND (React + Vite + Ant Design) =====
    ├── index.html               # HTML entry point
    ├── vite.config.js           # Cấu hình Vite (proxy API, port dev server, PWA)
    ├── package.json             # Dependencies & scripts frontend
    ├── eslint.config.js         # Cấu hình ESLint
    ├── .env                     # Biến môi trường frontend (VITE_API_URL, ...)
    ├── .env.example             # Mẫu biến môi trường frontend
    │
    └── src/
        ├── main.jsx             # Entry point React — mount App vào DOM
        ├── App.jsx              # Root component — định nghĩa routes (React Router) + RequireRole
        ├── index.css            # CSS reset / global styles
        │
        ├── api/                         # Gọi API backend
        │   ├── axios.js                 #   Axios instance: base URL, interceptor JWT auto-refresh
        │   ├── accounting.js            #   API kế toán: sổ cái, bút toán, báo cáo tài chính
        │   ├── debts.js                 #   API công nợ: danh sách, thanh toán, nhắc nợ
        │   └── notifications.js         #   API thông báo: đọc, đếm chưa đọc
        │
        ├── stores/                      # Zustand — quản lý state toàn cục
        │   └── authStore.js             #   State đăng nhập: user, token, theme, login(), logout()
        │
        ├── hooks/                       # Custom React hooks
        │   ├── useDebounce.js           #   Debounce input (mặc định 300ms cho search)
        │   ├── useBarcodeScanner.js     #   Hook quét mã vạch qua camera/scanner cho POS
        │   └── useTour.js               #   Hook product tour (Joyride)
        │
        ├── config/                      # Cấu hình client
        │   └── tourSteps.js             #   Định nghĩa các bước tour cho từng trang
        │
        ├── locales/                     # i18n translations
        │   ├── vi.json                  #   Tiếng Việt
        │   └── en.json                  #   English
        │
        ├── assets/                      # Tài nguyên tĩnh
        │   ├── hero.png                 #   Ảnh trang chủ / banner
        │   ├── react.svg                #   Logo React
        │   └── vite.svg                 #   Logo Vite
        │
        ├── styles/                      # CSS tùy chỉnh
        │   ├── variable.css             #   CSS variables (màu sắc, font, spacing, dark mode)
        │   ├── global.css               #   Style toàn cục (reset, typography, scrollbar)
        │   ├── layout.css               #   Style cho layout (sidebar, topbar, content)
        │   └── pages.css                #   Style riêng cho từng trang (table, modal, form)
        │
        ├── components/                  # React components dùng chung
        │   ├── ProtectedRoute.jsx       #   HOC bảo vệ route — kiểm tra đăng nhập
        │   ├── RequireRole.jsx          #   HOC kiểm tra role, redirect /403 nếu không đủ quyền
        │   ├── Receipt.jsx              #   Component in hóa đơn / phiếu thu
        │   ├── CameraScanner.jsx        #   Quét barcode/QR qua camera (POS)
        │   ├── ERPAssistantWidget.jsx   #   Widget chatbot AI — hỏi đáp nghiệp vụ ERP
        │   ├── TransferQrCode.jsx       #   Sinh QR code cho phiếu chuyển kho
        │   │
        │   ├── layout/                  #   Bố cục chung của ứng dụng
        │   │   ├── AppShell.jsx         #     Khung app chính (sidebar + topbar + content area)
        │   │   ├── Sidebar.jsx          #     Menu điều hướng bên trái (group + lọc theo role)
        │   │   ├── TopBar.jsx           #     Thanh trên: thông báo, user info, logout, theme toggle
        │   │   └── PageHeader.jsx       #     Header trang: tiêu đề, subtitle, nút hành động
        │   │
        │   └── shared/                  #   Component UI tái sử dụng
        │       ├── StatCard.jsx         #     Thẻ thống kê KPI (icon + giá trị + trend)
        │       ├── StatusTag.jsx        #     Tag trạng thái có màu (PENDING, COMPLETED, ...)
        │       ├── MoneyDisplay.jsx     #     Hiển thị số tiền định dạng VNĐ
        │       ├── EmptyState.jsx       #     Placeholder khi không có dữ liệu (+ CTA)
        │       ├── ErrorState.jsx       #     Placeholder khi lỗi tải dữ liệu
        │       └── TableSkeleton.jsx    #     Skeleton loader cho table
        │
        └── pages/                       # Các trang chính của ứng dụng
            ├── Login.jsx                #   Trang đăng nhập
            ├── Register.jsx             #   Trang đăng ký tài khoản mới
            ├── Forbidden.jsx            #   Trang 403 — không đủ quyền
            ├── Onboarding.jsx           #   Wizard onboarding cho tenant mới
            ├── Pricing.jsx              #   Trang bảng giá gói dịch vụ
            ├── Dashboard.jsx            #   Trang chủ — tổng quan doanh thu, đơn hàng, biểu đồ
            ├── Products.jsx             #   Danh sách sản phẩm — tìm kiếm, lọc, phân trang
            ├── ProductEdit.jsx          #   Tạo mới / chỉnh sửa sản phẩm
            ├── Orders.jsx               #   Danh sách đơn hàng — trạng thái, lọc theo ngày
            ├── Pos.jsx                  #   Màn hình bán hàng (POS) — quét barcode, thanh toán
            ├── Returns.jsx              #   Quản lý trả hàng — tạo phiếu trả, hoàn tiền
            ├── Customers.jsx            #   Quản lý khách hàng — thông tin, lịch sử mua
            ├── CustomerDetail.jsx       #   Chi tiết KH 360° — tabs: thông tin, đơn hàng, notes, tasks
            ├── Tasks.jsx                #   Nhiệm vụ CSKH — kanban + filter
            ├── Segments.jsx             #   Phân khúc KH — định nghĩa rule, xem membership
            ├── Campaigns.jsx            #   Chiến dịch marketing — Email + Zalo OA
            ├── CampaignDetail.jsx       #   Chi tiết campaign — recipients + delivery tracking
            ├── Inventory.jsx            #   Quản lý tồn kho — nhập/xuất, lịch sử giao dịch
            ├── CycleCount.jsx           #   Kiểm kê hàng hóa — tạo phiên, đối chiếu
            ├── Debts.jsx                #   Quản lý công nợ — theo dõi, thanh toán từng phần
            ├── Vendors.jsx              #   Quản lý nhà cung cấp
            ├── PurchaseOrders.jsx       #   Danh sách đơn mua hàng (PO)
            ├── PurchaseOrderNew.jsx     #   Tạo đơn mua hàng mới
            ├── PurchaseOrderDetail.jsx  #   Chi tiết đơn mua hàng
            ├── Finance.jsx              #   Tổng quan tài chính — doanh thu, chi phí, lợi nhuận
            ├── Expenses.jsx             #   Quản lý chi phí hoạt động (+ định kỳ)
            ├── Journal.jsx              #   Sổ nhật ký kế toán — xem bút toán
            ├── FinancialReports.jsx     #   Báo cáo tài chính (P&L, Balance Sheet, Cash Flow)
            ├── Reports.jsx              #   Báo cáo tổng hợp — doanh thu, sản phẩm bán chạy
            ├── Analytics.jsx            #   Phân tích dữ liệu — biểu đồ xu hướng, RFM
            ├── Users.jsx                #   Quản lý tài khoản người dùng & phân quyền
            ├── Audit.jsx                #   Xem nhật ký thao tác hệ thống
            ├── NotificationsPage.jsx    #   Danh sách thông báo
            ├── Import.jsx               #   Bulk import dữ liệu (Excel/CSV)
            │
            ├── hr/                      #   Module Nhân sự
            │   ├── HR.jsx               #     Layout chung cho HR (tabs điều hướng)
            │   ├── EmployeeList.jsx     #     Danh sách nhân viên — thêm, sửa, nghỉ việc
            │   ├── Attendance.jsx       #     Chấm công — check-in/out, thống kê
            │   └── Payroll.jsx          #     Bảng lương — tính lương, phụ cấp, khấu trừ
            │
            ├── projects/                #   Module Quản lý dự án
            │   ├── Projects.jsx         #     Danh sách dự án + 4 stat cards (Tổng/Đang chạy/Hoàn thành/Quá hạn)
            │   └── ProjectDetail.jsx    #     Chi tiết — 3 tabs: Tổng quan / Công việc / Thành viên
            │
            ├── production/              #   Module Quản lý sản xuất
            │   ├── Production.jsx       #     Dashboard + 2 tabs (BOMs / Work Orders) + 4 stat cards
            │   └── WorkOrderDetail.jsx  #     Chi tiết WO — Start/Complete/Cancel + bảng nguyên liệu
            │
            ├── onboarding/              #   Các bước onboarding cho tenant mới
            │   ├── CompanyInfoStep.jsx  #     Bước 1: thông tin công ty
            │   ├── CategoryStep.jsx     #     Bước 2: tạo danh mục sản phẩm
            │   ├── WarehouseStep.jsx    #     Bước 3: tạo kho hàng
            │   ├── StaffStep.jsx        #     Bước 4: thêm nhân viên
            │   └── PaymentStep.jsx      #     Bước 5: cấu hình thanh toán
            │
            └── admin/                   #   Khu vực Super Admin (đa tenant)
                └── SuperAdminDashboard.jsx  # Dashboard quản lý các tenant, thống kê tổng
```

---

## 🚀 HƯỚNG DẪN CHẠY DỰ ÁN (Tutorial chi tiết)

> Phần này hướng dẫn từ A → Z cách chạy dự án trên máy local. Làm đúng theo thứ tự là chạy được.

### Bước 0 — Yêu cầu cài đặt sẵn

| Phần mềm | Phiên bản tối thiểu | Ghi chú |
|---|---|---|
| **Node.js** | 20 LTS hoặc 22 LTS | Project hiện chưa khoá engine, nhưng nên tránh Node 25 (Prisma Studio cảnh báo). |
| **npm** | 10+ | Đi kèm Node.js. |
| **Docker Desktop** | mới nhất | Dùng cho PostgreSQL + Redis (khuyến nghị). |
| **Git** | bất kỳ | Để clone repo. |

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
PORT=3000
NODE_ENV=development
DATABASE_URL="postgresql://postgres:uit@localhost:5432/erp_db?schema=public"
JWT_SECRET=hay_doi_thanh_chuoi_ngau_nhien_dai_32_ky_tu_tro_len
JWT_EXPIRES_IN=7d

# --- CORS / Frontend ---
CORS_ORIGIN=http://localhost:5173
CLIENT_URL=http://localhost:5173

# --- Redis (cho Socket.IO real-time) ---
# Nếu không có Redis, code sẽ fallback sang in-memory nhưng log sẽ spam ECONNREFUSED.
REDIS_URL=redis://127.0.0.1:6379

# --- Bcrypt ---
BCRYPT_ROUNDS=10

# --- Tuỳ chọn: Cloudinary (chỉ cần khi upload ảnh sản phẩm) ---
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# --- Tuỳ chọn: OpenAI (chỉ cần khi dùng AI Assistant) ---
OPENAI_API_KEY=

# --- Tuỳ chọn: Sentry (monitoring) ---
SENTRY_DSN=
```

> ⚠️ Lưu ý mật khẩu DB: `docker-compose.yml` mặc định dùng `postgres / uit / erp_db`. Nếu bạn sửa ở `docker-compose.yml` thì phải đồng bộ lại `DATABASE_URL` trong `.env`.

Tương tự, tạo `.env` cho frontend:

```bash
cd frontend
Copy-Item .env.example .env   # hoặc cp .env.example .env
cd ..
```

Mặc định frontend trỏ tới `http://localhost:3000` qua biến `VITE_API_URL` — chỉnh nếu backend đổi port.

---

### Bước 3 — Khởi động PostgreSQL + Redis bằng Docker

Cách đơn giản nhất là chạy cả 2 dịch vụ qua Docker. `docker-compose.yml` hiện có sẵn PostgreSQL; bạn có thể thêm Redis tạm thời bằng lệnh:

```bash
# 1. Khởi động PostgreSQL (theo docker-compose.yml)
docker-compose up -d

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
# Tạo schema trong DB (chạy migration của Prisma)
npm run db:migrate

# Tạo dữ liệu mẫu: admin + sản phẩm + đơn hàng + kế toán demo
npm run db:seed
```

Sau bước này DB đã có:

- Tài khoản admin: **`admin@erp.com` / `admin123`**
- Một số sản phẩm, danh mục, kho, khách hàng mẫu
- Chart of Accounts (hệ thống tài khoản kế toán)
- Bút toán demo

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
[server] listening on http://localhost:3000
[socket] redis adapter attached
```

Kiểm tra:

- API health: <http://localhost:3000/api/health> (nếu có) hoặc gọi thử `POST /api/auth/login`
- Swagger UI: <http://localhost:3000/api-docs>

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

- **Email**: `admin@erp.com`
- **Mật khẩu**: `admin123`

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
|---|---|
| `Cannot find module '@socket.io/redis-adapter'` | Thiếu deps. Chạy lại `npm install`. Nếu vẫn lỗi: `npm install @socket.io/redis-adapter ioredis`. |
| `connect ECONNREFUSED 127.0.0.1:6379` (spam liên tục) | Chưa chạy Redis. Khởi động lại: `docker start erp-redis` hoặc tạo mới như Bước 3. App vẫn chạy được nhưng real-time bị giới hạn 1 instance. |
| `P1001: Can't reach database server at localhost:5432` | Postgres chưa chạy hoặc sai `DATABASE_URL`. Chạy `docker-compose up -d` và kiểm tra user/pass trong `.env` khớp với `docker-compose.yml`. |
| `Error: P3009: migrate found failed migrations` | Migration cũ bị lỗi. Với DB rỗng: `npx prisma migrate reset` (sẽ xoá sạch DB rồi migrate + seed lại). |
| Login trả `401 Unauthorized` ngay sau seed | `JWT_SECRET` rỗng hoặc khác giữa các lần restart. Đặt một chuỗi cố định trong `.env`. |
| Frontend báo `Network Error` / CORS | Kiểm tra `CORS_ORIGIN` trong `.env` backend và `VITE_API_URL` trong `frontend/.env`. Đảm bảo backend đang chạy trước khi mở frontend. |
| Port 3000 / 5173 đã bị chiếm | Đổi `PORT` trong `.env` hoặc đóng tiến trình đang chiếm port (`netstat -ano | findstr :3000` trên Windows). |
| Prisma Studio cảnh báo Node 25 | Hạ Node về 20 LTS hoặc 22 LTS (dùng `nvm` để chuyển nhanh). |

---

## 📋 Tóm tắt lệnh hay dùng

```bash
# Backend (chạy ở root)
npm install                 # cài deps
npm run dev                 # chạy dev server (nodemon)
npm start                   # chạy production
npm run db:migrate          # tạo/cập nhật schema DB
npm run db:seed             # nạp dữ liệu mẫu
npm run db:studio           # mở Prisma Studio (GUI cho DB)
npm test                    # chạy Jest

# Frontend (chạy trong thư mục frontend/)
npm install
npm run dev                 # vite dev server (port 5173)
npm run build               # build production
npm run preview             # preview bản build

# Docker hạ tầng
docker-compose up -d        # khởi động Postgres
docker-compose down         # dừng & giữ data
docker-compose down -v      # dừng & XOÁ data (cẩn thận!)
docker start erp-redis      # khởi động lại Redis
```

---

## 🔐 Phân quyền (Role)

| Role | Phạm vi |
|------|---------|
| **SUPER_ADMIN** | Toàn quyền hệ thống + admin dashboard đa tenant |
| **ADMIN** | Toàn quyền trong tenant — quản lý users, kế toán, audit |
| **MANAGER** | Hầu hết module trừ Users, Audit, Journal |
| **CASHIER** | POS, Orders, Products, Customers, CRM tasks |
| **WAREHOUSE** | Inventory, Cycle count, Stock transfer, BOM/Work Orders |

---

## 🌐 API endpoints cơ bản

```
/api/auth                         # login, refresh, logout
/api/users                        # user CRUD
/api/products                     # sản phẩm + upload Cloudinary
/api/categories                   # danh mục
/api/inventory                    # tồn kho + transactions
/api/cycle-counts                 # kiểm kê
/api/warehouses                   # đa kho
/api/stock-transfers              # chuyển kho
/api/orders                       # đơn hàng
/api/invoices                     # hóa đơn PDF
/api/returns                      # trả hàng
/api/payments                     # thanh toán
/api/customers                    # khách hàng
/api/crm/tasks                    # nhiệm vụ CSKH
/api/crm/notes                    # ghi chú KH
/api/crm/tags                     # tags
/api/crm/segments                 # phân khúc khách hàng
/api/crm/campaigns                # chiến dịch Email + Zalo OA
/api/loyalty                      # tích điểm
/api/promotions                   # khuyến mãi
/api/delivery                     # giao hàng
/api/hr                           # nhân sự + payroll
/api/accounting                   # bút toán + báo cáo TC
/api/purchase-orders              # đơn mua hàng
/api/debts                        # công nợ
/api/expenses                     # chi phí
/api/projects                     # quản lý dự án (+ tasks + members)
/api/production/boms              # BOM
/api/production/work-orders       # lệnh sản xuất
/api/reports                      # báo cáo
/api/dashboard                    # KPI cho trang chủ
/api/analytics                    # phân tích, RFM
/api/audit                        # activity trail
/api/notifications                # thông báo
/api/import                       # bulk import
/api/settings                     # cấu hình tenant
/api/admin                        # super admin (đa tenant)
/api/ai                           # AI Assistant
```

Chi tiết tham số từng endpoint: xem Swagger tại `/api-docs`.

---

## ⏰ Cron jobs & Real-time

**Cron** (`src/jobs/cron.js`):
- Mỗi giờ: hủy đơn `PENDING` quá 24h
- 09:00 hằng ngày: nhắc công nợ quá hạn, nhắc nhiệm vụ CSKH tới hạn
- 09:00 ngày 25 hằng tháng: nhắc tính lương
- 09:00 ngày 28 hằng tháng: nhắc đóng kỳ kế toán

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

## 📝 Chú ý bảo mật & gợi ý

- **Không commit `.env`** — chỉ commit `.env.example`
- **`JWT_SECRET` ≥ 32 ký tự ngẫu nhiên**, không tái sử dụng giữa các môi trường
- Kiểm tra và bảo mật các khóa Cloudinary / OpenAI / Sentry trước khi deploy
- Khi đổi `schema.prisma`: chạy `npx prisma migrate dev --name <ten-mo-ta>` để tạo migration mới
- Cổng mặc định server trong code là `3000` — đồng bộ với `CORS_ORIGIN`, `VITE_API_URL` nếu thay đổi

---

_Tài liệu cập nhật: 2026-05-22 — hệ thống đã hoàn thiện cả 7 module: Bán hàng, Kho, Tài chính, HR, CRM/Marketing, Dự án, Sản xuất._
