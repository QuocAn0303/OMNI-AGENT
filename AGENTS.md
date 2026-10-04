# AGENTS.md — Aduu ERP (Hệ thống hoạch định nguồn lực doanh nghiệp)

File này cung cấp ngữ cảnh cho AI khi làm việc trên dự án Aduu ERP.

---

## Tổng quan dự án

Aduu ERP là hệ thống **SaaS multi-tenant** cho doanh nghiệp bán lẻ + F&B + dịch vụ + sản xuất nhỏ và vừa, tối ưu cho thị trường Việt Nam. Mục tiêu: giúp chủ shop mới mở quản lý sản phẩm, kho, đơn hàng, khách hàng, kế toán, nhân sự — **không cần biết kế toán**.

- **Backend**: Node.js + Express + Prisma 7 + PostgreSQL (multi-tenant auto-scoping) + Zod + Socket.IO + node-cron + Winston
- **Frontend**: React 19 + Vite + Ant Design 6 + Zustand + Axios + Recharts + react-router 7
- **Auth**: JWT access token + refresh token, role-based (7 roles), support impersonate session
- **Docs**: Swagger UI tại `/api-docs` (dev only)
- **Test**: Jest + setup mock Prisma

---

## Cấu trúc thư mục

```
erp-system/
├── src/                                          # Backend Express
│   ├── app.js                                    # Entry point — 54+ routes, cron, CDC, Socket.IO
│   ├── config/
│   │   ├── prisma.js                             # Prisma client + multi-tenant auto-scoping (TENANT_SCOPED_MODELS)
│   │   ├── tenantContext.js                      # AsyncLocalStorage cho tenant context
│   │   ├── swagger.js                            # Cấu hình Swagger JSDoc
│   │   ├── cloudinary.config.js                  # Upload ảnh Cloudinary
│   │   ├── payos.js                              # PayOS checkout integration
│   │   ├── redis.js                              # Redis ioredis client
│   │   └── business-templates.js                 # 10 ngành mẫu seed
│   ├── middleware/
│   │   ├── auth.middleware.js                     # authenticate() + authorize(...roles) + requireSuperOmega()
│   │   ├── error.middleware.js                   # Global error handler — ZodError, PrismaError, ApiError, fallback
│   │   ├── plan.middleware.js                    # Plan enforcement (kiểm tra giới hạn gói)
│   │   └── tenant.middleware.js                  # Gắn tenantId từ user vào context
│   ├── modules/                                  # 54 modules (xem danh sách đầy đủ bên dưới)
│   ├── utils/
│   │   ├── response.js                           # success(), created(), error(), paginated() + alias sendSuccess/sendError/sendPaginated
│   │   ├── logger.js                             # Winston logger (production dùng combined format)
│   │   ├── apiError.js                           # ApiError class (status, message, details)
│   │   ├── email.js                              # Nodemailer SMTP
│   │   ├── sms.js                                # SMS gateway
│   │   ├── zalo.js                               # Zalo OA API
│   │   ├── piiMask.js                            # Mask PII data (CCCD, phone) trong audit log
│   │   ├── template.js                           # Template render engine
│   │   ├── vietnameseMoneyWords.js               # Đọc số tiền bằng chữ (support tỷ, nghìn, đồng)
│   │   ├── vietnameseAmount.js                   # Parse tiền viết tắt ("5 triệu" → 5000000) cho AI agent
│   │   ├── vietqr.js                             # VietQR generator
│   │   ├── warehouse.helper.js                   # getDefaultWarehouseId, resolveWarehouseId (có cache)
│   │   ├── thermalPrinter.js                     # ESC/POS Bluetooth cho POS
│   │   └── offlineQueue.js                       # IndexedDB queue cho đơn ngoại tuyến
│   ├── jobs/
│   │   ├── cron.js                               # Cron jobs: hủy đơn quá hạn, nhắc nợ, payroll, backup, đóng kỳ, sweep human-gate hết hạn (*/5)
│   │   └── agent.cdc.js                          # Change Data Capture cho AI agent (listen DB changes → agent context)
│   └── realtime/
│       └── socket.js                             # Socket.IO + Redis adapter, mapping user-tenants, rooms
├── prisma/
│   ├── schema.prisma                             # 153 models, 71 enums — Single source of truth
│   ├── startup.js                                # Unified startup (migrate + seed)
│   ├── seed.js                                   # Seed: admin@candory.com / 123456 + dữ liệu mẫu
│   ├── seed_accounting.js                        # Chart of Accounts (~33 TK VAS)
│   └── seed_accounting_demo.js                   # Dữ liệu demo kế toán (user order/invoice/journal)
├── tests/
│   ├── setup.js                                  # Jest setup — mock warehouse.helper, set env
│   ├── accounting.test.js, agent-handlers.test.js, automation.service.test.js, ...
│   └── (72 test files)
├── frontend/                                     # React + Vite
│   ├── src/
│   │   ├── main.jsx                              # Entry - init i18n + ErrorBoundary + Suspense
│   │   ├── App.jsx                               # Root component + routing (lazy load ~90 pages)
│   │   ├── api/                                  # Axios instance + module-specific API functions
│   │   │   ├── axios.js                          # Interceptors: attach JWT, refresh on 401
│   │   │   ├── accounting.js, bankReco.js, currency.js, debts.js, ...
│   │   ├── stores/
│   │   │   └── authStore.js                      # Zustand: user, token, refreshToken, theme, beginnerMode, businessTemplate
│   │   ├── components/
│   │   │   ├── layout/                           # AppShell, Sidebar, TopBar
│   │   │   ├── shared/                           # StatCard, StatusTag, MoneyDisplay, OfflineIndicator, ProtectedRoute, RequireRole
│   │   │   ├── pos/                              # TablePicker (chọn bàn), BillSplitModal (tách hóa đơn 3 mode)
│   │   │   └── agent-ui/                         # AI Agent chat components
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx, Pos.jsx, Orders.jsx, ...
│   │   │   ├── Invoices.jsx, DeliveryManagement.jsx, Promotions.jsx, ModifierGroups.jsx,
│   │   │   │   Combos.jsx, Recipes.jsx, LoyaltyRules.jsx, StampCards.jsx, Printers.jsx,
│   │   │   │   QrOrderingSetup.jsx, PortalSettings.jsx
│   │   │   ├── admin/                            # SuperAdminLayout: tenants, plans, subscriptions, campaigns
│   │   │   ├── fnb/                              # Floor.jsx, Kds.jsx, OrderInbox.jsx, AiForecast.jsx
│   │   │   ├── hr/                               # HR.jsx, EmployeeList.jsx, Payroll.jsx, Attendance.jsx
│   │   │   ├── production/                       # Production.jsx, WorkOrderDetail.jsx
│   │   │   ├── projects/                         # Projects.jsx, ProjectDetail.jsx
│   │   │   └── onboarding/                       # Onboarding wizard steps
│   │   ├── locales/
│   │   │   ├── vi.json                           # Vietnamese translation
│   │   │   └── en.json                           # English translation
│   │   ├── layouts/
│   │   │   └── SuperAdminLayout.jsx              # Dark sidebar layout cho SUPER_OMEGA_ULTRA_ADMIN
│   │   ├── config/
│   │   │   └── tourSteps.js                      # React Joyride tour hướng dẫn
│   │   └── styles/
│   │       ├── variable.css                      # Design tokens — màu, spacing, typography
│   │       └── global.css                        # Base styles + dark mode
│   └── .env                                      # VITE_API_URL (tự động ghi bởi backend khi dev)
├── .env, .env.example
├── Dockerfile, docker-compose.yml, docker-compose.prod.yml
├── jest.config.js
├── .dockerignore
└── PLAN.md                                       # Kế hoạch hoàn thiện & nâng cấp
```

