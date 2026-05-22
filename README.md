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
- Quản lý dự án: dự án, công việc, thành viên, tiến độ, **timesheet (chấm công theo task)**
- Quản lý sản xuất: BOM (đa cấp + resolver), lệnh sản xuất, tự cập nhật kho khi hoàn thành, **Lot/Serial/Expiry tracking, Work Center, Routing (định tuyến công đoạn), Quality Check (QC pass/fail)**
- **Hóa đơn điện tử (E-Invoice)**: tích hợp VNPT adapter — phát hành, hủy, tra cứu mã CQT
- **Báo cáo thuế HTKK**: tờ khai GTGT (01/GTGT), TNCN (05/KK-TNCN), BHXH (D02-LT) — xuất XML đúng schema HTKK + Excel
- **PIT / BHXH**: tính thuế thu nhập cá nhân + bảo hiểm xã hội cho payroll
- **Đối soát ngân hàng (Bank Reconciliation)**: import sao kê VCB / TCB, auto-match với JournalEntry, điều chỉnh chênh lệch
- **Tài sản cố định (Fixed Assets)**: quản lý TSCĐ + cron tự động khấu hao tháng (straight-line) + autopost bút toán
- **Đa tiền tệ (Multi-currency)**: Currency master, tỷ giá theo ngày, quy đổi VND ↔ USD/EUR/...
- **Marketplace integration**: adapter Shopee / Lazada / TikTok (stub sẵn cho API key thật)
- **Report Builder**: query builder an toàn (whitelist bảng + cột, parameterized) cho người dùng tự dựng báo cáo
- **Workflow / Approval**: rule trigger (EXPENSE_ABOVE, PO_ABOVE, LEAVE_REQUEST, CUSTOM) + nhiều bước duyệt
- **Customer Self-service Portal**: KH đăng nhập OTP, xem đơn hàng / công nợ / hóa đơn / điểm loyalty
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
- BankAccount, BankTransaction, **BankStatement, BankStatementLine, BankMatch** (đối soát)
- **EInvoice, EInvoiceStatus enum** (DRAFT/ISSUED/CANCELLED) — kèm taxCode CQT
- **TaxReport, TaxReportType enum** (VAT_01_GTGT, PIT_05_KK_TNCN, BHXH_D02_LT)
- **FixedAsset, FixedAssetDepreciation** (lịch sử khấu hao tháng)
- **Currency, ExchangeRate** (tỷ giá theo ngày)
- **ProductLot, LotMovement** (lot/serial + hạn dùng)
- **WorkCenter, Routing, RoutingStep, QualityCheck** (định tuyến + QC)
- **MarketplaceAccount, MarketplaceOrder** (Shopee/Lazada/TikTok)
- **ReportTemplate** (cấu hình query builder)
- **WorkflowRule, WorkflowStep, WorkflowInstance, WorkflowApproval**
- **PortalSession, PortalOtp** (customer portal)
- **Timesheet** (chấm giờ cho ProjectTask)
- **IntegrationConfig** (key/value mã hóa AES-256-GCM cho VNPT/Cloudinary/SMS/SMTP — quản trị qua UI thay cho `.env`)

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
│       │   └── workflow.service.js      #   Service: trigger (EXPENSE_ABOVE/PO_ABOVE/LEAVE_REQUEST/CUSTOM), n bước duyệt
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
│       │   ├── ai.routes.js             #   Routes: /api/ai
│       │   └── ai.service.js            #   Service: chatbot AI hỗ trợ tra cứu nghiệp vụ ERP (OpenAI)
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
            ├── EInvoice.jsx             #   Quản lý hóa đơn điện tử — phát hành / hủy / tra cứu CQT
            ├── TaxReports.jsx           #   Báo cáo thuế HTKK — 01/GTGT, 05/KK-TNCN, D02-LT
            ├── BankReco.jsx             #   Đối soát ngân hàng — upload sao kê, auto-match
            ├── FixedAssets.jsx          #   Tài sản cố định — danh mục + lịch khấu hao
            ├── Currency.jsx             #   Đa tiền tệ — Currency master + tỷ giá
            ├── Marketplace.jsx          #   Sàn TMĐT — sync đơn Shopee / Lazada / TikTok
            ├── ReportBuilder.jsx        #   Trình dựng báo cáo tùy chỉnh — chọn bảng + cột + filter
            ├── Workflows.jsx            #   Workflow / Approval — danh sách rule + approve/reject
            ├── LotTracking.jsx          #   Tracking lot/serial/hạn dùng cho sản phẩm
            ├── Integrations.jsx         #   Trung tâm tích hợp — UI cấu hình VNPT / Cloudinary / SMS / SMTP + Test connection
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

# --- Encryption key cho Integration Center (≥ 32 ký tự ngẫu nhiên) ---
# Nếu để trống sẽ derive từ JWT_SECRET — KHÔNG khuyến nghị cho production.
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
- 02:00 ngày cuối tháng: tự động khấu hao tài sản cố định (Fixed Assets) + autopost bút toán

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

**Frontend**: trang `Workflows` → tạo rule (trigger + ngưỡng + người duyệt từng bước) → khi phát sinh giao dịch match rule, hệ thống tự tạo **WorkflowInstance** + push notification cho người duyệt → người duyệt vào tab **Cần tôi duyệt** → **Approve** / **Reject**.

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
```

> Portal frontend riêng chưa kèm trong repo — có thể build SPA nhỏ hoặc nhúng vào website công ty. OTP mặc định log ra console khi chưa cấu hình SMS gateway.

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

### 🔌 13. Trung tâm tích hợp (Integration Center) — **MỚI**

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

| Category | Keys | Provider hỗ trợ |
|---|---|---|
| `VNPT` | `VNPT_EINVOICE_URL`, `VNPT_USERNAME`, `VNPT_PASSWORD`, `VNPT_COM_CODE`, `VNPT_TEMPLATE_CODE`, `VNPT_SERIAL` | VNPT E-Invoice (mock fallback) |
| `CLOUDINARY` | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Cloudinary |
| `SMS` | `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_API_SECRET`, `SMS_BRAND_NAME` | ESMS, Twilio, LOG (dev) |
| `EMAIL` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` | bất kỳ SMTP (Gmail, SendGrid, …) |

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

## 🧪 Quy trình test nhanh các tính năng mới

```bash
# 1. Khởi động lại sau khi pull code mới
npm install
npm run db:migrate     # áp dụng các migration phase 1-4
npm run dev

# 2. Đăng nhập admin@erp.com / admin123, sau đó test theo thứ tự:
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
```

---

_Tài liệu cập nhật: 2026-05-22 — hệ thống đã hoàn thiện 7 module nền tảng (Bán hàng, Kho, Tài chính, HR, CRM/Marketing, Dự án, Sản xuất) + 4 giai đoạn mở rộng:_

- _**Phase 1** — Tuân thủ thuế VN: E-Invoice (VNPT) + Tax Report HTKK + PIT/BHXH_
- _**Phase 2** — Tài chính nâng cao: Bank Reconciliation (VCB/TCB) + Fixed Assets + Multi-currency_
- _**Phase 3** — Vận hành chuyên sâu: BOM đa cấp + Lot/Serial/Expiry + Work Center + Routing + QC + Marketplace (Shopee/Lazada/TikTok) + Project Timesheet_
- _**Phase 4** — Mở rộng người dùng: Report Builder + Workflow/Approval + Customer Self-service Portal_
- _**Integration Center** — UI quản trị tập trung cho VNPT / Cloudinary / SMS / SMTP, mã hóa AES-256-GCM, không cần redeploy khi đổi credentials_
