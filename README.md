# Aduu ERP

**Aduu ERP** — Hệ thống hoạch định nguồn lực doanh nghiệp **SaaS multi-tenant** cho doanh nghiệp bán lẻ + F&B + dịch vụ + sản xuất nhỏ và vừa, **tối ưu cho thị trường Việt Nam**. Backend Node.js + Express + Prisma 7 (133 models, 59 enums) + PostgreSQL, frontend React 19 + Vite + Ant Design 6. Mục tiêu: giúp chủ shop mới mở quản lý sản phẩm, kho, đơn hàng, khách hàng, kế toán, nhân sự một cách đơn giản — **không cần biết kế toán**.

**Kiến trúc & Stack**

- Backend: Node.js, Express, Prisma 7 (PostgreSQL, 133 models, 59 enums), Zod, JWT, Socket.IO + Redis, node-cron, Winston
- Frontend: React 19, Vite, Ant Design 6, Zustand, Axios, Recharts, React Router 7
- Storage: Cloudinary (ảnh sản phẩm)
- Auth: JWT access token + refresh token, role-based (7 roles), hỗ trợ impersonate session
- Docs: Swagger UI tại `/api-docs` (dev only)
- Test: Jest + setup mock Prisma
- Deploy: Docker multi-stage (Railway auto deploy + migrate), Docker Compose (PostgreSQL + Redis)

**Tính năng chính**

- **54 modules backend** — phủ toàn bộ nghiệp vụ doanh nghiệp VN
- Xác thực: JWT + refresh token, role-based (7 roles: SUPER_OMEGA_ULTRA_ADMIN / SUPER_ADMIN / ADMIN / MANAGER / **ACCOUNTANT** / CASHIER / WAREHOUSE)
- **Landing page công khai** tại `/`: hero, feature cards, steps, pricing preview
- **Onboarding Wizard thông minh**: 6 bước — chọn ngành (13 templates: quần áo, tạp hóa, cafe, điện thoại...), nhập thông tin shop, tạo kho, thêm danh mục, thêm nhân viên, chọn thanh toán. Tự động seed dữ liệu mẫu theo ngành
- **Chế độ Đơn giản (Beginner Mode)**: mặc định bật cho shop mới, chỉ hiện Trang chủ, Bán hàng, Đơn hàng, Sản phẩm, Tồn kho, Khách hàng. Có nút bật/tắt trong Sidebar
- Quản lý sản phẩm & danh mục, upload ảnh Cloudinary
- Quản lý đa kho, tồn kho, giao dịch kho, chuyển kho, kiểm kê
- Quản lý đơn hàng + hóa đơn PDF, **POS quét barcode + camera**, giao diện tối ưu mobile
- **In bill nhiệt Bluetooth**: ESC/POS qua Web Bluetooth API (K80/Xprinter/Epson)
- **Offline Mode (POS ngoại tuyến)**: IndexedDB queue, auto-sync khi online
- Trả hàng + hoàn tiền, thanh toán (cash/card/transfer/momo/QR)
- Khách hàng 360°, phân khúc (rule-based), notes, nhiệm vụ CSKH, tags màu sắc
- Marketing: chiến dịch Email + Zalo OA, tracking delivery
- Loyalty: tích điểm, hạng thành viên (BRONZE/SILVER/GOLD/PLATINUM), stamp card F&B
- Khuyến mãi: engine giảm giá (%, fixed, buy X get Y, category, product, free ship)
- Giao hàng: tích hợp GHTK / GHN / VNPOST / Viettel / J&T
- Nhân sự: nhân viên, chấm công 3 ca, payroll (+ PIT/BHXH), vi phạm, khóa kỳ lương, nghỉ phép + workflow
- Kế toán đầy đủ: double-entry, Chart of Accounts (~33 TK), autopost 12 sự kiện, sổ nhật ký chung, sổ cái (có TK đối ứng), sổ chi tiết theo đối tượng, bảng CĐSPS 6 cột, B01-DN, B02-DN, B03-DN, kết chuyển cuối kỳ, phân bổ 242, khấu hao TSCĐ, CIT tạm tính quý, định giá hàng tồn kho, kỳ kế toán, outbox retry. **Giao diện tiếng Việt đầy đủ**
- Công nợ phải thu/phải trả, chi phí (+ định kỳ), thuế, nhà cung cấp, đơn mua hàng
- Quản lý dự án: dự án, công việc, thành viên, timesheet, hóa đơn dự án
- Quản lý sản xuất: BOM đa cấp + resolver, lệnh sản xuất, Lot/Serial/Expiry, Work Center, Routing, Quality Check
- Hóa đơn điện tử (E-Invoice): VNPT adapter — phát hành, hủy, tra cứu mã CQT
- Báo cáo thuế HTKK: 01/GTGT, 05/KK-TNCN, D02-LT (BHXH) — xuất XML + Excel
- **Đối soát ngân hàng**: import sao kê VCB/TCB/MB/BIDV, auto-match + thủ công, tạo bút toán điều chỉnh
- Tài sản cố định: quản lý TSCĐ + cron khấu hao tháng (straight-line) + autopost
- Đa tiền tệ: Currency master, tỷ giá theo ngày, quy đổi
- **Marketplace**: adapter Shopee/TikTok, pull orders → tự động tạo đơn ERP, push inventory
- Report Builder: query builder an toàn, whitelist bảng + cột
- Workflow / Approval: 9 triggers + nhiều bước duyệt + auto-approve
- Customer Portal: KH đăng nhập OTP, xem đơn/công nợ/hóa đơn/loyalty, đặt hàng B2B, VietQR
- Báo cáo & Dashboard, Analytics (xu hướng, RFM khách hàng)
- Audit log: tenant-scoped, ghi lịch sử thao tác đầy đủ
- **Trợ lý Kinh doanh (Smart Guide)**: gợi ý giá bán, nhập hàng, điểm sức khỏe DN 0-100
- AI Agent: chat NL → 20+ tool DB; human-gate; proactive briefing; anomaly detection
- Automation Flows: auto-reorder, auto-payroll, debt-collection, auto-invoice, bank-reco auto-match
- **Chatbot AI**: tích hợp Qwen 2.5 (1.5B + LoRA) / OpenAI, RAG, 17 tools
- **F&B Module**: sơ đồ bàn, KDS, QR ordering, đơn đa kênh (GrabFood/ShopeeFood/BeFood), AI dự báo
- Subscription / Billing: gói dịch vụ, thuê bao tenant, hóa đơn định kỳ, PayOS, plan enforcement
- Support Access Session: SUPER_OMEGA_ULTRA_ADMIN impersonate tenant
- **Help/FAQ**: 18 câu hỏi, 6 danh mục, search + collapse
- **PWA**: Service Worker, cài đặt như app, offline mode, manifest tiếng Việt
- Thông báo real-time (Socket.IO + Redis adapter)
- 14 cron jobs: Morning Briefing, anomaly detection, debt auto-collection, payroll, depreciation...
- Trung tâm Tích hợp: UI cấu hình VNPT/Cloudinary/SMS/SMTP, mã hóa AES-256-GCM
- Email xác minh khi đăng ký, bulk import Excel/CSV
- Multi-tenant isolation: Prisma $extends + AsyncLocalStorage (115 models auto-scope)

**Mô hình dữ liệu (tóm tắt)**

- User, Role enum (SUPER_OMEGA_ULTRA_ADMIN / SUPER_ADMIN / ADMIN / MANAGER / CASHIER / WAREHOUSE), RefreshToken, Tenant, SupportAccessSession
- SubscriptionPlan, TenantSubscription (ACTIVE/TRIAL/EXPIRED/CANCELLED), SubscriptionInvoice (PENDING/PAID/OVERDUE)
- AdminCampaign, AdminCampaignRecipient (chiến dịch email/SMS admin — gửi theo plan filter)
- CompanySettings (cấu hình công ty / onboarding wizard)
- Product, Category
- Warehouse, Inventory, InventoryTransaction (TransactionType enum), StockTransfer, StockTransferItem, CycleCount, CycleCountItem
- Order, OrderItem (OrderStatus, PaymentMethod, PaymentStatus enums), Invoice, ElectronicInvoice (HĐĐT VNPT)
- OrderReturn (ReturnStatus, RefundMethod, ReturnReason enums), OrderReturnItem, ExchangeItem
- Payment
- Customer (CustomerTier enum), CustomerNote (NOTE/CALL/EMAIL/MEETING/ZALO), CustomerTag, CustomerTagOnCustomer, CustomerTask
- CustomerSegment, CustomerCampaign (CampaignChannel: EMAIL/ZALO), CampaignRecipient
- LoyaltyTransaction (tích điểm, đổi điểm)
- Promotion (PromotionType: PERCENTAGE/FIXED_AMOUNT/BUY_X_GET_Y/...), PromotionUsage
- Delivery (DeliveryProvider: GHTK/GHN/VNPOST/VIETTEL_POST/J_T), DeliveryEvent
- Employee, Shift (ShiftType: MORNING/AFTERNOON/NIGHT), Violation, Payroll
- Account (Chart of Accounts), JournalEntry, JournalLine, FiscalPeriod, Expense, ExpenseCategory, RecurringExpenseLog, TaxRate, JournalPostingError
- Vendor, PurchaseOrder, PurchaseItem
- Debt (RECEIVABLE/PAYABLE), DebtPayment
- BankAccount, BankTransaction, BankStatement, BankStatementLine (đối soát NH)
- FixedAssetCategory, FixedAsset, DepreciationSchedule (khấu hao TSCĐ)
- Currency, ExchangeRate (đa tiền tệ)
- Project, ProjectTask, ProjectMember, TimeEntry (timesheet), ProjectInvoice
- Bom, BomItem, WorkOrder, WorkOrderItem, InventoryLot, LotMovement (Lot/Serial/Expiry)
- WorkCenter, Routing, RoutingOperation, QualityCheck, QualityCheckItem
- MarketplaceShop, MarketplaceListing, MarketplaceSyncLog
- AuditLog
- Notification (NotificationType, NotificationSeverity enums)
- SavedReport, ReportSchedule (report builder)
- WorkflowRule, WorkflowStep, WorkflowInstance, WorkflowApproval
- PortalSession, PortalOtp (customer portal)
- IntegrationConfig (key/value mã hóa AES-256-GCM cho VNPT/Cloudinary/SMS/SMTP)

**Cấu trúc thư mục chi tiết**