---

## Database Schema

### Enums đầy đủ (71 enums, trích những cái quan trọng)

```
Role:              SUPER_OMEGA_ULTRA_ADMIN | SUPER_ADMIN | ADMIN | MANAGER | ACCOUNTANT | CASHIER | WAREHOUSE
OrderStatus:       PENDING | CONFIRMED | SHIPPING | COMPLETED | CANCELLED
PaymentMethod:     CASH | BANK_TRANSFER | CARD
PaymentStatus:     UNPAID | PAID | PARTIAL
TransactionType:   IMPORT | EXPORT | ADJUSTMENT | RETURN | RESERVATION | RESERVATION_RELEASE
ReturnStatus:      PENDING | APPROVED | REJECTED | COMPLETED
RefundMethod:      CASH | BANK_TRANSFER | STORE_CREDIT | EXCHANGE | NONE
ReturnReason:      DEFECTIVE | WRONG_ITEM | CUSTOMER_CHANGE | EXPIRED | OTHER
ShiftType:         MORNING | AFTERNOON | NIGHT
ViolationType:     LATE | EARLY | PACKING_ERROR | DAMAGED_GOODS | UNAUTHORIZED_ABSENCE
PromotionType:     PERCENTAGE | FIXED_AMOUNT | BUY_X_GET_Y | CATEGORY_DISCOUNT | PRODUCT_DISCOUNT | FREE_SHIPPING
StockTransferStatus: PENDING | IN_TRANSIT | COMPLETED | CANCELLED
SubscriptionStatus: ACTIVE | EXPIRED | CANCELLED | TRIAL
InvoiceStatus:     PENDING | PAID | OVERDUE | CANCELLED | REFUNDED
DeliveryProvider:  GHTK | GHN | VNPOST | VIETTEL_POST | J_T | SELF | OTHER
OrderType:         DINE_IN | TAKEAWAY | DELIVERY
ProductType:       REGULAR | COMBO | VARIANT_PARENT
CustomerTier:      BRONZE | SILVER | GOLD | PLATINUM
CycleCountStatus:  DRAFT | IN_PROGRESS | COMPLETED | CANCELLED
ExpenseStatus:     DRAFT | PENDING_APPROVAL | APPROVED | PAID | REJECTED
AccountType:       ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE | COST_OF_GOODS_SOLD
JournalSource:     MANUAL | ORDER | PAYMENT | RETURN | PURCHASE | EXPENSE | PAYROLL | INVENTORY | BANK | ADJUSTMENT | OPENING_BALANCE | DEBT
CampaignChannel:   EMAIL | ZALO
```

