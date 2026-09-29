# Changelog

> Bản ghi thay đổi & báo cáo bảo mật của dự án Aduu ERP.

### Cập nhật tài liệu & đối soát source (2026-09-27)
- **Số liệu hiện tại (đếm lại từ source)**: **145 models + 65 enums**, 18 migrations, **58 module** backend, **70 prefix** `/api/*`, **42 file test**, **108 trang** frontend, **29 cron jobs**, **132 model** auto-scope tenant
- **README viết lại**: cấu trúc mới (stack & kiến trúc, tính năng, số liệu, cây thư mục compact); sửa các thông tin sai — tài khoản seed (`admin@candory.com` / `123456`, không phải `admin@erp.com`), lệnh migrate (`db:migrate:deploy` an toàn với DB có bảng RAG), danh sách prefix API, thêm vai trò ACCOUNTANT, sửa bảng Troubleshooting markdown hỏng, bỏ link chết `plan_upgrade.md`; gộp mục Changelog trùng lặp
- **Tách `CHANGELOG.md`**: toàn bộ lịch sử thay đổi + báo cáo bảo mật 4 đợt chuyển sang file riêng (README chỉ còn link)
- **`.gitignore` mở rộng**: file test/log/tmp, `*.bak`, `$null`, `/plans/`, `/docs/`, `/Demo Issue Triage*/`, weight model (`*.safetensors|*.bin|*.gguf`); xóa 20 file rác khỏi working tree
- ⚠️ Mục **2026-09-17** bên dưới ghi "141 models / 59 enums / 26 file test" — đó là số liệu của thời điểm đó, số mới nhất xem ở mục này

### Hiện trạng đã verify — Business Ops Multi-Agent & AISC 2026 (2026-09-17)
- **Kiểm kê số liệu (đếm trực tiếp từ source, không ước lượng)**: `prisma/schema.prisma` có **141 models + 59 enums**; `src/modules/` có **58 module**; `tests/` có **26 file test** (`npm test` → `jest --runInBand`)
- **Business Ops Multi-Agent (trục cạnh tranh AISC 2026)**:
  - Procurement Agent: tạo PO qua ngôn ngữ tự nhiên — `src/modules/ai/db-agent.service.js` tool `create_po` → gọi `purchase.service.js` `create()`; phân quyền write-tool chỉ ADMIN/MANAGER (`agent.routes.js`)
  - BOM Resolver đa cấp: `src/modules/production/bom-resolver.js` — `flattenBom` (DFS, guard vòng lặp, maxDepth) + `mergeFlatBom` (merge trùng SKU) + `resolveForWorkOrder`
  - Auto-Reorder: `automation.service.js` `checkAutoReorder()` — tự tạo PO khi `available ≤ minStock`, auto-approve nếu subtotal < 5.000.000₫, ngược lại giữ DRAFT chờ duyệt; trigger từ `onOrderCompleted()`
- **Human-Gate theo ngưỡng chi tiêu (3 tầng)**: model `AgentHumanGate` (PENDING/APPROVED/REJECTED + `expiresAt`) + endpoints `GET /human-gates`, `POST /human-gates/:id/decide`; ngưỡng: auto-reorder 5tr / PO approval từ `CompanySettings.poApprovalThreshold` / workflow trigger `PO_ABOVE`
- **Multi-tenant scope**: `TENANT_SCOPED_MODELS` (`src/config/prisma.js`) giờ gồm **128 models** tự động inject `tenantId` qua Prisma $extends + AsyncLocalStorage
- **Migration & startup**: chuỗi 18/18 migrations deployable từ DB sạch lẫn drifted (commit `e0f5dbd`); `prisma/startup.js` restored — unified migrate deploy + optional seed + start (commit `7dcea0b`)
- ⚠️ **Lưu ý cho hồ sơ dự thi AISC**: dự báo nhu cầu hiện là baseline thống kê (moving average + day-of-week — `ai-forecast.service.js`); XGBoost/WAPE, phân loại ABC-XYZ (CV = σ/μ), Vendor Scorecard/OTIF và Safety Stock động `SS = Z×√(L×σd²+d²×σL²)` **chưa được implement** — trình bày trong hồ sơ phải ghi rõ đây là hướng phát triển, không được ghi là đã làm

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
- **L2 — access token 15m**: `JWT_EXPIRES_IN` mặc định **15m** (đặc tả §3.1: access 15p + refresh 7d) — refresh qua interceptor khi 401, giảm cửa sổ token rò rỉ
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

## Các phase trước (Phase 1 → 12, UX polish, roadmap)

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