```
erp-system/
│
│── .claude/                     # Claude AI project settings
│── .dockerignore                # Docker ignore file
│── .env                         # Biến môi trường (DB, JWT, Cloudinary, Redis, Sentry, ...)
│── .env.example                 # Mẫu biến môi trường
│── .env.production              # Mẫu biến môi trường production
│── .gitignore                   # Danh sách file/thư mục không track bởi Git
│── .vscode/                     # Cấu hình VS Code (settings, extensions gợi ý)
│── AGENTS.md                    # Hướng dẫn AI coding assistant
│── docker-compose.yml           # Docker Compose — chạy PostgreSQL container
│── docker-compose.prod.yml      # Docker Compose production (PostgreSQL 16 tuned)
│── Dockerfile                   # Production image cho Railway (auto migrate + start)
│── docs/                        # Tài liệu thiết kế & kế hoạch phát triển
│── ecosystem.config.js          # PM2 process manager config (cluster mode)
│── frontend/                    # React + Vite SPA
│── jest.config.js               # Cấu hình Jest cho unit test
│── logs/                        # File log runtime của server (tự sinh khi chạy)
│── models/                      # Dữ liệu mô hình AI / ML
│── package.json                 # Dependencies & scripts backend
│── plan_upgrade.md              # Quy trình duyệt nâng gói dịch vụ
│── prisma/                      # Prisma ORM — schema, migration, seeder
│── prisma.config.ts             # Cấu hình Prisma CLI
│── railway.json                 # Railway deployment config (Nixpacks)
│── README.md                    # Tài liệu dự án (file này)
│── scripts/                     # Script backup, tiện ích
│── server.err                   # Server error log runtime
│── server.log                   # Server log runtime
│── src/                         # Backend Node.js + Express
│── structure.txt                # Project structure dump
│── tests/                       # Unit tests (Jest)
│── training/                    # Tài liệu training / user guides
│── uploads/                     # Thư mục lưu file upload tạm thời trên server
│
├── .github/
│   └── workflows/
│       ├── ci.yml               # GitHub Actions — CI pipeline (lint, test, build)
│       └── deploy.yml           # GitHub Actions — Deploy workflow
│
├── .vscode/                     # Cấu hình VS Code (settings, extensions gợi ý)
│
├── scripts/
│   └── backup.sh                # Script backup database
│
├── docs/                        # Tài liệu thiết kế & kế hoạch phát triển
│   ├── deep-dive-plan.md        # Kế hoạch phát triển chuyên sâu các module
│   ├── frontend-redesign.md     # Kế hoạch redesign giao diện frontend
│   └── progress/
│       └── PROGRESS.md          # Nhật ký tiến độ redesign frontend
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
│   ├── stock-transfer.service.test.js  # Test chuyển kho giữa các warehouse
│   ├── automation.service.test.js     # Test auto-reorder, debt, briefing, anomaly
│   └── agent-handlers.test.js         # Test AI agent tools + intent resolution
│
├── prisma/                      # Prisma ORM — schema, migration, seeder
│       ├── schema.prisma            # Định nghĩa toàn bộ mô hình dữ liệu (133 models, 59 enums)
│   ├── seed.js                  # Seeder chính — tạo admin (admin@erp.com / admin123)
│   ├── seed_accounting.js       # Seeder hệ thống tài khoản kế toán (Chart of Accounts)
│   ├── seed_accounting_demo.js  # Seeder dữ liệu demo bút toán, giao dịch kế toán
│   ├── seed_comprehensive.js    # Seeder toàn diện — tạo dữ liệu mẫu đầy đủ các module
│   ├── inspect_prices.js       # Script kiểm tra giá sản phẩm trong DB
│   ├── spread_orders.js         # Script phân bổ đơn hàng theo thời gian (test/demo)
│   ├── startup.js               # Script khởi động — clean migration fail + migrate deploy + start server (Railway)
│   ├── inspect_role_enum.js     # Utility: xem giá trị Role enum trong PostgreSQL
│   ├── inspect_users.js         # Utility: xem định nghĩa cột users table
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
│       ├── 20260522130000_add_production_management/             # Module Quản lý sản xuất (BOM + WO)
│       ├── 20260522140000_finance_integration/                   # Tích hợp tài chính (autopost mở rộng)
│       ├── 20260522150000_finance_hardening/                     # Hardening kế toán (idempotent posting)
│       ├── 20260522160000_phase1_einvoice_pit/                   # Phase 1: E-Invoice + Tax Report + PIT/BHXH
│       ├── 20260522170000_phase2_bank_reco_fixed_assets/         # Phase 2: Bank Reconciliation + Fixed Assets
│       ├── 20260522180000_phase2_multicurrency/                  # Phase 2: Multi-currency + Exchange rate
│       ├── 20260522190000_phase3_bom_lot_marketplace_project/    # Phase 3: Lot/Routing/QC + Marketplace + Timesheet
│       └── 20260522200000_phase4_report_workflow_portal/         # Phase 4: Report Builder + Workflow + Customer Portal
│
├── src/                         # ===== BACKEND (Node.js + Express) =====
│   ├── app.js                   # Entry point — khởi tạo Express, mount routes, Socket.IO, cron
│   │
│   ├── config/                  # Cấu hình hệ thống
│   │   ├── prisma.js            # Khởi tạo Prisma Client (kết nối PostgreSQL)
│   │   ├── swagger.js           # Cấu hình Swagger UI (API docs tại /api-docs)
│   │   ├── cloudinary.config.js # Cấu hình Cloudinary (upload ảnh sản phẩm)
│   │   ├── redis.js             # Redis/ioredis client cho Socket.IO adapter
│   │   └── payos.js             # PayOS payment gateway integration
│   │
│   ├── middleware/              # Express middleware
│   │   ├── auth.middleware.js   # Xác thực JWT, kiểm tra role (ADMIN/MANAGER/CASHIER/WAREHOUSE/SUPER_ADMIN/SUPER_OMEGA_ULTRA_ADMIN)
│   │   ├── plan.middleware.js   # Kiểm tra giới hạn gói dịch vụ (maxUsers, maxWarehouses, maxProducts...)
│   │   ├── tenant.middleware.js # Gắn tenantId từ req.user vào req (bỏ qua cho SUPER_ADMIN)
│   │   └── error.middleware.js  # Bắt lỗi chung, trả response lỗi chuẩn hóa
│   │
│   ├── jobs/                    # Tác vụ chạy nền định kỳ (node-cron)
│   │   └── cron.js              # Hủy đơn PENDING >24h, nhắc công nợ quá hạn, nhắc lương, đóng kỳ, kiểm tra subscription hết hạn
│   │
│   ├── realtime/                # WebSocket real-time
│   │   └── socket.js            # Socket.IO server — push thông báo real-time tới client (redis adapter)
│   │
│   ├── utils/                   # Hàm tiện ích dùng chung
│   │   ├── apiError.js          # Class ApiError — tạo lỗi HTTP chuẩn hóa (400, 401, 404, ...)
│   │   ├── logger.js            # Winston logger — ghi log ra console + file
│   │   ├── response.js          # Helper trả response (success, created, paginated, error)
│   │   ├── vietnameseMoneyWords.js  # Chuyển số tiền thành chữ tiếng Việt (cho hóa đơn)
│   │   ├── warehouse.helper.js  # Helper nghiệp vụ kho (tính tồn, kiểm tra stock)
│   │   ├── email.js             # SMTP email wrapper (nodemailer) — đọc config từ IntegrationConfig
│   │   ├── sms.js               # SMS gateway (ESMS / Twilio / LOG)
│   │   ├── crypto.js            # AES-256-GCM encryption/decryption cho IntegrationConfig
│   │   ├── vietqr.js            # VietQR code generator theo NAPAS/EMVCo (CRC16-CCITT)
│   │   ├── zalo.js              # Zalo Official Account API wrapper cho CSKH
│   │   └── template.js          # Mustache-style template renderer ({{var}}, dot-path support)
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
│       │   ├── admin.routes.js          #   Routes: /api/admin — quản lý tenant, thống kê, support session
│       │   ├── admin-campaign.controller.js  #   Controller: CRUD + send campaign cho admin
│       │   └── admin-campaign.service.js     #   Service: gửi chiến dịch email/SMS theo plan filter
│       │
│       ├── subscriptions/               # Subscription & Billing (gói dịch vụ)
│       │   ├── subscription.routes.js   #   Routes: /api/subscriptions — plans, tenant subscriptions, invoices
│       │   ├── subscription.service.js  #   Service: CRUD gói, gán tenant, sinh hóa đơn, kiểm tra hết hạn
│       │   ├── subscription.controller.js#   Controller: xử lý request/response
│       │   └── subscription.validation.js#   Validation: Zod schema cho plans, assign, invoice
│       │
│       ├── settings/                    # Cấu hình hệ thống & onboarding
│       │   ├── settings.routes.js       #   Routes: /api/settings — cấu hình công ty, onboarding
│       │   └── settings.service.js      #   Service: lưu/đọc cấu hình tenant
│       │
│       ├── pos/                         # POS bán hàng (quét barcode, thanh toán)
│       │   └── pos.routes.js            #   Routes: /api/pos — POS endpoints (requireModule middleware)
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
│       │   ├── payroll.calc.js          #   Tính lương: lương cơ bản + phụ cấp ca + phạt + hệ số chấm công
│       │   └── leave.service.js         #   🆕 Nghỉ phép: tạo yêu cầu + trigger LEAVE_REQUEST workflow
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
│       │   ├── period-close.service.js  #   🆕 Kết chuyển cuối kỳ, phân bổ 242, khấu hao, CIT
│       │   ├── founder-dashboard.service.js # Service: dashboard tổng quan cho chủ doanh nghiệp
│       │   ├── purchase-order.routes.js #   Routes: /api/purchase-orders — đơn mua hàng
│       │   ├── purchase.service.js      #   Service: tạo/duyệt đơn mua hàng từ nhà cung cấp
│       │   └── vendor.service.js        #   Service: quản lý nhà cung cấp
│       │
│       ├── projects/                    # Quản lý dự án
│       │   ├── index.js                 #   Router aggregator: /api/projects + /assignable-users
│       │   ├── project.routes.js        #   Routes: CRUD project + /overview + /:id/stats
│       │   ├── project.service.js       #   Service: tạo/sửa dự án (auto add người tạo làm OWNER)
│       │   ├── project-access.middleware.js  # Middleware kiểm tra quyền truy cập project theo member role
│       │   ├── task.routes.js           #   Routes: /api/projects/:id/tasks — công việc trong dự án
│       │   ├── task.service.js          #   Service: CRUD task, gán assignee, thông báo real-time
│       │   ├── member.routes.js         #   Routes: /api/projects/:id/members — thành viên
│       │   ├── member.service.js        #   Service: thêm/sửa role (OWNER/MEMBER/VIEWER), kiểm soát OWNER cuối
│       │   ├── timesheet.routes.js      #   Routes: /api/projects/:id/timesheets — chấm giờ theo task
│       │   └── timesheet.service.js     #   Service: log giờ làm, tổng hợp theo task / nhân viên / dự án
│       │
│       ├── production/                  # Quản lý sản xuất (BOM + WO + Lot + Routing + QC)
│       │   ├── index.js                 #   Router aggregator: /api/production + /overview
│       │   ├── bom.routes.js            #   Routes: CRUD BOM + activate/deactivate
│       │   ├── bom.service.js           #   Service: định mức nguyên liệu, version, kiểm tra tự tham chiếu
│       │   ├── bom-resolver.js          #   Resolver BOM đa cấp (multi-level explode → leaf materials)
│       │   ├── work-order.routes.js     #   Routes: CRUD WO + start/complete/cancel
│       │   ├── work-order.service.js    #   Service: lifecycle WO, atomic update kho khi complete
│       │   │                            #   (trừ NL + cộng thành phẩm + tạo InventoryTransaction trong 1 transaction)
│       │   ├── lot.routes.js            #   Routes: /api/production/lots — lot/serial/hạn dùng
│       │   ├── lot.service.js           #   Service: tạo lot, theo dõi tồn theo lot, cảnh báo hết hạn
│       │   ├── work-center.routes.js    #   Routes: /api/production/work-centers — trung tâm sản xuất
│       │   ├── work-center.service.js   #   Service: CRUD work center (máy/dây chuyền + account chi phí)
│       │   ├── routing.routes.js        #   Routes: /api/production/routings — định tuyến công đoạn
│       │   ├── routing.service.js       #   Service: định nghĩa các bước qua work-center, thời gian chuẩn
│       │   └── quality.service.js       #   Service: Quality Check pass/fail cho từng WO
│       │
│       ├── einvoice/                    # Hóa đơn điện tử (E-Invoice)
│       │   ├── einvoice.routes.js       #   Routes: /api/einvoice — phát hành / hủy / tra cứu
│       │   ├── einvoice.service.js      #   Service: tạo HĐĐT từ Order, gọi adapter VNPT, lưu mã CQT
│       │   └── provider/
│       │       └── vnpt.adapter.js      #   Adapter VNPT — issue / cancel / query (mock + ready cho real API)
│       │
│       ├── tax-report/                  # Báo cáo thuế HTKK
│       │   ├── tax-report.routes.js     #   Routes: /api/tax-reports — tạo / xuất XML / xuất Excel
│       │   └── tax-report.service.js    #   Service: tờ khai 01/GTGT, 05/KK-TNCN, D02-LT (BHXH) — XML đúng HTKK
│       │
│       ├── bank-reco/                   # Đối soát ngân hàng
│       │   ├── bank-reco.routes.js      #   Routes: /api/bank-reco — upload sao kê, match, điều chỉnh
│       │   ├── bank-reco.service.js     #   Service: parse sao kê → auto-match với JournalEntry → flag chênh lệch
│       │   └── importers/
│       │       ├── vcb.importer.js      #   Parser sao kê Vietcombank (Excel/CSV)
│       │       └── tcb.importer.js      #   Parser sao kê Techcombank
│       │
│       ├── fixed-assets/                # Tài sản cố định
│       │   ├── fixed-assets.routes.js   #   Routes: /api/fixed-assets — CRUD + lịch khấu hao
│       │   └── fixed-assets.service.js  #   Service: TSCĐ + cron khấu hao tháng (straight-line) + autopost
│       │
│       ├── currency/                    # Đa tiền tệ
│       │   ├── currency.routes.js       #   Routes: /api/currencies — danh sách + tỷ giá
│       │   └── currency.service.js      #   Service: Currency master + ExchangeRate theo ngày, quy đổi
│       │
│       ├── marketplace/                 # Tích hợp sàn TMĐT
│       │   ├── marketplace.routes.js    #   Routes: /api/marketplace — sync đơn từ Shopee/Lazada/TikTok
│       │   └── marketplace.service.js   #   Service: adapter stub cho 3 sàn, đồng bộ đơn → ERP Order
│       │
│       ├── report-builder/              # Trình dựng báo cáo tùy chỉnh
│       │   ├── report-builder.routes.js #   Routes: /api/report-builder
│       │   └── report-builder.service.js#   Service: query builder an toàn — whitelist bảng + cột, parameterized
│       │
│       ├── workflow/                    # Workflow / Approval
│       │   ├── workflow.routes.js       #   Routes: /api/workflows — rule + instance + approve/reject
│       │   ├── workflow.service.js      #   Service: trigger (EXPENSE_ABOVE/PO_ABOVE/LEAVE_REQUEST/CUSTOM), n bước duyệt
│       │   └── workflow.validation.js   #   Validation: Zod schemas
│       │
│       ├── automation/                  # 🆕 Automation Flows (Phase B)
│       │   └── automation.service.js    #   Service: auto-reorder, auto-payroll, debt-collection, briefing, anomaly
│       │
│       ├── vietqr/                      # 🆕 VietQR Payment (Phase C)
│       │   ├── vietqr.routes.js         #   Routes: /api/vietqr — webhook Casso/SePay/PayOS
│       │   └── vietqr.service.js        #   Service: auto-match transaction → record payment
│       │
│       ├── portal/                      # Customer Self-service Portal
│       │   ├── portal.routes.js         #   Routes: /api/portal — OTP login + xem orders/debts/invoices/loyalty
│       │   └── portal.service.js        #   Service: OTP qua email/SMS, session riêng cho khách hàng
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
│       ├── ai/                          # AI Assistant
│       │   ├── ai.routes.js             #   Routes: /api/ai — RAG chat
│       │   ├── ai.service.js            #   Service: chatbot AI hỗ trợ tra cứu nghiệp vụ ERP (Ollama + RAG)
│       │   ├── agent.routes.js          #   🆕 Agent chat + sessions + analytics + human-gate
│       │   ├── agent.llm.js             #   🆕 LLM proxy server (Qwen 2.5 OpenAI-compatible)
│       │   ├── db-agent.routes.js       #   🆕 DB Agent: NL query → 20+ tool handlers
│       │   ├── db-agent.service.js      #   🆕 DB Agent service: resolveIntent + Prisma handlers
│       │   ├── llm-chat.service.js      #   🆕 LLM orchestration: NL → tool → NL pipeline
│       │   └── inference.py             #   🆕 Python inference (Qwen 2.5 1.5B + LoRA)
│       │
│       └── integrations/                # Trung tâm tích hợp (Integration Center)
│           ├── integration.routes.js    #   Routes: /api/integrations — đọc/ghi/test cấu hình
│           └── integration-config.service.js  # Service: lưu key/value mã hóa AES-256-GCM, cache 60s
│                                        #   DB > process.env, dùng cho VNPT, Cloudinary, SMS, SMTP
│
└── frontend/                    # ===== FRONTEND (React + Vite + Ant Design) =====
    ├── index.html               # HTML entry point
    ├── vite.config.js           # Cấu hình Vite (proxy API, port dev server, PWA)
    ├── package.json             # Dependencies & scripts frontend
    ├── eslint.config.js         # Cấu hình ESLint
    ├── .env                     # Biến môi trường frontend (VITE_API_URL, ...)
    ├── .env.example             # Mẫu biến môi trường frontend
    ├── Dockerfile               # Multi-stage build: Vite build → nginx:alpine
    ├── nginx.conf               # Nginx config cho SPA (fallback index.html)
    ├── .dockerignore            # Docker ignore cho frontend build
    │
    ├── public/
    │   ├── favicon.svg          # Favicon
    │   ├── aduu.jpeg            # Brand image
    │   └── icons.svg            # SVG icons sprite
    │
    └── src/
        ├── main.jsx             # Entry point React — mount App vào DOM
        ├── App.jsx              # Root component — định nghĩa routes (React Router) + RequireRole
        ├── index.css            # CSS reset / global styles
        │
        ├── api/                         # Gọi API backend
        │   ├── axios.js                 #   Axios instance: base URL, interceptor JWT auto-refresh
        │   ├── qrAxios.js               #   Axios public cho QR ordering PWA (không interceptor JWT)
        │   ├── accounting.js            #   API kế toán: sổ cái, bút toán, báo cáo tài chính
        │   ├── debts.js                 #   API công nợ: danh sách, thanh toán, nhắc nợ
        │   ├── notifications.js         #   API thông báo: đọc, đếm chưa đọc
        │   ├── finance.js              #   API tài chính: bank accounts
        │   ├── workflow.js             #   API workflow: rules, runs, approve/reject
        │   ├── reportBuilder.js        #   API report builder: tables, reports, run
        │   ├── timesheet.js            #   API timesheet: time entries, project invoices
        │   ├── lots.js                 #   API lot/serial: get, receive, consume
        │   ├── marketplace.js          #   API marketplace: shops, listings, sync
        │   ├── currency.js             #   API currency: danh sách, tỷ giá
        │   ├── fixedAssets.js          #   API fixed assets: categories, assets, depreciation
        │   ├── bankReco.js             #   API bank reconciliation: statements, match
        │   ├── taxReport.js            #   API tax report: vat, pit, bhxh, xml, excel
        │   └── einvoice.js             #   API e-invoice: issue, cancel, sync
        │
        ├── stores/                      # Zustand — quản lý state toàn cục
        │   └── authStore.js             #   State đăng nhập: user, token, theme, login(), logout()
        │
        ├── hooks/                       # Custom React hooks
        │   ├── useDebounce.js           #   Debounce input (mặc định 300ms cho search)
        │   ├── useBarcodeScanner.js     #   Hook quét mã vạch qua camera/scanner cho POS
        │   ├── useTour.js               #   Hook product tour (Joyride)
        │   └── usePlan.js               #   Hook subscription plan — isAllowed(), hasFeature()
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
        │   ├── Adudu.png                #   Logo brand
        │   ├── react.svg                #   Logo React
        │   └── vite.svg                 #   Logo Vite
        │
        ├── styles/                      # CSS tùy chỉnh
        │   ├── variable.css             #   CSS variables (màu sắc, font, spacing, dark mode)
        │   ├── global.css               #   Style toàn cục (reset, typography, scrollbar)
        │   ├── layout.css               #   Style cho layout (sidebar, topbar, content)
        │   └── pages.css                #   Style riêng cho từng trang (table, modal, form)
        │
        ├── README.md                    # Tài liệu riêng cho frontend (chi tiết redesign)
        │
        ├── components/                  # React components dùng chung
        │   ├── ProtectedRoute.jsx       #   HOC bảo vệ route — kiểm tra đăng nhập
        │   ├── RequireRole.jsx          #   HOC kiểm tra role, redirect /403 nếu không đủ quyền
        │   ├── Receipt.jsx              #   Component in hóa đơn / phiếu thu
        │   ├── CameraScanner.jsx        #   Quét barcode/QR qua camera (POS)
        │   ├── ERPAssistantWidget.jsx   #   Widget chatbot AI — hỏi đáp nghiệp vụ ERP
        │   ├── TransferQrCode.jsx       #   Sinh QR code cho phiếu chuyển kho
        │   ├── PlanGate.jsx             #   Subscription plan gating — kiểm tra quyền module/feature
        │   ├── UpgradePrompt.jsx        #   Banner nhắc nâng gói khi module bị chặn
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
            ├── VerifyEmail.jsx          #   Xác minh email — sau khi click link kích hoạt
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
            ├── Profile.jsx              #   Quản lý profile của từng tài khoản - chỉnh sửa mật khẩu tài khoản
            ├── CustomerDetail.jsx       #   Chi tiết KH 360° — tabs: thông tin, đơn hàng, notes, tasks
            ├── Tasks.jsx                #   Nhiệm vụ CSKH — kanban + filter
            ├── TagManagement.jsx        #   Quản lý Thẻ phân loại (Tags) — bảng CRUD, Color Picker
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
            ├── EInvoice.jsx             #   Quản lý hóa đơn điện tử — phát hành / hủy / tra cứu CQT
            ├── TaxReports.jsx           #   Báo cáo thuế HTKK — 01/GTGT, 05/KK-TNCN, D02-LT
            ├── BankReco.jsx             #   Đối soát ngân hàng — upload sao kê, auto-match
            ├── FixedAssets.jsx          #   Tài sản cố định — danh mục + lịch khấu hao
            ├── Currency.jsx             #   Đa tiền tệ — Currency master + tỷ giá
            ├── Marketplace.jsx          #   Sàn TMĐT — sync đơn Shopee / Lazada / TikTok
            ├── ReportBuilder.jsx        #   Trình dựng báo cáo tùy chỉnh — chọn bảng + cột + filter
            ├── Workflows.jsx            #   Workflow / Approval — danh sách rule + approve/reject
            ├── Approvals.jsx            #   🆕 Duyệt workflow — pending approvals + lịch sử runs
            ├── LotTracking.jsx          #   Tracking lot/serial/hạn dùng cho sản phẩm
            ├── Integrations.jsx         #   Trung tâm tích hợp — UI cấu hình VNPT / Cloudinary / SMS / SMTP + Test connection
            ├── Invoices.jsx             #   Hóa đơn bán hàng — danh sách + PDF + gửi mail
            ├── DeliveryManagement.jsx   #   Vận chuyển — theo dõi đơn GHTK/GHN/VNPOST/Viettel/J&T
            ├── Promotions.jsx           #   Khuyến mãi — PERCENTAGE/FIXED/BUY_X_GET_Y theo lịch
            ├── ModifierGroups.jsx       #   Nhóm tùy chọn món (thêm topping, size) + option
            ├── Combos.jsx               #   Combo — gộp sản phẩm thành 1 combo
            ├── Recipes.jsx              #   Công thức món — nguyên liệu + định mức (COGS)
            ├── LoyaltyRules.jsx         #   Quy tắc tích điểm khách hàng thân thiết
            ├── StampCards.jsx           #   Thẻ tích điểm F&B — template earn/redeem
            ├── Printers.jsx             #   Cấu hình máy in bill ESC/POS
            ├── QrOrderingSetup.jsx      #   Cấu hình QR đặt món — tạo QR bàn + xem trước menu
            ├── QrOrderingPage.jsx       #   PWA khách hàng /q/:qrToken — menu, modifier, đặt món, tracking, VietQR (không cần đăng nhập)
            ├── PortalSettings.jsx       #   Cấu hình Customer Portal (tên, logo, màu sắc)
            │
            ├── HR.jsx                   #   Module Nhân sự — tabs: danh sách NV, chấm công, lương
            ├── AgentAnalytics.jsx       #   AI Agent analytics dashboard
            │
            ├── hr/                      #   Components Nhân sự (embedded từ HR.jsx)
            │   ├── EmployeeList.jsx     #     Danh sách nhân viên — thêm, sửa, nghỉ việc
            │   ├── Attendance.jsx       #     Chấm công — check-in/out, thống kê
            │   └── Payroll.jsx          #     Bảng lương — tính lương, phụ cấp, khấu trừ
            │
            ├── fnb/                     #   Module F&B
            │   ├── Floor.jsx            #     Sơ đồ bàn — CRUD Area + DinerTable, mở/chuyển/tách/gộp bàn
            │   ├── Kds.jsx              #     Kitchen Display — station CRUD, ticket bump/recall/void
            │   ├── OrderInbox.jsx       #     Đơn kênh bên thứ 3 — GrabFood/ShopeeFood/GoFood/BeFood + webhook URL
            │   └── AiForecast.jsx       #     AI dự báo nhu cầu + menu engineering
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
            ├── Subscription.jsx         #   Trang xem gói dịch vụ của tôi + lịch sử hóa đơn (tenant-facing)
            │
            ├── admin/                   #   Khu vực Super Admin (đa tenant)
            │   ├── SuperAdminDashboard.jsx  # Dashboard quản lý các tenant, thống kê tổng, access support
            │   ├── PlansManagement.jsx      # CRUD gói dịch vụ (SUPER_OMEGA_ULTRA_ADMIN)
            │   ├── TenantSubscriptionManager.jsx  # Gán/đổi gói cho tenant
            │   ├── InvoiceManagement.jsx   # Quản lý hóa đơn subscription
            │   ├── AdminUpgradeRequestsPage.jsx  # Yêu cầu nâng gói từ tenant
            │   ├── tenants/TenantListPage.jsx    # Danh sách tenant
            │   └── campaigns/
            │       ├── AdminCampaignListPage.jsx   # DS chiến dịch admin
            │       ├── AdminCampaignFormPage.jsx   # Tạo/sửa chiến dịch admin
            │       └── AdminCampaignDetailPage.jsx # Chi tiết chiến dịch admin
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
JWT_EXPIRES_IN=1h
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

> 💡 **Mới**: Từ phiên bản này, các biến VNPT / Cloudinary / SMTP / SMS đã có **UI cấu hình tại `/integrations`** (cần role ADMIN). Giá trị nhập trong UI sẽ được lưu vào DB (mã hóa AES-256-GCM) và **ưu tiên hơn `.env`** — không cần redeploy khi đổi credentials.

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
[server] listening on http://localhost:4000
[socket] redis adapter attached
```