### Mô hình quan hệ chính (tóm tắt)

```
Tenant ─── User ─── Employee ─── Shift
  │          │         ├── Violation
  │          │         ├── Payroll (month/year)
  │          │         ├── OvertimeRequest
  │          │         └── TimeEntry
  │          │
  │          ├── Order ──── OrderItem ── Product ── Inventory ── InventoryTransaction
  │          │     ├── Payment        │     ├── Warehouse
  │          │     ├── Invoice        │     ├── InventoryLot ── LotTransaction
  │          │     ├── ElectronicInvoice │   ├── SerialNumber
  │          │     ├── Delivery ─── DeliveryEvent │
  │          │     ├── OrderReturn ─ OrderReturnItem
  │          │     ├── BillSplit     ├── ExchangeItem
  │          │     └── Debt          ├── StockTransferItem
  │          │                       ├── CycleCountItem
  │          ├── Customer            ├── PurchaseItem
  │          │     ├── CustomerNote  ├── Bom ─── BomItem
  │          │     ├── CustomerTag   ├── WorkOrder ─ WorkOrderItem
  │          │     ├── CustomerTask  ├── QualityCheck
  │          │     ├── LoyaltyTransaction│── MarketPlaceListing
  │          │     ├── StoreCreditTransaction└── Routing ── RoutingOperation
  │          │     ├── CampaignRecipient
  │          │     ├── Debt
  │          │     └── PortalSession
  │          ├── Account ── JournalEntry ─── JournalLine
  │          │     ├── JournalPostingError
  │          │     ├── FiscalPeriod
  │          │     ├── FixedAssetCategory
  │          │     └── ExpenseCategory
  │          ├── Vendor ─── PurchaseOrder ─── PurchaseItem
  │          │     ├── Expense
  │          │     └── Debt
  │          ├── AuditLog
  │          └── Project ── ProjectTask ── ProjectMember
  │                └── ProjectInvoice
  │
  ├── SubscriptionPlan ── TenantSubscription ── SubscriptionInvoice
  ├── AdminCampaign ──── AdminCampaignRecipient
  ├── CompanySettings
  └── SupportAccessSession
```

### Soft delete
Các model có `isActive`:
- `User`, `Product`, `Customer`, `Category`, `Vendor`, `Warehouse`, `Employee`, `SubscriptionPlan`
- `ExpenseCategory`, `FixedAssetCategory`, `Account`, `Currency`, `BankAccount`
- Luôn filter `where: { isActive: true }` trong query list. Endpoint admin/restore dùng khi cần.

---

## 59 Backend Modules