Kiểm tra:

- Gọi thử `POST /api/auth/login` với `admin@erp.com` / `admin123`
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

- **Email**: `admin@erp.com`
- **Mật khẩu**: `admin123`

---

### Tài liệu mới

- [Hướng dẫn nâng gói dịch vụ (Plan Upgrade)](./plan_upgrade.md) - Chi tiết quy trình duyệt và xử lý yêu cầu nâng gói cho SUPER_OMEGA_ULTRA_ADMIN

### Bước 7 — Chạy test (tuỳ chọn)

```bash
# Chạy toàn bộ test
npm test

# Chạy 1 file test cụ thể
npx jest tests/debt.service.test.js
```

---

## Tài liệu mới cập nhật

- [Hướng dẫn nâng gói dịch vụ (Plan Upgrade)](./plan_upgrade.md) - Chi tiết quy trình duyệt và xử lý yêu cầu nâng gói cho SUPER_OMEGA_ULTRA_ADMIN

## 🛠️ Sự cố thường gặp (Troubleshooting)

| Triệu chứng                                            | Nguyên nhân & Cách khắc phục                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `Cannot find module '@socket.io/redis-adapter'`        | Thiếu deps. Chạy lại `npm install`. Nếu vẫn lỗi: `npm install @socket.io/redis-adapter ioredis`.                                            |
| `connect ECONNREFUSED 127.0.0.1:6379` (spam liên tục)  | Chưa chạy Redis. Khởi động lại: `docker start erp-redis` hoặc tạo mới như Bước 3. App vẫn chạy được nhưng real-time bị giới hạn 1 instance. |
| `P1001: Can't reach database server at localhost:5432` | Postgres chưa chạy hoặc sai `DATABASE_URL`. Chạy `docker-compose up -d` và kiểm tra user/pass trong `.env` khớp với `docker-compose.yml`.   |
| `Error: P3009: migrate found failed migrations`        | Migration cũ bị lỗi. Với DB rỗng: `npx prisma migrate reset` (sẽ xoá sạch DB rồi migrate + seed lại).                                       |
| Login trả `401 Unauthorized` ngay sau seed             | `JWT_SECRET` rỗng hoặc khác giữa các lần restart. Đặt một chuỗi cố định trong `.env`.                                                       |
| Frontend báo `Network Error` / CORS                    | Kiểm tra `CORS_ORIGIN` trong `.env` backend và `VITE_API_URL` trong `frontend/.env`. Đảm bảo backend đang chạy trước khi mở frontend.       |
| Port 4000 / 5173 đã bị chiếm                           | Đổi `PORT` trong `.env` (mặc định 4000, tự tăng nếu bị chiếm). Đóng tiến trình (`netstat -ano                                                                 | findstr :4000` trên Windows). |
| Prisma Studio cảnh báo Node 25                         | Hạ Node về 20 LTS hoặc 22 LTS (dùng `nvm` để chuyển nhanh).                                                                                 |

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

| Role                        | Phạm vi                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **SUPER_OMEGA_ULTRA_ADMIN** | Toàn quyền tối cao — giao diện admin riêng tại `/admin`, quản lý tenant (danh sách/thống kê), gói dịch vụ, hóa đơn subscription, tạo phiên hỗ trợ impersonate ADMIN tenant. Không thấy sidebar ERP trừ khi ở chế độ support. |
| **SUPER_ADMIN**             | Toàn quyền hệ thống + admin dashboard đa tenant                                                                   |
| **ADMIN**                   | Toàn quyền trong tenant — quản lý users, kế toán, audit                                                           |
| **MANAGER**                 | Hầu hết module trừ Users, Audit, Journal                                                                          |
| **CASHIER**                 | POS, Orders, Products, Customers, CRM tasks                                                                       |
| **WAREHOUSE**               | Inventory, Cycle count, Stock transfer, BOM/Work Orders                                                           |

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
/api/accounting                   # bút toán + báo cáo TC (B01/B02/B03 + sổ NKC/sổ cái/sổ chi tiết/CĐSPS 6 cột + kết chuyển cuối kỳ + khấu hao + CIT)
/api/accounting/reports/inventory-valuation  # 🆕 Định giá hàng tồn kho
/api/purchase-orders              # đơn mua hàng
/api/debts                        # công nợ
/api/expenses                     # chi phí
/api/projects                     # quản lý dự án (+ tasks + members + timesheets)
/api/production/boms              # BOM (đa cấp + resolver)
/api/production/work-orders       # lệnh sản xuất
/api/production/lots              # lot / serial / hạn dùng
/api/production/work-centers      # trung tâm sản xuất
/api/production/routings          # định tuyến công đoạn
/api/einvoice                     # hóa đơn điện tử (VNPT) — issue/cancel/query
/api/tax-reports                  # báo cáo thuế HTKK (01/GTGT, 05/KK-TNCN, D02-LT) + XML
/api/bank-reco                    # đối soát ngân hàng — import sao kê VCB/TCB
/api/fixed-assets                 # tài sản cố định + khấu hao tháng
/api/currencies                   # đa tiền tệ + tỷ giá
/api/marketplace                  # tích hợp Shopee / Lazada / TikTok
/api/report-builder               # trình dựng báo cáo (whitelist query)
/api/workflows                    # workflow / approval rules
/api/portal                       # customer self-service portal (OTP)
/api/integrations                 # trung tâm tích hợp — VNPT / Cloudinary / SMS / SMTP (ADMIN)
/api/reports                      # báo cáo
/api/dashboard                    # KPI cho trang chủ
/api/analytics                    # phân tích, RFM
/api/audit                        # activity trail
/api/notifications                # thông báo
/api/import                       # bulk import
/api/settings                     # cấu hình tenant
/api/subscriptions                # subscription & billing (plans, thuê bao, hóa đơn)
/api/admin                        # super admin (đa tenant) + support session
/api/ai                           # AI Agent (chat + tools + human-gate)
/api/agent                        # Agent chat + sessions + analytics
/api/db-agent                     # DB Agent (NL query 20+ tools)
/api/llm                          # LLM proxy (Qwen 2.5 OpenAI-compatible)
/api/vietqr                       # VietQR payment webhook (Casso/SePay/PayOS)
/api/hr/leave                     # Nghỉ phép — tạo yêu cầu + workflow duyệt
# F&B (chỉ hiện khi businessTemplate là F&B)
/api/menu                         # modifier groups, variants, combos, happy-hour
/api/tables                       # areas, tables, sessions, merge/split/transfer
/api/kds                          # KDS stations + tickets (bump/recall/void)
/api/printers                     # ESC/POS printer config
/api/qr-ordering                  # public QR ordering (không auth, Zod validated)
/api/payment-gateway              # Momo/VNPay/ZaloPay create + webhooks
/api/food-delivery                # GrabFood/ShopeeFood/BeFood inbox
/api/recipes                      # recipe + COGS + auto-deduct
/api/stamp-cards                  # loyalty stamp card
/api/ai-forecast                  # dự báo nhu cầu + menu engineering
/api/petty-cash                   # quỹ tiền mặt (chế độ HKD)
```

Chi tiết tham số từng endpoint: xem Swagger tại `/api-docs`.

---

## ⏰ Cron jobs & Real-time

**Cron** (`src/jobs/cron.js`) — 14 tác vụ định kỳ:

- Mỗi 5 phút: quét phiên hỗ trợ hết hạn (support sessions)
- Mỗi giờ: hủy đơn `PENDING` quá 24h
- 00:00 hằng ngày: expire khuyến mãi, loyalty points, subscription hết hạn
- 07:00 hằng ngày: **Morning Briefing** (báo cáo sáng + anomaly alerts)
- 08:00 hằng ngày: **Anomaly Detection** (doanh thu giảm, chi phí tăng, KH dormant)
- 08:00 hằng ngày: nhắc nhiệm vụ CRM sắp tới hạn
- 08:30 hằng ngày: cập nhật tỷ giá tự động
- 09:00 hằng ngày: **Debt Auto-Collection** (3 cấp: sắp hạn, quá 7 ngày, quá 30 ngày)
- 10:00 hằng ngày: **Bank Reco Auto-Match** (tự động đối soát sao kê)
- Mỗi phút: xử lý CRM campaigns đã đặt lịch
- 01:00 ngày 1 hằng tháng: sinh chi phí định kỳ
- 06:00 ngày 25: **Auto-Payroll** (tự động tính lương + bút toán kế toán)
- 01:00 ngày 28: chạy khấu hao TSCĐ tháng
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
- **Prisma `$extends` + AsyncLocalStorage**: tự động inject `tenantId` vào mọi query (findMany, create, update, delete) — 115 business models được auto-scope
- Tenant A **không thể** xem/sửa dữ liệu Tenant B qua API
- `SUPER_OMEGA_ULTRA_ADMIN` bypass scoping (xem tất cả tenant)
- Public routes (QR ordering) set tenant context thủ công từ resource's tenantId
- File: `config/prisma.js`, `config/tenantContext.js`, `middleware/auth.middleware.js`

### Auth & Session
- **JWT access token**: 1h (HS256, algorithm restrict — không bypass "none")
- **Refresh token**: 7 ngày, **hash SHA256** trước khi lưu DB (không plaintext)
- **Refresh token rotation**: mỗi lần refresh → revoke token cũ + tạo mới
- **Password policy**: tối thiểu 8 ký tự, bắt buộc 1 chữ hoa + 1 chữ số (register + changePassword)
- **Bcrypt** hash password (10 rounds)
- **DB check trong authenticate**: reject 503 nếu DB fail (không allow-through)
- **Login generic error**: "Email hoặc mật khẩu không đúng" (không user enumeration)
- File: `auth.service.js`, `auth.validation.js`, `auth.middleware.js`

### Webhook Security
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
POST /api/portal/orders           # 🆕 tự đặt hàng (B2B) — body: { items, paymentMethod }
GET  /api/portal/debt/pay         # 🆕 tạo VietQR thanh toán công nợ
GET  /api/portal/rewards          # 🆕 điểm loyalty + rewards có thể đổi
POST /api/portal/rewards/redeem    # 🆕 đổi điểm lấy ưu đãi
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

### 💳 13. Subscription & Billing (Gói dịch vụ) — **MỚI**

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

### 🔌 14. Trung tâm tích hợp (Integration Center) — **MỚI**

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
npm run db:migrate     # áp dụng các migration phase 1-4
npm run dev

# 2. Đăng nhập super_omega_ultra_admin@gmail.com / 123456, test:
#    - /admin → xem danh sách tenant + thống kê
#    - /admin/plans → tạo/sửa gói dịch vụ
#    - /admin/subscriptions → gán gói cho tenant
#    - /admin/invoices → tạo hóa đơn + đánh dấu đã thanh toán
#    - Nhấn "Hỗ trợ" để impersonate ADMIN của tenant
# 3. Đăng nhập admin@erp.com / admin123, sau đó test theo thứ tự:
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

_Tài liệu cập nhật: 2026-08-01_

## Changelog

### Multi-tenant Scope & Migration Chain (2026-08-10)
- **Migration `20260805160000_add_tenant_scope_and_new_models`**: thêm cột `tenantId` vào 82+ bảng business (Prisma auto-scope `TENANT_SCOPED_MODELS`), DropEnum/AddEnum (Role thêm `ACCOUNTANT`, PaymentMethod thêm MOMO/VNPAY/ZALOPAY/PAYOS/VIETQR, PromotionType thêm HAPPY_HOUR), 193 composite index `(tenantId, ...)`, drop 2 bảng đã thay thế (`exchange_items`, `order_return_items` → `return_line_items` — code đã chuyển sang dùng `lineItems` của `OrderReturn`)
- **Migration `20260805170000_perf_indexes`**: 40+ index `(tenantId, ...)` dùng `IF NOT EXISTS` — an toàn chạy lại, tạo SAU migration tenant scope nên không lỗi thiếu cột
- **Schema thêm `@@ignore` models `AiDocument`/`AiEmbedding`**: khai báo đúng cấu trúc bảng RAG (`ai_documents`/`ai_embeddings` tạo bằng raw SQL migration `20260620100000`) để Prisma Migrate **không drop bảng RAG** khi diff; `ai.service.js` vẫn dùng raw SQL (`$queryRawUnsafe`/`$executeRawUnsafe`) nên không bị ảnh hưởng bởi `@@ignore`
- **Migration chain an toàn khi thiếu pgvector**: mọi lệnh `ALTER TABLE ai_*` trong `120001`/`160000` bọc `DO $$ IF EXISTS (...)` — DB không khởi tạo được bảng RAG (pgvector không có) vẫn migrate chạy bình thường, RAG tự fallback keyword search
- **`prisma.config.ts`**: thêm `shadowDatabaseUrl` (mặc định `erp_shadow` từ `DATABASE_URL`) — `migrate dev`/`migrate diff` chạy được không cần sửa config
- **Migration `20260805160000` idempotent toàn bộ**: 12 `CREATE TYPE`, 9 `ALTER TYPE ADD VALUE`, 40 `CREATE TABLE`, 128 `ADD COLUMN`, 217 `CREATE INDEX`, 40 `ADD CONSTRAINT`, DROP bảng ràng buộc — tất cả bọc `IF NOT EXISTS`/`DO $$ IF EXISTS` → chạy được trên DB đã có sẵn một phần schema (drift từ `db push` cũ) mà không lỗi, vẫn replay sạch từ đầu
- **Migration bù `20260810070000_align_ai_tables_and_types`**: tạo lại `ai_documents`/`ai_embeddings` cho DB mà `20260620100000` nuốt lỗi do thiếu pgvector (embedding `real[] NOT NULL` fallback), align `cycle_count_items.warehouseId` (varchar→text), `portal_otps.blockedUntil` (timestamp→timestamptz)
- **Migration `20260810080000_drop_legacy_objects`**: drop bảng/enum legacy rỗng còn sót từ db push cũ (`happy_hour_rules`, `payment_transactions`, `PaymentProvider`, `PaymentTxStatus`)
- ⚠️ **CẤM `migrate dev` trên DB có bảng RAG**: Prisma 7.8 không biểu diễn được `real[]`/`vector` → `migrate dev`/`diff` luôn sinh `ALTER COLUMN ai_embeddings.embedding SET DATA TYPE DOUBLE PRECISION[]` (phá dữ liệu vector) và cả `DROP TABLE ai_documents` nếu `@@ignore` models bị xóa. Chỉ dùng `migrate deploy` (migrations chứa sẵn guard). Đã xóa migration rác `20260810054511_drift_check` sinh ra bởi `migrate dev --create-only`
- ✅ Đã áp đủ **18/18 migrations** lên `erp_db` (verified: `migrate status` = up to date, schema khớp 100% với fresh replay); nếu repo cũ chưa deploy thì chạy `npm run db:migrate`

### Security Audit (2026-08-01)
- Audit toàn diện: auth/authorization, multi-tenant + injection, app config + XSS, `npm audit` (backend 15 vulns, frontend 6 vulns)
- Kết quả: 5 CRITICAL (role escalation qua /api/users, SQLi + cross-tenant report-builder, webhook Casso không verify, portal OTP Math.random + không scope, AI RAG không tenantId), 7 HIGH, ~10 MEDIUM, ~10 LOW
- Chi tiết + kế hoạch fix 4 đợt: `plans/security-audit-2026-08-01.md`

### Security Fixes — Đợt 1: C1-C3 (2026-08-01)
- **C1 — role escalation**: `user.service.js` thêm `getActor()` + `ROLE_RANK` — chỉ `SUPER_OMEGA_ULTRA_ADMIN` tạo/sửa được user SUPER; tenant ADMIN không gán được role cao hơn mình, không đụng user khác tenant, không tự đổi role/tự khóa mình; frontend `Users.jsx` ẩn vai trò SUPER + nút ghi khi không đủ quyền
- **C2 — report-builder**: whitelist `aggregate.field` (chặn SQLi), ép `WHERE "tenantId"` từ tenant context (thiếu → 403), saved report kiểm tra ownership (`createdById`/`isPublic`), `POST /:id/run` yêu cầu ADMIN/MANAGER
- **C3 — webhook VietQR**: Casso verify **HMAC-SHA256 `X-Casso-Signature`** trên raw body (raw mount trong app.js); SePay bắt buộc `Authorization: Bearer <SEPAY_WEBHOOK_TOKEN>`; fail-closed ở production (`CASSO_WEBHOOK_SECRET`/`SEPAY_WEBHOOK_TOKEN` mới có trong `.env.example`); mọi ghi Payment/debt bọc `runWithTenant()` theo tenant của entity được match; disambiguate mã ORD trùng giữa tenant bằng số tiền
- Tests: `tests/vietqr.test.js` cập nhật theo API mới (verified flag + findMany + tenantId) — 17/17 pass; jest 279/284 (5 fail auth.e2e cần DB migrate `avatar` — pre-existing)

### Security Fixes — Đợt 1: C4-C5 (2026-08-01)
- **C4 — Portal OTP**: `crypto.randomInt()` thay `Math.random()`; OTP record gắn `tenantId` khách hàng + `verifyOtp` chạy trong `runWithTenant()` (không match được OTP của tenant khác); **lockout brute-force** — `attempts` + `blockedUntil` (migration `20260801120000_portal_otp_security`): sai 5 lần → hủy OTP + khóa 15 phút (HTTP 429); `withCustomer` bọc toàn bộ request portal trong tenant của khách
- **C5 — AI RAG**: migration `20260801120001_ai_documents_tenant` thêm `tenant_id` vào `ai_documents` + backfill từ products/customers; `upsertDocument` gắn tenant từ context; `searchDocuments` chỉ trả tài liệu `(tenant_id = $n OR tenant_id IS NULL)` — chat AI không rò rỉ dữ liệu tenant khác, vẫn trả knowledge VAS hệ thống
- ⚠️ Cần chạy `npm run db:migrate` để áp 2 migration mới (portal_otps.attempts/blockedUntil + ai_documents.tenant_id)
- Tests: portal.test.js 26/26 pass (thêm 3 test lockout), jest 282/287 (5 fail auth.e2e cần DB migrate — pre-existing)

### Security Fixes — Đợt 2: H1-H7 (2026-08-05)
- **H1 — support token thu hồi được**: `auth.middleware.js` check `SupportAccessSession` còn ACTIVE + chưa expired khi dùng token impersonate (JWT đã chứa `supportSessionId`); revoke là token chết ngay, không phụ thuộc isActive user
- **H2 — warehouse cross-tenant**: `warehouse.service.js` `updateMany({isDefault:false})` trước đây không `where` → extension không inject tenantId → reset kho mặc định của MỌI tenant; giờ scope theo `getTenantId()` ở cả create + update
- **H3 — upload documents**: filename = `timestamp + randomBytes + ext whitelist [.pdf,.doc,.docx]` (hết path traversal); kiểm tra **magic bytes** sau upload (%PDF/D0CF11E0/PK) — file giả đuôi bị xóa + 400; `fileName` lưu DB strip CRLF/control char (chống header injection Content-Disposition)
- **H4 — delivery webhook**: chỉ GHTK từng được verify — giờ GHN (header `Token` vs `GHN_WEBHOOK_SECRET`), VNPOST/Viettel/J&T (Bearer vs `DELIVERY_WEBHOOK_SECRET`) đều fail-closed ở production; guard thiếu `tracking_code` (trước đây `findFirst` match delivery ĐẦU TIÊN toàn hệ thống!); `findFirst` lọc đúng provider
- **H5 — AI raw SQL**: `getSuggestions`/`getInventoryAlerts` thêm `i."tenantId" = ${tenantId}`; `/suggestions` yêu cầu ADMIN/MANAGER
- **H6 — PII masking**: `piiMask.js` deep-mask đệ quy + thêm `address`/`cccd`/`idNumber`; `response.js` mask tự động ở response layer theo role (CASHIER/WAREHOUSE không thấy SĐT/email KH ở bất kỳ API nào, kể cả nested trong order); `audit.service.js` mask trước khi lưu beforeJson/afterJson — không lưu PII raw
- **H7 — documents crash 500**: bỏ `InternalDocumentDepartment` khỏi `TENANT_SCOPED_MODELS` (model không có cột tenantId → mọi query trên bảng này crash); `GET /:id` thêm `checkAccess` cho role không phải ADMIN/MANAGER
- ⚠️ Cấu hình mới trong `.env` (bắt buộc ở production, thiếu → webhook delivery bị từ chối): `GHN_WEBHOOK_SECRET`, `DELIVERY_WEBHOOK_SECRET` (xem `.env.example`)
- Tests: delivery.service.test.js 8/8 (thêm 2 test: thiếu tracking_code → 400, GHN thiếu secret production → 401); jest 266/289 (5 fail auth.e2e cần DB migrate `avatar` + 18 fail smart-guide cần Postgres đang chạy — đều pre-existing, xác minh bằng `git stash`)

### Security Fixes — Đợt 3: M1-M15 (2026-08-05)
- **M1 — tokenVersion**: đổi mật khẩu tăng `User.tokenVersion` (migration `20260805120000_user_token_version`) + thu hồi toàn bộ refresh token; access token nhúng tokenVersion, `authenticate` so khớp DB → mọi token cũ chết ngay, không chờ hết hạn
- **M2 — human gate thật**: `/human-gates` + `/human-gates/:id/decide` chỉ ADMIN/MANAGER (trước đây mọi role approve được write tool)
- **M3 — role matrix AI tools**: tool PII (thông tin khách hàng/nhân viên/tài chính/nợ) chỉ chạy cho SUPER/ADMIN/MANAGER/ACCOUNTANT; CASHIER/WAREHOUSE hỏi → tạo `DATA_REQUEST` chờ ADMIN/MANAGER duyệt (nút request: danh sách gate PENDING)
- **M4 — proxy LLM**: `/api/llm` yêu cầu `authenticate` (trước là public — dùng chùa LLM + DoS)
- **M5 — VietQR check**: `GET /api/vietqr/check/:orderId` thêm `authenticate` (lộ payment info)
- **M6 — rate limit**: `trust proxy` chỉ bật khi `TRUST_PROXY=true` (chống spoof X-Forwarded-For bypass rate limit); thêm limiter `/auth/refresh` (15ph/30) + `/verify-password` (15ph/10)
- **M7 — refresh token vào httpOnly cookie**: backend set cookie `rt` (Secure production, SameSite=Lax, path `/api/auth`) ở login/refresh/logout/verify2fa — JS không đọc được → XSS không trộm được refresh token; frontend `withCredentials:true`, refresh gọi body rỗng, bỏ hẳn `refreshToken` khỏi localStorage; access token ngắn hạn vẫn ở localStorage
- **M8 — log AI không chứa PII đầy đủ**: `logger.truncateLog()` (300 ký tự) áp dụng cho message chat + tool params
- **M9 — chặn SVG**: upload file settings chỉ nhận jpeg/png/webp (filter + ext match); logo string validate (reject `.svg`/`data:image/svg+xml`/`<svg`) — hết stored XSS
- **M10 — plan enforcement không bypass**: tenant không có subscription → fallback gói FREE (`key="free"` trong seed) — `checkFeature`/`requireModule`/`getMyPlanFeatures` đồng bộ plan.middleware + subscription.service
- **M11 — portal token**: chỉ nhận từ header `x-portal-token`, bỏ query string (lọt access log/referrer)
- **M12 — currency global chỉ nền tảng ghi**: `POST /api/currencies` + `POST /:code/rates` chuyển sang `requireSuperOmega` — catalog + tỷ giá dùng chung mọi tenant, tenant chỉ đọc
- **M13 — promotion raw SQL tenant-scoped**: `incrementUsageAtomic` thêm `AND "tenantId" = ${tenantId}` khi có tenant context
- **M14 — RefreshToken scoped**: thêm vào `TENANT_SCOPED_MODELS` (có cột tenantId, trước là latent hole)
- **M15 — 2FA chống brute-force**: lockout per-account (5 lần sai → khóa 15 phút, 429); login trả **challenge JWT 5 phút** thay vì userId thô → verify2fa không tin userId từ body
- ⚠️ Cần chạy `npm run db:migrate` để áp migration `20260805120000_user_token_version`; set `TRUST_PROXY=true` nếu chạy sau reverse proxy (xem `.env.example`)
- Tests: jest 266/289 (23 fail pre-existing: 5 auth.e2e cần DB migrate `avatar` + 18 smart-guide cần Postgres — không phát sinh fail mới)

### Security Fixes — Đợt 4: L1-L12 (2026-08-05)
- **L1 — bcrypt cost 12**: `BCRYPT_ROUNDS=12` (env, default 12) áp dụng register/changePassword/user create+update; hash cũ cost 10 vẫn verify được
- **L2 — access token 1h**: `JWT_EXPIRES_IN` mặc định `1h` (trước 7d) — refresh qua cookie httpOnly (M7) nên vô hại, giảm cửa sổ token rò rỉ
- **L3 — force đổi mật khẩu admin mặc định**: `User.mustChangePassword` (migration `20260805130000_user_must_change_password`) — 3 user seed đăng nhập lần đầu bị redirect `/profile` bắt đổi mật khẩu trước khi dùng hệ thống
- **L4 — refresh token reuse**: dùng lại token đã revoke → revoke **toàn bộ family** + 401 (nghi token bị đánh cắp)
- **L5 — timing equalization**: login user không tồn tại vẫn chạy `bcrypt.compare` với dummy hash → không phân biệt được qua thời gian phản hồi
- **L6 — email verify bypass**: login bỏ điều kiện `emailVerifyToken` (user admin tạo giờ `emailVerified:true` ngay từ đầu) — chặn user tự xác nhận email mình không nhận được
- **L7 — /api/health**: public chỉ `{status, timestamp, uptime}`; chi tiết infra (DB/Redis/Ollama) chuyển `/api/health/full` — chỉ SUPER_OMEGA
- **L8 — socket token**: bỏ `query.token` (lọt access log), chỉ nhận `handshake.auth`
- **L9 — danh sách tài khoản ngân hàng**: `GET /api/bank-reco/bank-accounts` chỉ ADMIN/MANAGER/ACCOUNTANT
- **L10 — ENCRYPTION_KEY**: docs bắt buộc ở production + cảnh báo đổi key → mất khả năng giải mã 2FA/integration secrets (xem `.env.example`)
- **L11 — deps**: backend xóa dead deps AI (`@xenova/transformers`, `onnxruntime-node` — AI local chạy Python) → `npm audit`: **0 vulnerabilities** (trước: 15, trong đó 1 critical tar); express `^4.21.2` (install 4.22.2), override `tar 7.5.22`. Frontend giữ `react-router-dom ^7.18.2`: advisory còn lại (GHSA-qwww-vcr4-c8h2) chỉ ảnh hưởng RSC mode — app dùng `BrowserRouter` thuần, không RSC; downgrade 7.11 gây 9 advisory khác, upgrade 8.x breaking → **chấp nhận có ghi lý do**
- **L12 — docs**: `.env.example` cập nhật `JWT_EXPIRES_IN=1h`, `BCRYPT_ROUNDS=12`, `ENCRYPTION_KEY` + nhắc lại `SEPAY_WEBHOOK_TOKEN`/per-provider delivery secrets (từ Đợt 2)
- ⚠️ Cần chạy `npm run db:migrate` để áp migration `20260805130000_user_must_change_password`; set `JWT_EXPIRES_IN=1h` + `BCRYPT_ROUNDS=12` (hoặc để mặc định — code đã fallback)
- Tests: jest 266/289 (23 fail pre-existing — không phát sinh fail mới); backend `npm audit` 0 vulnerabilities; frontend build OK + lint 0 errors

### Logic & Performance Fixes — A1-A9 (2026-08-05)
- **A1 — cache kho mặc định theo tenant**: `warehouse.helper.js` trước đây cache 1 slot global → tenant A làm tenant B dùng nhầm warehouse (cross-tenant leak); giờ `Map` keyed theo tenantId + TTL 60s
- **A2 — kiểm kê theo từng kho**: `CycleCountItem` thêm `warehouseId` (migration `20260805140000_cycle_count_item_warehouse`) — trước đây gộp mọi kho của sản phẩm vào 1 dòng rồi complete() ghi cùng số lượng lên MỌI kho (SP ở 2 kho 10+5=15 đếm 12 → cả 2 kho thành 12, tổng 24); giờ mỗi (sản phẩm, kho) là 1 dòng, điều chỉnh đúng kho; frontend hiển thị cột Kho
- **A3 — điều chỉnh tồn kho ghi đúng tiền**: autopost `buildInventoryAdjustmentEntry` dùng `|diff| × costPrice` thay vì số LƯỢNG làm số TIỀN (điều chỉnh 5 đơn vị trước ghi 5 VND)
- **A4 — bỏ double-posting**: hoàn tiền trả hàng / chốt lương / thanh toán nợ NCC trước đây tạo CẢ expense (credit tiền mặt) LẪN bút toán autopost (credit tiền mặt) → tiền mặt/chi phí bị ghi 2 lần; giờ chỉ giữ bút toán double-entry chuẩn (521/511-156/632, 6411/6421-334, 331-cash)
- **A5 — journal đơn hàng cân bằng**: thêm CR 511 cho `serviceCharge` + `tipAmount` (trước đây DR = total gồm phí còn CR = subtotal → mọi đơn F&B có phí dịch vụ rơi vào posting-error outbox)
- **A6 — hoàn tiền cộng dồn**: `markRefunded` dùng `refundedAmount: { increment }` + so sánh lũy kế (trước ghi đè: hoàn 300 rồi 200 → mất 300)
- **A7 — trừ kho atomic**: check-then-decrement → `updateMany({ where: { id, quantity: { gte: qty } } })` kiểm tra lại tại thời điểm ghi (order create COMPLETED/reservation, SHIPPING→COMPLETED, exportStock) — chống race bán quá tồn/âm kho
- **A8 — sinh mã trong transaction + retry**: `ORD-*`/`CC-*` sinh trong tx với `withUniqueRetry` (2 POS tạo đơn cùng lúc trước đây trùng mã → 500)
- **A9 — round2 tiền**: discount %, gross/subtotal/total đơn, so sánh tổng thanh toán với epsilon (9999×10% = 999.9000000000001 → thanh toán đúng 8999.10 trước đây bị từ chối), split bill ITEM
- ⚠️ Cần chạy `npm run db:migrate` để áp migration `20260805140000_cycle_count_item_warehouse` (backfill dòng kiểm kê cũ → kho mặc định)
- Tests: jest 267/290 (23 fail pre-existing; +1 test mới exportStock atomic); frontend lint 0 errors

### Performance & Real-time Fixes — B1-B6 + C1 (2026-08-05)
- **B1 — composite indexes (migration `20260805170000_perf_indexes`)**: 40+ index `(tenantId, ...)` cho orders/customers/products/invoices/debts/journal_entries/audit_logs/notifications/order_items/payments/work_orders + FK indexes child tables (debt_payments, cycle_count_items, return_line_items, delivery_events, lot_transactions, purchase_items, routing_operations, stock_transfer_items...) + pgvector HNSW cho AI RAG (tự skip nếu không có pgvector). Trước đây mọi query bị scope `tenantId` đều filter qua index cột đơn → full-scan theo tenant khi data lớn
- **B2 — cache plan middleware (30s TTL, per-tenant)**: `getEffectivePlan`/`getActiveSubscription` được gọi trên MỌI request của 40+ module (`requireModule`/`checkFeature`) — trước đây 1-2 query DB mỗi request; giờ cache in-memory 30s + `invalidatePlanCache()` khi assign plan/webhook PayOS/hết hạn; count quota (maxUsers...) vẫn đếm live
- **B5 — N+1 fixes**: bank-reco `autoMatch` (query account isCash ra khỏi vòng lặp), portal `createMyOrder` (batch product lookup thay vì per-item), serial-number `register` (1 query tìm trùng thay vì findFirst per code + dedupe batch), getTopProducts dùng nested relation filter thay vì load toàn bộ orderId rồi `IN (...)` (tránh IN clause > 65k params)
- **C1 — socket tenant-scoped rooms**: trước đây `emitToRole` broadcast `role:MANAGER` TOÀN HỆ THỐNG → tenant A nhận thông báo/đơn hàng/AI_ACTION của tenant B; giờ mỗi connection join `tenant:{id}` + `tenant:{id}:role:{role}`, `emitToRole(role, event, payload, tenantId)` chỉ gửi trong tenant (QR ordering, notifications, AI agent CDC đều đã scope); socket kết nối refresh role/tenantId từ DB
- ⚠️ Cần chạy `npm run db:migrate` — giờ có 6 migration chờ (4 cũ + cycle count warehouse + perf indexes)

## Changelog

### Phase 12 — Push Notification PWA + HKD toggle (2026-08-01)
- **Web Push (PWA)** — backend `src/modules/push/`: `web-push`; **VAPID keys ưu tiên DB (IntegrationConfig, private mã hóa AES-256-GCM) > `.env` > tự sinh + lưu DB** — chủ shop không cần biết `.env`, key ổn định qua restart (chỉ set `.env` nếu muốn override)
- API: `GET /api/push/config` (public key), `POST /api/push/subscribe`, `DELETE /api/push/subscribe`, `POST /api/push/test` — tất cả yêu cầu đăng nhập
- Subscription lưu Redis `push:sub:{userId}` (JSON array, tối đa 5 thiết bị, TTL 90 ngày); không có Redis → fallback in-memory Map (warning, mất khi restart); `sendToUser` tự dọn endpoint 404/410; `sendToRole` gửi theo vai trò
- **Mọi notification mới → push tự động**: `notification.service.createOne` gọi `sendPush` fire-and-forget (không chặn luồng)
- Frontend: `src/sw.js` (build bằng **injectManifest** — precache toàn bộ app + SPA navigation fallback, chặn `/api/` + `/socket.io/`, listener `push` → showNotification + `notificationclick` → focus/navigate), `utils/pushSubscribe.js` (subscribe/unsubscribe + localStorage flag, phân biệt quyền denied), App.jsx tự hỏi quyền thông báo **1 lần duy nhất** (cờ `push_prompted`) sau khi đăng nhập, **NotificationsPage**: switch bật/tắt Web Push + nút "Gửi thử"
- **HKD mode UI (Phase 11)**: Settings → Tùy chỉnh → switch "Kế toán đơn giản (HKD)" (chỉ ADMIN) → `PUT /api/settings/accounting-mode`; `authStore.accountingMode` cache localStorage; **Sidebar** khi `SIMPLIFIED_HKD`: ẩn menu double-entry (flag `hkdHidden`), nhóm kế toán đổi nhãn "THU CHI & TÀI CHÍNH", giữ Công nợ/Chi phí/NCC/Mua hàng; **chặn route** `HkdGate` trong App.jsx — gõ thẳng URL `/journal`, `/bank-reco`, `/accounting-reports`, `/financial-reports`, `/tax-reports`, `/einvoice`, `/fixed-assets`, `/currency` → redirect `/403`
- Verify: eslint 0 errors (46 warnings pre-existing), build OK (injectManifest — precache 188 entries), node --check backend OK, jest 277/282 (5 fail auth.e2e cần DB thật — pre-existing)

### Phase 6 — F&B: Floor Canvas kéo-thả (2026-08-01)
- **Floor.jsx → sơ đồ bàn canvas**: bàn định vị tuyệt đối theo `posX/posY`, kéo thả bằng pointer events (hỗ trợ touch trên tablet/điện thoại), phân biệt click-vs-drag bằng threshold 5px (drag → lưu vị trí, click → mở menu hành động)
- Lưu vị trí qua `PATCH /api/tables/positions` (backend đã có sẵn) — batch cập nhật posX/posY/width/height, chống trùng request
- Shape bàn: SQUARE/ROUND/RECTANGLE (border-radius + kích thước mặc định riêng), chấm trạng thái góc bàn, legend màu trạng thái
- Click bàn → menu ngữ cảnh theo trạng thái: Mở bàn (số khách) / Thêm món (→ POS ?table=) / Thanh toán & đóng / Dọn bàn / Sửa / Xóa (xác nhận Modal)
- Zoom +/− (35%–150%) + nút Fit vừa màn hình; grid nền chấm; bàn mới tự chọn vị trí trống (auto-position) tránh chồng lấn
- Verify: eslint 0 errors, build OK

### Phase 6 — F&B Channels: QR Self-Ordering PWA (2026-08-01)
- **`/q/:qrToken` PWA cho khách** (alias `/qr/:qrToken` — link sinh từ QrOrderingSetup): QrOrderingPage.jsx mobile-first, không cần đăng nhập, dùng `qrAxios.js` (axios public, không interceptor JWT → khách không bị redirect /login)
- **Đặt món**: menu tabs theo category (sticky), grid món 2 cột (ảnh/mô tả/giá), modifier modal hỗ trợ SINGLE (radio) / MULTIPLE (checkbox, giới hạn maxSelect) / REQUIRED (bắt buộc minSelect, auto-chọn option duy nhất), priceAdjust cộng vào giá, giỏ hàng drawer đáy + FloatButton badge
- **Theo dõi đơn realtime**: polling 6s, trạng thái từng món PENDING→FIRED→SERVED/VOIDED, tổng tiền, badge đã thanh toán; publicToken lưu localStorage (reload vẫn theo dõi)
- **Tự phục vụ**: Gọi phục vụ (note), Feedback (Rate 1-5 + comment), Thanh toán VietQR (QRCodeSVG + thông tin tài khoản NH mặc định)
- **Backend nâng cấp** (`qr-ordering.service.js`): `getMenu` trả thêm `table` info (code/capacity/areaName); `placeOrder` giờ tính đúng giá modifier (priceAdjust), hỗ trợ `note` + `customerName`, **tự gửi bếp** (gọi `kds.service.generateTicketsForOrder` — món có station tự ra KDS ticket, Order → CONFIRMED), emit `public:order-placed` cho role CASHIER; route mới `GET /api/qr-ordering/order/:publicToken/pay` tạo VietQR (Swagger đã ghi)
- **Verify**: eslint 0 errors, build OK, jest 277/282 (5 fail là auth.e2e cần DB thật — pre-existing)

### Phase 6 — F&B Frontend hoàn thiện (2026-08-01)
- **11 trang UI mới**: Invoices, DeliveryManagement, Promotions, ModifierGroups, Combos, Recipes, LoyaltyRules, StampCards, Printers, QrOrderingSetup, PortalSettings — đầy đủ CRUD, tương tác với backend đã có
- **QrOrderingSetup**: tạo QR bàn qua `qrcode.react`, xem trước menu theo shape `{menu: {categoryName: [products]}}`
- **PortalSettings**: cấu hình Customer Portal (tên, logo, màu) — gọi API company-settings
- **OrderInbox viết lại**: fix provider `SHAPEFOOD` → `SHOPEEFOOD`, thêm `GO_FOOD`, hiển thị + copy webhook URLs `{origin}{base}/food-delivery/webhook/{provider}`
- **Floor.jsx nâng cấp**: CRUD đầy đủ Area + DinerTable (thêm/sửa/xóa inline)
- **Kds.jsx nâng cấp**: Modal CRUD station hoàn chỉnh + nút edit/delete trên tag
- **Pos.jsx F&B mode**: Segmented Tại bàn (DINE_IN) / Mang đi (TAKEAWAY) / Giao hàng (DELIVERY) cho tenant F&B; chọn/mở bàn qua TablePicker (join bàn OCCUPIED hoặc mở bàn AVAILABLE), nhận `?table=` từ Floor; phí dịch vụ % + tip (backend `order.service` giờ cộng serviceCharge + tipAmount vào total); payload F&B đầy đủ (orderType/tableId/tableSessionId/seatNumber/channel); tự đóng bàn khi thanh toán PAID; "Thanh toán sau" DINE_IN tự gửi món ra bếp (kds-generate)
- **BillSplitModal**: tách hóa đơn 3 mode EVEN/ITEM/CUSTOM — chia đều N người, kéo món vào nhóm, chia theo số tiền (tổng phải khớp đơn); thu tiền từng nhóm (markSplitPaid); sửa route `/orders/:id/split-bill` schema khớp service (itemIds+quantities / label+amount)
- **i18n**: thêm 8 namespace vi/en (modifiers, combos, recipes, delivery, invoices, loyalty, stampCards, printers) + `common.confirmDelete`
- **Lint**: 0 errors (46 warnings pre-existing), fix rules-of-hooks Promotions.jsx, bỏ unused vars
- **Swagger JSDoc**: bổ sung đầy đủ cho 12 route files (delivery, invoice, order, einvoice, pos, promotion, return, payment, customer, store-credit, loyalty, portal) — swagger-jsdoc parse 63 paths OK

### Phase 5 — Đóng gói & Go-to-market (2026-07-01)
- Landing page công khai tại `/` với hero, 6 feature cards, 3 steps, pricing preview
- TrialBanner: hiển thị ngày dùng thử còn lại + progress bar + CTA nâng cấp trên Dashboard
- NotFound page (404) thân thiện
- Help/FAQ page (`/help`): 18 câu hỏi, 6 danh mục, search + collapse
- Mobile responsive: CSS breakpoints 480px/768px cho table và KPI grid
- Help menu item trong Sidebar (cả beginner + full mode)

### Phase 4 — Hệ sinh thái kết nối (2026-07-01)
- **Vai trò Kế toán (ACCOUNTANT)**: schema, middleware, 8 route files, Sidebar, App.jsx route guards
- **Marketplace order persistence**: pullOrders → tạo Order + OrderItem + Payment + cập nhật Inventory trong transaction, dedup bằng tag [TMĐT]
- **BankReco UX**: khớp thủ công (modal search bút toán + debounce), bút toán điều chỉnh (modal form), batch auto-match tất cả, journal entry search API
- Route-menu alignment: ACCOUNTANT/CASHIER consistency, Returns → ADMIN+MANAGER group

### Phase 3 — Hướng dẫn Nghiệp vụ thông minh (2026-07-01)
- **Smart Guide** (`/smart-guide`): 4 tab — Sức khỏe shop, Báo cáo nhanh, Nhập hàng, Giá bán
- Backend: `smart-guide.service.js` — pricing insights (margin %, đề xuất giá, cảnh báo bán dưới vốn), reorder suggestions (priority URGENT/HIGH, sales velocity, vendor), business health score 0-100 (5 thành phần: tiền mặt, lợi nhuận, tăng trưởng, công nợ, tồn kho), simple report (narrative tiếng Việt)
- Backend tests: 18/18 smart-guide tests pass

### Phase 2 — Mobile-First POS (2026-07-01)
- **PWA**: manifest tiếng Việt, Workbox cache 3 lớp (CacheFirst static, StaleWhileRevalidate Cloudinary, NetworkFirst API 5s timeout), 159 SW entries
- **In bill nhiệt Bluetooth**: `thermalPrinter.js` — ESC/POS (text align, bold, double size, cut paper, cash drawer), Web Bluetooth API, fallback printViaBrowser
- **Offline Mode**: `offlineQueue.js` — IndexedDB queue, auto-sync khi online, OfflineIndicator banner
- CameraScanner: formatsToSupport EAN-13, Code-128, QR Code cho mã VN 893...
- POS: nút "Kết nối máy in Bluetooth", phone lookup trong mobile drawer

### Phase 1 — Onboarding & UX cho người mới (2026-07-01)
- **Onboarding Wizard**: BusinessTypeStep (10 template ngành: quần áo, tạp hóa, cafe, điện thoại, mỹ phẩm...), seed-template API tự động tạo categories + products + customers
- **Beginner Mode**: Sidebar chỉ hiện 5 mục core, toggle đèn trong sidebar (cả collapsed + expanded), AuthStore.beginnerMode, mặc định ON
- **Dashboard**: welcome banner cho user mới + CTA, onboarding tour tự động
- **Tour System**: expanded tourSteps (Dashboard 4b, POS 4b, Products 3b, Orders 3b, Inventory 2b, Customers 2b, Onboarding 4b)
- DB: `demoSeeded`, `beginnerMode`, `businessTemplate` trong CompanySettings

### UX Polish (2026-07-01)
- **Sidebar**: 9 English labels → Vietnamese (Dashboard→Tổng quan, POS→Bán hàng, Audit Log→Nhật ký, Workflow→Quy trình...)
- **Sidebar abbreviations**: HR→Nhân sự, TC→tài chính, BC→Báo cáo, NH→ngân hàng
- **AccountingReports**: 30+ telex strings → proper Vietnamese diacritics (Mã TK, Diễn giải, Nợ, Có, Số dư...)
- **BankReco**: English labels → VN (Import→Nhập, Auto-match→Khớp tự động, Ref→Tham chiếu, File→Tệp tin), đ→₫, empty state, debounce search
- **TransferQrCode**: "Thanh toan"→"Thanh toán"
- **Marketplace service**: [MP]→[TMĐT], "credentials/API key"→"thông tin xác thực/khóa API", lastSyncAt future-date guard
- **POS**: "VND"→"₫", "Thanh toan POS"→"Thanh toán POS"

- _**Phase 1** — Tuân thủ thuế VN: E-Invoice (VNPT) + Tax Report HTKK + PIT/BHXH_
- _**Phase 2** — Tài chính nâng cao: Bank Reconciliation (VCB/TCB) + Fixed Assets + Multi-currency_
- _**Phase 3** — Vận hành chuyên sâu: BOM đa cấp + Lot/Serial/Expiry + Work Center + Routing + QC + Marketplace (Shopee/Lazada/TikTok) + Project Timesheet_
- _**Phase 4** — Mở rộng người dùng: Report Builder + Workflow/Approval + Customer Self-service Portal_
- _**Phase A (2026-06-25)** — AI Agent Action System: chatbot NL → 20+ tool handlers (CRUD đơn hàng/PO/nhắc nợ) + human-gate duyệt + proactive briefing + anomaly detection_
- _**Phase B (2026-06-25)** — Automation Flows: auto-reorder, auto-payroll (+bút toán), debt-auto-collection (3 cấp), auto-invoice PDF, bank-reco auto-match cron_
- _**Phase C (2026-06-25)** — VN-specific: VietQR Payment Verification (Casso/SePay/PayOS webhook), Tax Report (đã có), Onboarding seed-demo API_
- _**Phase D (2026-06-25)** — Workflow Engine: tích hợp Expense/PO/Leave Request, auto-approve entity, validation, approvals dashboard_
- _**Phase E (2026-06-25)** — Customer Portal: tự đặt hàng B2B, thanh toán công nợ qua VietQR, loyalty rewards_
- _**Integration Center** — UI quản trị tập trung cho VNPT / Cloudinary / SMS / SMTP, mã hóa AES-256-GCM, không cần redeploy khi đổi credentials_
- _**Subscription & Billing** — Gói dịch vụ (SubscriptionPlan), thuê bao tenant (TenantSubscription), hóa đơn (SubscriptionInvoice), SUPER_OMEGA_ULTRA_ADMIN bán gói, plan enforcement middleware_

### Latest Updates (2026-07-20)
- **Integration Center**: UI quản trị tập trung cho VNPT / Cloudinary / SMS / SMTP, mã hóa AES-256-GCM
- **Petty Cash**: quỹ tiền mặt nhỏ cho chế độ HKD
- **Fixed Assets**: TSCĐ + khấu hao tháng, autopost bút toán Nợ 642/Có 214
- **Subscription & Billing**: gói Free 0₫ (5 users, 2 kho, 200 SP), Pro, Enterprise — plan enforcement middleware + module gating
- **Super Admin UI**: dark sidebar layout, PlansManagement, TenantSubscriptionManager, InvoiceManagement
- **Printers module**: cấu hình máy in bill ESC/POS
- **Food Delivery**: GrabFood/ShopeeFood/BeFood inbox
- **AI Forecast**: dự báo nhu cầu theo giờ, menu engineering (stars/dogs), dynamic pricing
- **Stamp Card**: loyalty F&B — earn/redeem stamps
- **Recipe/COGS**: auto-deduct nguyên liệu khi order complete
- **Expense auto**: tự động ghi nhận chi phí định kỳ
- **Period close service**: kết chuyển cuối kỳ, phân bổ 242, khấu hao, CIT
- **Founder dashboard**: dashboard tổng quan cho chủ doanh nghiệp
- **Workflow templates**: tự động seed 3 template workflow cho tenant mới
- **AI agent service enhancement**: human-gate, proactive briefing, anomaly detection
- **Frontend refactor**: i18n support (vi/en), onboarding wizard steps, tour system, 404 page

### Security Hardening (2026-07-01)
- **Multi-tenant isolation**: Prisma `$extends` + AsyncLocalStorage auto-inject `tenantId` vào 115 business models. Tenant A không xem được data Tenant B. Backfill 430 rows.
- **Webhook security**: raw body verify cho Momo/VNPay/ZaloPay. Reject khi chưa config ở production (tránh forge).
- **Auth hardening**: access token 7d→1h, refresh 30d→7d, refresh token hash SHA256 (không plaintext), DB fail→reject 503, password policy min 8 + uppercase + number.
- **Crypto**: bỏ hardcoded fallback key `aduu-default-dev-key` → crash production nếu thiếu ENCRYPTION_KEY.
- **PII masking**: CASHIER/WAREHOUSE thấy `09***5678` cho phone/email/taxCode.
- **xss-clean removed** (deprecated), thêm multer fileFilter (ảnh/Excel/CSV only).
- **Audit log**: thêm CREATE/UPDATE/DELETE_VENDOR.

### F&B Verticals (2026-07-01)
- **4 vertical F&B**: `cafe`, `nha_hang`, `do_an_nhanh`, `bar_pub` (+ 9 retail templates)
- **Menu module**: ModifierGroup, ModifierOption, ProductVariant, Combo, HappyHourRule
- **Tables module**: Area, DinerTable, TableSession, Reservation — open/close/merge/split/transfer
- **KDS module**: KdsStation, KdsTicket — bump/recall/void, stale highlight >15ph
- **QR ordering**: public routes (Zod validated) — menu/order/track/call-waiter/feedback
- **Payment gateway**: Momo/VNPay/ZaloPay adapters (HMAC verify, mock mode)
- **Food delivery**: GrabFood/ShopeeFood/BeFood inbox — accept/reject
- **Recipe/COGS**: Recipe, RecipeIngredient, WasteLog — auto-deduct trên order complete
- **Stamp card**: loyalty F&B — earn/redeem stamps
- **AI forecast**: hourly demand, menu engineering (stars/dogs), dynamic pricing, human-gate
- **Petty cash**: chế độ HKD (SIMPLIFIED_HKD accounting mode)
- **Bill split**: 3 mode (ITEM/EVEN/CUSTOM)