| Nhóm | Module | Files | Mô tả |
|------|--------|-------|-------|
| **Core** | auth | routes/service/controller/validation/e2e.test | Login/refresh/register/verify-email/2fa |
| | users | routes/service | CRUD user + phân quyền |
| | settings | routes/service | CompanySettings + onboarding |
| | audit | routes/service | AuditLog viewer |
| **Bán hàng** | orders | routes/service + invoice.* | Order CRUD, mã ORD-YYYYMMDD-XXXX, discount engine, split bill |
| | payments | routes/service | Payment CRUD |
| | returns | routes/service | Trả hàng + hoàn tiền |
| | delivery | routes/service + webhook | GHTK/GHN/VNPOST/Viettel/J&T webhook |
| | invoice | invoice.service/routes | Hóa đơn PDF |
| | pos | routes/service/print | POS: quét barcode, in bill Bluetooth, offline queue |
| **F&B** | menu | routes/service | Menu món (đồng bộ sản phẩm) |
| | tables | routes/service | Sơ đồ bàn, Area, DinerTable, TableSession, Reservation |
| | kds | routes/service | Kitchen Display System — stations, tickets, bump |
| | qr-ordering | routes/service | QR menu + đặt món, gọi waiter, thanh toán |
| | food-delivery | routes/service | Tích hợp GrabFood/ShopeeFood/BeFood |
| | recipe | routes/service | Công thức món, nguyên liệu, waste log |
| **Kho/Sản xuất** | products | routes/service/test | CRUD, SKU, ảnh Cloudinary |
| | categories | routes/service | Danh mục |
| | inventory | routes/service/test | Tồn kho, giao dịch, nhập/xuất/điều chỉnh |
| | warehouses | routes/service | Multi-warehouse, default warehouse |
| | stock-transfer | routes/service | Chuyển kho |
| | cycle-count | routes/service | Kiểm kê |
| | serial-number | routes/service | Số sê-ri tracking |
| | import | routes (1 file) | Import Excel sản phẩm/KH/NCC |
| | production | bom/work-order/quality routes+service | BOM đa cấp, lệnh SX, WorkCenter, Routing, Quality |
| **CRM** | customers | routes/service | KH 360, tier, loyalty points |
| | crm | campaigns/segments/tasks/tags/notes | Marketing Email+Zalo, phân khúc, nhiệm vụ CSKH |
| | store-credit | routes/service | Tín dụng KH |
| | loyalty | routes/service | Tích điểm, loyalty rules |
| | stamp-card | routes/service | Thẻ tích điểm (F&B) |
| **HR** | hr | employee/shift/violation/payroll routes+service | Nhân sự, chấm công 3 ca, lương, vi phạm, OT |
| **Kế toán** | accounting | 15 files (CoA, journal, expense, vendor, PO, tax, tax-report, petty-cash, purchase-order, prepaid) | Double-entry, autopost 12 sự kiện, sổ nhật ký, sổ cái, bảng CDSPS, B01/B02/B03, phân bổ, khấu hao, kết chuyển, kỳ kế toán |
| | debt | routes/service | Công nợ phải thu/phải trả |
| | einvoice | routes/service | HĐĐT VNPT |
| | tax-report | routes/service | Báo cáo thuế (01/GTGT, 05/TNCN, D02 BHXH) |
| | bank-reco | routes/service | Đối soát sao kê NH, auto-match, adjust |
| | fixed-assets | routes/service | TSCĐ + khấu hao |
| | currency | routes/service | Đa tiền tệ, tỷ giá |
| **Dự án** | projects | project/task/member routes+service | Quản lý dự án, công việc, timesheet |
| **Báo cáo** | reports | routes/service | Báo cáo Excel |
| | dashboard | routes/service | Overview, KPIs, biểu đồ |
| | report-builder | routes/service | Query builder UI |
| | analytics | routes/service | Xu hướng, RFM |
| **Platform** | admin | routes + SuperAdminLayout | Quản trị nền tảng |
| | subscriptions | routes/service | Gói dịch vụ, thuê bao, PayOS |
| | admin (campaign) | campaigns | Chiến dịch upsell admin |
| **Tích hợp** | integrations | routes/service | Cấu hình VNPT/Cloudinary/SMS/SMTP/zalo |
| | marketplace | routes/service | Shopee/TikTok adapter |
| | vietqr | routes/service | VietQR webhook |
| | payment-gateway | routes (1 file) | Cổng thanh toán |
| **AI** | ai | routes/service/agent/llm/db-agent/**humangate** | Chatbot, AI agent (17 tools), human-gate, proactive briefing, RAG |
| | ai-forecast | routes/service | AI dự báo bán hàng (F&B) |
| | smart-guide | routes/service | Gợi ý giá bán, nhập hàng, sức khỏe DN, báo cáo NL |
| | automation | service | Auto-reorder, auto-payroll, debt-collection, auto-invoice, bank-reco auto-match |
| | workflow | routes/service | Quy trình duyệt: 9 triggers, nhiều bước, auto-approve |
| **Khác** | notifications | routes/service | Thông báo real-time (Socket.IO) |
| | portal | routes/service | Customer self-service portal (OTP login, xem đơn, B2B) |
| | printers | routes/service | Cấu hình máy in bill |
| | petty-cash | routes/service | Quỹ tiền mặt nhỏ |

---

## Conventions Backend

### Cấu trúc 1 module
```
src/modules/<name>/
├── <name>.routes.js      # Routes + middleware auth/authorize
├── <name>.service.js     # Business logic + Prisma queries
└── (optional) <name>.validation.js  # Zod schemas
```
(Không bắt buộc tách controller riêng — logic route mỏng gọi service trong try/catch → next(e))

### Response format — dùng utils/response.js
```js
const { success, created, error, paginated, sendSuccess, sendError, sendPaginated } = require('../../utils/response');

// 200 OK
success(res, data, message = 'Thành công', statusCode = 200)
// 201 Created
created(res, data, message = 'Tạo thành công')
// 400 Error (ít dùng, ưu tiên next(err) cho error.middleware)
error(res, message, statusCode)
// 200 + phân trang
paginated(res, data, { page, limit, total, totalPages })

// Alias tương thích:
sendSuccess(res, data, message, statusCode)  // = success(...)
sendError(res, message, statusCode)          // = error(...)
sendPaginated(res, data, pagination)         // = paginated(...)
```

### Auth middleware
```js
const { authenticate, authorize, requireSuperOmega } = require('../../middleware/auth.middleware');

// Xác thực token
router.use(authenticate)

// Giới hạn role (có thể nhiều)
router.post('/', authorize('ADMIN', 'MANAGER'), controller.create)

// SUPER_OMEGA_ULTRA_ADMIN gate
router.get('/admin-only', requireSuperOmega, handler)
```

### Multi-tenant auto-scoping
```js
const prisma = require('../../config/prisma');
// tenantId tự động được inject bởi Prisma extension (config/prisma.js)
// Dựa trên AsyncLocalStorage set bởi tenant.middleware
// SUPER_OMEGA_ULTRA_ADMIN bypass scoping
// Model có tenantId mà chưa trong TENANT_SCOPED_MODELS → thêm vào set ở config/prisma.js
```

### Plan enforcement
```js
const { requireModule } = require('../../middleware/plan.middleware');
router.use(requireModule('import')); // chặn nếu gói không bao gồm module này
```

### Validation với Zod
```js
const z = require('zod');
const schema = z.object({ name: z.string().min(1), price: z.number().positive() });
const parsed = schema.parse(req.body); // throw ZodError → error.middleware tự bắt
```

### Prisma transaction
```js
await prisma.$transaction(async (tx) => {
  const order = await tx.order.create({ data: { ... } })
  await tx.inventory.update({ where: { productId, warehouseId }, data: { quantity: { decrement: qty } } })
  await tx.auditLog.create({ data: { userId, action: 'CREATE_ORDER', entity: 'Order', entityId: order.id } })
})
```

### Mã tự sinh (dùng transaction + retry)
```
Order:       ORD-YYYYMMDD-0001  (tăng dần trong ngày)
Invoice:     HD-YYYY-XXXX
Journal:     JE-YYYYMMDD-XXXX
Expense:     EXP-YYYYMMDD-XXXX
Purchase:    PO-YYYYMMDD-XXXX
StockTrans:  ST-YYYYMMDD-XXXX
CycleCount:  CC-YYYYMMDD-XXXX
Vendor:      NCC-XXXX
E-Invoice:   HDD-YYYYMMDD-XXXX (nội bộ) — số thật từ VNPT
```

### Logger
```js
const logger = require('../../utils/logger');
logger.info('message'); logger.error('error msg');
// KHÔNG dùng console.log trong production code.
```

### Soft delete
- Model có `isActive` → list query luôn thêm `where: { isActive: true }`
- Khi xóa: update `isActive = false` thay vì `delete` (giữ audit trail)

### AuditLog
Ghi AuditLog khi: CRUD Order, Product, User, Customer, Category, Inventory, Payment, Journal
```js
await prisma.auditLog.create({
  data: { userId, action: 'CREATE_ORDER', entity: 'Order', entityId: order.id, afterJson: order, meta: { ip } }
});
```

### Port tự động
Server thử PORT từ .env (mặc định 4000). Nếu bị chiếm → tăng dần, tối đa 10 lần thử. `VITE_API_URL` trong frontend/.env được cập nhật tự động.

### AgentHumanGate (AI agent human-gate)
Mọi thao tác với `AgentHumanGate` đi qua `src/modules/ai/agent.humangate.js`. **Không** tự viết
object literal `prisma.agentHumanGate.create(...)` ở nơi khác — `actionSummary` là `String @db.Text`
**không có `@default`**, thiếu là Prisma bắn `PrismaClientValidationError` ngay ở client.

```js
const {
  buildDataRequestGate,   // xin đọc dữ liệu nhạy cảm → status PENDING, TTL 24h
  buildWriteActionGate,   // write action đã thực hiện → ghi audit, status APPROVED sẵn
  buildReminderGate,      // nhắc nợ qua agent
  buildDecisionData,      // payload update khi approve/reject: decidedById/decisionNote/decidedAt
  createGate,             // create + log; LỖI ĐƯỢC RE-THROW, không nuốt
  sweepExpiredHumanGates, // cron */5: PENDING quá hạn → EXPIRED
} = require('./agent.humangate');

await createGate(buildDataRequestGate({ sessionId, tool, params, role, requestedById }));
await prisma.agentHumanGate.update({ where: { id }, data: buildDecisionData({ decision, note, userId }) });
```

Quy ước chống tái diễn (bảo chứng bởi `tests/agent-humangate.contract.test.js`):
- Tên field decide là `decidedAt/decidedById/decisionNote` — **không** dùng `resolvedAt/resolvedBy/resolvedNote`.
- Cấm `.catch(() => {})` quanh lời gọi gate: gate fail thì log `logger.error` + trả `DATA_REQUEST_FAILED_REPLY`
  cho user (không trả lời giả "đã gửi yêu cầu phê duyệt").
- Payload mới phải được Prisma Client thật validate: xem 4 lớp test trong
  `tests/agent-humangate.contract.test.js` (A: đối chiếu `prisma/schema.prisma`; B: Prisma validator thật;
  C: `createGate`/sweep không nuốt lỗi; D: static guard qua AST).
- HTTP layer (`GET /api/agent/human-gates`, `POST /api/agent/human-gates/:id/decide`) do
  `tests/agent-humangate.route.test.js` phủ (Express thật + mock Prisma): only-PENDING, double-decide,
  gate quá hạn, và cấm response `success:true` giả khi DB fail.
- Smoke test với DB thật (tự dọn dẹp): `node scripts/smoke-humangate.js`.

---

## Conventions Frontend

### Kết nối API
```js
// src/api/axios.js — KHÔNG tạo axios instance riêng
import api from '@/api/axios'
const { data } = await api.get('/products')
// Interceptors tự động attach JWT và refresh token khi 401
```

### Auth state
```js
import { useAuthStore } from '@/stores/authStore'
const { user, token, refreshToken, login, logout, theme, beginnerMode, businessTemplate } = useAuthStore()
```

### Thêm trang mới
1. Tạo `src/pages/MyPage.jsx`
2. Thêm route vào `App.jsx` bên trong `<ProtectedRoute>` + `RequireRole` nếu cần
3. Thêm menu item vào `Sidebar.jsx` (có thể gắn `roles` + `verticals`)

### i18n
```js
import { useTranslation } from 'react-i18next'
const { t } = useTranslation()
// Chuỗi trong JSX: {t('key')} thay vì hardcode tiếng Việt
// Keys trong frontend/src/locales/{vi.json, en.json}
```

### Design tokens (CSS variables)
Dùng từ `styles/variable.css`:
```css
color: var(--color-primary)         /* #0d9488 */
padding: var(--space-4)             /* 16px */
border-radius: var(--radius-md)     /* 8px */
```

---

## Commands thường dùng

```bash
# Backend
npm run dev                    # nodemon, port 4000+ (tự tăng nếu bị chiếm)
npm start                      # prisma/startup.js (migrate deploy + seed cho production)
npm run db:migrate             # Prisma migrate dev
npm run db:migrate:deploy      # Prisma migrate deploy (production)
npm run db:seed                # seed.js + seed_accounting.js + seed_accounting_demo.js
npm run db:seed:accounting     # Chỉ seed accounting (CoA)
npm run db:seed:accounting-demo# Chỉ seed accounting demo data
npm run db:studio              # Prisma Studio GUI
npm test                       # Jest (--runInBand)
npm run check:modules          # Load 204 module bằng Node thật — bắt lỗi "app không boot được" (export trước khai báo, circular require)
npm run check:humangate        # Human-gate qua HTTP THẬT (login → chat → gate → duyệt). Cần backend đang chạy + DB seed. -- --keep để giữ dữ liệu test
npm run smoke:humangate        # Smoke test human-gate trên DB thật (tự dọn dẹp, KHÔNG cần server)
npm run check:llm              # Gọi thật 1 request LLM provider + in provider/model/configured
npm run llm:policy             # In chế độ LLM + có/không key (KHÔNG in giá trị key)
npm run llm:eval               # Đo P/R/F1 khớp SKU — TỪ CHỐI chạy nếu chưa có nhãn tay
npm run llm:labels             # Sinh bộ 120 cặp SKU chờ GÁN TAY (cột label_* để trống)

# Luồng demo AISC26
npm run demo:login             # Bật đăng nhập + gói `business` cho tenant MÔ PHỎNG (idempotent, dry-run mặc định)
npm run smoke:demo-flow        # 12 assertion trên DB thật: chọn SKU → đơn → CDC → gate → duyệt → PO
npm run demo:run               # Chạy luồng demo không cần giao diện (in 6 khối)

# Frontend
cd frontend
npm run dev                    # Vite dev server, port 5173
npm run build                  # Build production → dist/
npm run lint                   # ESLint
npm run preview                # Preview production build

# Docker
docker compose up -d           # PostgreSQL + Redis + backend + frontend
docker compose -f docker-compose.prod.yml up -d  # Production stack
```

---

## Tài khoản mặc định (sau seed)

| Email | Password | Role |
|---|---|---|
| super_omega_ultra_admin@gmail.com | 123456 | SUPER_OMEGA_ULTRA_ADMIN |
| superadmin@candory.com | 123456 | SUPER_ADMIN |
| admin@candory.com | 123456 | ADMIN |
| manager@candory.com | 123456 | MANAGER |

Mật khẩu chung do `prisma/seed.js` đặt `plainPassword = "123456"`. **Không có** tài khoản
`admin@erp.com` (tài liệu cũ ghi sai → login 401).

Khi seed_accounting_demo cũng tạo user demo và dữ liệu kế toán mẫu.

---

## Lưu ý quan trọng

- **Không bao giờ** return `password` trong response — loại bỏ ở service layer
- **Không dùng console.log** trong code production — dùng `utils/logger.js` (Winston)
- **AuditLog** phải ghi khi: CRUD Order/Product/User/Customer/Category/Inventory/Payment/JournalEntry
- **Swagger JSDoc** comment bắt buộc cho mọi endpoint mới — xem `src/config/swagger.js`
- **Cloudinary** dùng cho upload ảnh sản phẩm — config tại `src/config/cloudinary.config.js`
- **OpenAI** tích hợp tại `src/modules/ai/` — chatbot assistant + AI agent
- **ExcelJS** dùng trong modules reports để xuất Excel; PDFKit dùng cho invoice PDF
- **Zod** validation nên đặt trong `.validation.js` hoặc inline trong route trước khi gọi service
- **Prisma extension** `$extends` tự động inject `tenantId` vào mọi query — xem `config/prisma.js`
- Frontend tự động detect API URL từ `frontend/.env` (do backend ghi khi khởi động)
- **Thêm model có `tenantId` vào schema** → phải thêm vào `TENANT_SCOPED_MODELS` trong `config/prisma.js`
- **Route file** viết theo pattern: `authenticate` → `authorize` → try/catch with `next(e)`

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **aduu** (7307 symbols, 15833 relationships, 230 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/aduu/context` | Codebase overview, check index freshness |
| `gitnexus://repo/aduu/clusters` | All functional areas |
| `gitnexus://repo/aduu/processes` | All execution flows |
| `gitnexus://repo/aduu/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
