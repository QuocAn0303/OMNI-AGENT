# 00 — Khảo sát hệ thống & chốt phạm vi Vòng 2

**Dự án:** OmniAgent (AISC26-0058) · **Nền tảng:** Aduu ERP
**Ngày khảo sát:** 2026-10-02 · **Commit khảo sát:** `e44b6b3` (working tree sạch)
**Phương pháp:** đọc tĩnh mã nguồn. Mọi khẳng định kèm `file:dòng`. Không suy đoán.

---

## 0. Tóm tắt cho đội (đọc phần này trước)

1. **Luồng "cảnh báo hết hàng → đề xuất đặt hàng → duyệt → tạo PO" CÓ THỂ LÀM ĐƯỢC**, nhưng phần "duyệt" hiện **không có thật**: cơ chế duyệt duy nhất trong repo là *ghi nhận hậu kỳ* (`status: APPROVED` cứng), chưa có gate nào **chặn** hành động ghi. Đây chính là việc lớn nhất của Vòng 2.
2. **Repo không có kiến trúc multi-agent theo nghĩa LLM.** Có 5 *vai trò* agent chạy độc lập theo sự kiện (CDC → tính tồn → đề xuất → giải thích → thông báo), nhưng **LLM không tham gia vào bất kỳ quyết định số liệu nào**. Phải nói thẳng điều này ở Vòng 2.
3. **Adapter Shopee là code THẬT** (không phải stub như README ghi) — ký HMAC, đúng endpoint `/api/v2/*`. Nhưng **chưa từng chạy với credential thật**, và Lazada có trong danh sách nền tảng nhưng không có adapter.
4. **Rủi ro chết người cho buổi demo:** `.env` hiện có `GEMINI_API_KEY` và `OPENAI_API_KEY` đều **rỗng** → `llm.isConfigured()` = false → mọi lời gọi LLM rơi xuống nhánh Python local (Qwen 2.5 + bitsandbytes, không hỗ trợ Windows). **Hiện chưa có LLM nào chạy được trên máy này.**
5. **Chưa tìm thấy 3 cam kết cũ (−90% thao tác, 8%→1,5%, 98,5%) trong bất kỳ file .md nào của repo.** Chúng nằm trong tài liệu Vòng 1 ngoài repo → cần đội chỉ file để gỡ.

---

## 1. Bản đồ hệ thống: cái gì thật, cái gì là bộ khung

Phân loại: **A** = có gọi LLM · **B** = công thức/rule/cron/CDC thuần · **C** = stub / chết / mâu thuẫn doc-vs-code.

### 1.1. Ba "bộ mặt AI" — chỉ một cái thật sự chạm LLM

| Endpoint | File | Có LLM? | Ghi chú |
|---|---|---|---|
| `POST /api/agent/chat` | `ai/agent.routes.js` (15 intent) | **KHÔNG** | `detectIntent()` là `keywords.some(k => lower.includes(k))` — `agent.routes.js:370-378`. Cơ chế "AI Agent" chính, 646 dòng, **không import `config/llm`**. |
| `POST /api/db-agent/query` | `ai/db-agent.routes.js` → `llm-chat.service.js` | **CÓ** | `inferTool()` (`llm-chat.service.js:100`) → `agent.llm.queryModel()` → Gemini hoặc Qwen local. |
| `POST /api/llm/v1/chat/completions` | `ai/agent.llm.js` | **CÓ** | Proxy OpenAI-compatible. `agent.llm.js:124-132`. |
| `POST /api/ai/chat` | `ai/ai.service.js` | **CÓ** | Nhưng đi qua **Ollama** (`ai.service.js:24`, model `gemma2:9b`), **không** qua `config/llm.js`. Đường LLM thứ 3. |

> **Bằng chứng mạnh nhất cho slide "vai trò LLM":** `agent.routes.js:456-457` đánh dấu `stepType = 'LLM_CALL'` rồi gọi `generateResponse()`, nhưng hàm đó chỉ nối chuỗi (`db-agent.service.js:989-997`) — **không có LLM nào được gọi**, dù nhãn ghi vào DB là `LLM_CALL`. Đây là ví dụ rất sắc cho việc "nhãn marketing ≠ hành vi thật", và ta phải tự sửa trước khi trình bày.

### 1.2. Bản đồ vai trò agent (cơ sở cho luận điểm "multi-agent")

| # | Vai trò | Module | Kích hoạt | LLM | Gate | Tình trạng |
|---|---|---|---|---|---|---|
| A1 | **Săn sự kiện** | `jobs/agent.cdc.js` | Postgres `LISTEN/NOTIFY`, trigger trên `inventories`/`orders`/`payments` | Không | Không | Chạy, nhưng nhánh `LOW_STOCK` **chết** (mục 3.1) |
| A2 | **Dự báo nhu cầu** | `modules/ai-forecast` | HTTP thủ công `/forecast` | Không | Có (`/recommendations/:id/:decision`) | Chạy, nhưng **chỉ F&B theo giờ**, không theo SKU |
| A3 | **Gợi ý nhập hàng** | `modules/smart-guide` (`getReorderSuggestions`) | HTTP `/api/smart-guide` | Không | Không | Chạy — **naive**, xem mục 3.2 |
| A4 | **Soạn đề xuất PO + gọi tool** | `modules/ai` (`agent.routes.js`, `db-agent.service.js`) | HTTP `/api/agent/chat` | **Không** (keyword) | Hậu kỳ | Chạy |
| A5 | **Giải thích NL / trả lời** | `ai/llm-chat.service.js`, `ai/ai.service.js` | HTTP `/api/db-agent/query` | **Có** | **Không** | Chạy *nếu* có API key |

> **Cách trình bày trung thực:** "Multi-agent ở đây là **5 vai trò tách biệt, mỗi vai trò có trigger, state và đầu–ra riêng, điều phối bằng event pipeline** — không phải 5 LLM agent tự lập kế hoạch. 2 vai trò thật sự gọi LLM là A5; A1–A4 là code xác định, và ta cố tình để vậy."

### 1.3. Cron (29 job) — không job nào dùng LLM

Nguồn `src/jobs/cron.js`, đếm `cron.schedule` = **29**. Đáng chú ý cho luồng demo:

| Lịch | Job | Liên quan luồng demo |
|---|---|---|
| `*/5 * * * *` | `sweepExpiredHumanGates()` (`cron.js:87`) | ✅ Dùng trong luồng demo |
| `0 6 1 * *` | `vendor-scorecard.job.runAll()` (`cron.js:420`) | ✅ Nguồn dữ liệu OTIF để giải thích vì sao chọn NCC |
| `0 7 * * *` | Lot expiry notify (`cron.js:249`) | ⛔ Ngoài phạm vi |
| `0 7 * * *` | `morningBriefing` | ⛔ Ngoài phạm vi (và có lỗi F7) |
| `0 8 * * *` | `anomalyDetection` | ⛔ Ngoài phạm vi |

**Không có cron nào tạo PO.** PO chỉ sinh qua 2 đường: `onOrderCompleted` → `checkAutoReorder`, và CDC `LOW_STOCK` (chết).

### 1.4. Những thứ KHÔNG dùng cho Vòng 2 (dù có trong repo)

`accounting` (15 file, double-entry) · `hr` (chấm công, payroll) · `kds`, `tables`, `qr-ordering`, `recipe`, `menu` (F&B) · `production` (BOM/WO/routing) · `bank-reco`, `fixed-assets`, `einvoice`, `tax-report`, `currency` · `loyalty`, `stamp-card`, `promotions` · `crm` pipeline (vừa merge `e44b6b3`) · `analytics`, `report-builder`, `projects` · `portal`, `printers`, `vietqr`, `debt`.

Lý do chung: **không phục vụ một luồng duy nhất**, và mỗi cái thêm một màn hình + một slide giải thích mà không đổi được luận điểm.

---

## 2. Luồng demo đề xuất — CHỐT MỘT

### 2.1. Tên luồng

> **"Sắp hết hàng → tính điểm đặt hàng lại → đề xuất PO → người duyệt → tạo PO"**
> trên một nhóm SKU nhỏ, tồn kho **gộp từ nhiều kênh**.

### 2.2. Chuỗi 7 bước (mỗi bước gắn với module thật)

| # | Bước | Module thật | Trạng thái |
|---|---|---|---|
| 1 | Nạp lịch sử bán theo SKU × kênh × ngày | **Cần viết script mới** (module `import` không import được đơn lịch sử — mục 3.4) | ❌ Thiếu |
| 2 | Gộp tồn khả dụng (ATP) = tổng tồn − đã giữ, **tính chung cho mọi kênh** | `inventory` | ✅ Có (`quantity − reserved`) |
| 3 | Tính nhu cầu + ROP + safety stock (công thức, có unit test) | **Cần viết mới** — hiện chỉ có heuristic yếu ở `smart-guide` | ❌ Thiếu |
| 4 | Lọc SKU có ATP ≤ ROP → nhóm theo NCC, tính số lượng đặt | `purchase-orders` (đọc NCC gần nhất), `vendor-scorecard` (OTIF) | 🟡 Cần ghép |
| 5 | Agent soạn đề xuất PO + **giải thích bằng ngôn ngữ chủ shop** (chỉ phần này dùng LLM) | `agent.humangate` + `config/llm` | 🟡 Gate chưa chặn |
| 6 | **Human-gate: PO ở trạng thái PENDING, người duyệt bấm mới tạo** | `agent.humangate.js` | ❌ Phải làm |
| 7 | Duyệt → `purchase.service.create` → audit log + workflow `PO_ABOVE` + notification | `accounting/purchase.service.js` | ✅ Có |

### 2.3. Vì sao chọn luồng này (lập luận chống lại các phương án khác)

| Phương án bị loại | Lý do |
|---|---|
| "Multi-agent tổng quát" (giữ nguyên phạm vi Vòng 1) | Đúng điểm yếu giám khảo nêu: phạm vi rộng hơn nhóm 3 người. |
| "Tối ưu tồn kho toàn mạng" (bổ sung tồn giữa các kho) | Cần dữ liệu multi-warehouse thật; seed chỉ có 1 kho/SP. Sẽ thành mô phỏng. |
| "BOM đa cấp + sản xuất" | Cần dữ liệu BOM thật; phần lớn logic là công thức → đúng câu hỏi "sao không dùng công thức?". |
| "Đồng bộ tồn lên 3 sàn" | Adapter cần credential Shopee Partner (app được duyệt). Rủi ro cao, không demo được. |
| **Luồng chọn** | Đã có ~70% code chạy được; phần thiếu tập trung đúng 1 chỗ (gate); có đường lui rõ ràng nếu LLM chết. |

### 2.4. Phân kênh — **đã chốt** (đội duyệt trong phản hồi Pha 0)

| Kênh | Cách làm | Trạng thái |
|---|---|---|
| Cửa hàng / POS | Dữ liệu thật từ `orders` (đã có sẵn trong repo) | ✅ Duyệt |
| 1 sàn (Shopee) | **File CSV export từ Shopee Seller Centre**, nạp qua script trong `scripts/`. **Nói rõ trên slide: đây là import file, không phải realtime API.** | ✅ Duyệt — chờ dữ liệu (Pha 2) |
| Realtime Shopee API | `marketplace/adapters/shopee.adapter.js` có code thật (HMAC + `/api/v2/product/update_stock`, `/api/v2/order/get_order_list`) nhưng **chưa từng chạy với credential thật** | ⛔ **Đội đã quyết định: không đụng adapter Shopee/Lazada Ở Vòng 2** |

**Kết luận "đa kênh":** luồng demo chứng minh được *"quyết định dựa trên tồn gộp đa kênh"*. Nó **không** chứng minh được *"tích hợp realtime với sàn"*. Phải phát biểu đúng mức đó.

### 2.5. Slide "Chúng tôi KHÔNG làm gì ở Vòng 2"

> - ❌ Không tích hợp API realtime sàn (Shopee/Lazada/TikTok) — mới chỉ có adapter, chưa chạy với credential thật.
> - ❌ Không demo kế toán, HR, F&B, sản xuất/BOM, chăm sóc khách hàng — ngoài phạm vi.
> - ❌ Không dùng dữ liệu seed CANDORY làm bằng chứng hiệu quả.
> - ❌ Không tự tạo PO. Mọi PO đều phải qua người duyệt.
> - ❌ Không tự gửi tin cho NCC. Tin nhắn chỉ được **soạn thảo**, gửi là thao tác của người.

---

## 3. Phát hiện đáng chú ý (đọc kỹ trước khi trình bày)

### 3.1. 🔴 F1 — Nhánh "AI tự tạo PO khi hết tồn" là **code chết** — chưa bao giờ chạy được

> **Trạng thái:** xác minh lại bằng HTTP thật. Cổng đang chạy, CDC đã bắt đầu
> `LISTEN agent_events`, nhưng nhánh này vẫn không thể tạo PO. Sửa ở **P0-2**.

`agent.cdc.js:48-53` gọi `purchaseService.create({ vendorId: null, ... })`, còn `purchase.service.js:116` chặn cứng:
```js
if (!vendorId) throw { status: 400, message: "Thiếu nhà cung cấp (vendorId) cho đơn nhập" };
```
→ **Mọi lần tồn kho chạm 0 chỉ ghi log lỗi.** Tài liệu kiến trúc mô tả đây là cơ chế "AI tự động tạo đơn nhập hàng cho SP hết tồn kho". Nói vậy trước ban giám khảo là tự bắn vào chân mình.

Thêm: `.catch(e => { ...; return null })` nuốt lỗi — trái với quy ước trong `AGENTS.md` ("LỖI ĐƯỢC RE-THROW, không nuốt").

### 3.2. 🔴 F2 — Human-gate hiện **không chặn được gì** cho hành động ghi

`agent.humangate.js` có 3 builder:
| Builder | Status | Có chặn? |
|---|---|---|
| `buildDataRequestGate` | `PENDING` | ✅ Chặn **đọc** dữ liệu nhạy cảm |
| `buildReminderGate` | `PENDING` | ⚠️ Nhắc nội bộ, chưa gửi ra ngoài |
| `buildWriteActionGate` | **`APPROVED` cứng** (`agent.humangate.js:66`) | ❌ **Không chặn** — ghi sau khi hành động đã xong |

Ngoài ra `POST /human-gates/:id/decide` khi `APPROVED` chỉ đóng session, **không thực thi** tool đã bị gate (thiếu cơ chế resume). Tức là gate hiện là *audit + thông báo*, chưa phải *approval có hiệu lực*.

→ **Việc lớn nhất của Vòng 2 là biến gate thành có hiệu lực cho PO.** Đây cũng chính là câu trả lời cho "Agent sai thì ai chịu trách nhiệm?".

### 3.3. 🔴 F3 — Hai đường tạo PO đều vượt kiểm soát

| Đường | Vấn đề |
|---|---|
| `automation.service.js:59` `checkAutoReorder` | Gọi `prisma.purchaseOrder.create` **thẳng**, bỏ qua: audit log, workflow `PO_ABOVE`. Tự đặt `status: "APPROVED"` khi `subtotal < 5.000.000` (`:58`, ngưỡng hard-code, **không** đọc `companySettings.poApprovalThreshold` như `purchase.service.js:34-40`). Tự sinh mã `PO-YYYYMMDD-XXXX` bằng `count+1` (`:53-56`) — **không** bọc `withCodeRetry` ⇒ nguy cơ trùng mã. |
| `db-agent.routes.js:20` | Chỉ có `authenticate`, **không `authorize`**. `useLlm=true` (mặc định) → `llm-chat.service.chat()` → **không kiểm tra tool có phải write tool không** → `create_order` / `create_po` chạy được cho **bất kỳ role nào đã đăng nhập**, kể cả CASHIER/WAREHOUSE, và không có gate. |

Đường này là lý do **không được** demo `POST /api/db-agent/query` ở Vòng 2, và phải sửa trước khi đưa vào sản phẩm.

### 3.4. 🟠 F4 — Module `import` **không** nạp được lịch sử đơn hàng

`src/modules/import/import.routes.js` (233 dòng) chỉ có 3 route: `products`, `customers`, `vendors`. Không route `orders`, không route tồn kho, **không template nào có cột ngày** (`Import.jsx:23-26` cũng chỉ 3 tab).

→ Nạp dữ liệu lịch sử **bắt buộc phải viết script riêng** gọi trực tiếp service layer. Tham khảo mẫu transaction tạo Order + OrderItem tại `prisma/seed.js:642-700`.

### 3.5. 🟠 F5 — Không có cơ chế ghi chi phí LLM

Grep `usageMetadata|promptToken|costPer|pricePerToken` trên toàn `src/` → **0 kết quả**. `config/llm.js:136-156` đọc response Gemini nhưng chỉ lấy `candidates[0].content.parts`, **bỏ qua `usageMetadata`**.

→ Câu hỏi "chi phí LLM bao nhiêu?" **hiện không trả lời được bằng code**. Muốn trả lời ở Vòng 2 thì phải thêm đo token. Đưa vào backlog Pha 3.

### 3.6. 🟠 F6 — Điểm mạnh THẬT — dùng được, nên đưa vào slide

| Điểm mạnh | Bằng chứng |
|---|---|
| **Cách ly tenant đúng 100%** | 140 model có `tenantId`; `TENANT_SCOPED_MODELS` cũng đúng 140; **set-diff = 0** cả hai chiều. Có contract test chặn tái phát: `tests/tenant-scoped-models.contract.test.js:59-74`. |
| **Retry LLM có kiểm soát** | `config/llm.js:169-197`: chuỗi model dự phòng × 2 lần thử, backoff 429/503, không retry 401/403/404. `parseJsonLoose` có 4 unit test (`tests/llm-config.test.js:62-83`). |
| **Client ép IPv4** | `config/llm.js:59,99` dùng `https.request` với `family: 4` — có chủ đích, tránh treo trên máy chỉ có IPv4. |
| **Quy trình duyệt nhiều cấp có sẵn** | `workflow` module + `PO_ABOVE` trigger + audit log + RBAC 7 vai trò. |
| **Bao test tương đối đầy đủ** | 59 file test, gồm contract test cho tenant isolation và human-gate. |

### 3.7. ⚪ F7 — Sai lệch tài liệu ↔ code (đã đối chiếu, dùng số của **code**)

**Cách đếm** — mọi lệnh dưới đây chạy lại được từ thư mục gốc repo, cho kết quả tại commit `e44b6b3`:

```powershell
# 152 / 71 / 58 / 29 / 59
(Select-String -Path prisma\schema.prisma -Pattern '^model\s' -AllMatches).Count
(Select-String -Path prisma\schema.prisma -Pattern '^enum\s'  -AllMatches).Count
(Get-ChildItem src\modules -Directory).Count
(Select-String -Path src\jobs\cron.js -Pattern '^\s*cron\.schedule\(' -AllMatches).Count
(Get-ChildItem tests -Filter *.test.js -File).Count

# 119 trang .jsx ; 201 file mà check:modules nạp
(Get-ChildItem frontend\src\pages -Recurse -Filter *.jsx -File).Count
(Get-ChildItem src\modules -Recurse -Filter *.service.js -File).Count   # 109
(Get-ChildItem src\modules -Recurse -Filter *.routes.js -File).Count   #  92

# 74 prefix /api/* unique (75 dòng app.use; /api/admin bị mount 2 lần)
Select-String -Path src\app.js -Pattern 'app\.use\(' |
  Where-Object { $_.Line -match '/api/' } |
  ForEach-Object { if ($_.Line -match 'app\.use\("([^"]+)"') { $matches[1] } } |
  Sort-Object -Unique | Measure-Object | Select-Object -ExpandProperty Count

# 140 phần tử trong TENANT_SCOPED_MODELS
#   -> so với 140 model có field tenantId trong schema.prisma; set-diff = 0 cả hai chiều
#   -> kiểm bằng: npx jest tests/tenant-scoped-models.contract.test.js
```

| Hạng mục | Tài liệu ghi | **Thực tế** | Cột "thực tế" lấy từ |
|---|---|---|---|
| Model Prisma | 133 | **152** | lệnh 1 |
| Enum | 59 | **71** | lệnh 2 |
| Module backend | 54 | **58** | lệnh 3 |
| Cron job | (không đếm) | **29** | lệnh 4 |
| File test | 19 | **59** | lệnh 5 |
| Trang frontend | ~90 | **119** file `.jsx` | lệnh 6 |
| File nạp bởi `check:modules` | "load 184 module" | **201** (109 service + 92 routes) | lệnh 7, 8 |
| Prefix `/api/*` | 54 | **74** unique | lệnh 9 |
| Model có `tenantId` vs `TENANT_SCOPED_MODELS` | (không nêu) | **140 vs 140 — khớp tuyệt đối** | lệnh 10 + contract test |
| Tên script kiểm tra module | `scripts/check-modules.js` | `scripts/check-module-load.js` | đọc `package.json:17` |
| Model marketplace | "adapter là stub" | **Shopee là code thật** (HMAC + `/api/v2/*`). Lazada khai trong `PLATFORMS` nhưng **không có adapter** | đọc `marketplace/adapters/` |
| `BCRYPT_ROUNDS` | 10 (`.env.example` cũ) / 12 (mục bảo mật) | `auth.service.js:42` và `user.service.js:101,183` dùng **12**; nhưng `prisma/seed.js:188` dùng **10** và `hr.service.js:49` **hard-code 10** | đọc 4 file |
| Tên model LLM mặc định | `gemini-3.8-flash` | Khớp `config/llm.js:33` với `.env.example:70`. **Chưa xác minh tên này có tồn tại thật hay không** — phải chạy `npm run check:llm` với key thật mới có bằng chứng. Không dùng tên này trên slide cho tới lúc đó. | đọc `config/llm.js:33` |
| `LLM_PROVIDER=openai-compatible` | được document | `config/llm.js:138` **hard-code URL Gemini** ⇒ nhiều khả năng không hoạt động. **Chưa xác minh runtime.** | đọc `config/llm.js:138` |
| Gói `enterprise` | — | `seed.js:351` có **`price: 0`** với `allowedModules: ["*"]` → đọc cột `price` sẽ hiện "miễn phí" | đọc `prisma/seed.js` |
| Seed dữ liệu | — | 1 tenant, 11 user, **15–20 SP**, 50 KH (tên faker), **80–120 đơn trong 45 ngày**, ngành nến & trà. `seed.js:5` tự ghi "dữ liệu mẫu" | đọc `prisma/seed.js` |
| Cron "hủy đơn quá hạn" | có trong mô tả | **Không tồn tại** — `notification.service.js:198-234` chỉ tạo notification, không hủy đơn | đọc `notification.service.js` |

### 3.8. ⚪ F8 — Bug khác đã ghi nhận (không chặn demo, nhưng đừng vô tình khoe)

- **Paywall không chặn được ở 16 router**: `router.use(requireModule(...))` đặt **trước** `authenticate` ⇒ `plan.middleware.js:68` không có `tenantId` → `next()` cho qua. Đừng demo tính phân quyền theo gói.
- **Cron automation tạo notification mà không ai thấy**: `automation.service.js` không bọc `runWithTenant` ⇒ `tenantId = null` ⇒ không hiện trong UI.
- **Ngưỡng tồn thấp không nhất quán ở 5 nơi** (`quantity <= 5` hard-code vs `available <= minStock`). Cùng dữ liệu cho ra 2 con số khác nhau — sẽ rất xấu nếu bị hỏi.
- `db-agent.service.js:837` pattern `'po'` khớp chuỗi `"áo polo"` ⇒ route sai sang tra đơn nhập.

---

### 3.9. ✅ Đã xử lý xong

| Việc | Kết quả | Commit |
|---|---|---|
| **P0-1** — `db-agent` mất phân quyền + LLM tự chọn write tool | `WRITE_TOOLS` là nguồn duy nhất; chặn ở **tầng service**; `authorize(READ_ROLES)`; 19 test | `761ea52` |
| **Nhãn `LLM_CALL` sai** ở `agent.routes.js:456` | Đổi sang `TOOL_CALL`, path `fallback_llm` → `fallback_keyword`; 4 test chặn hồi quay lại | `ef1c15f` |
| **P0-4** — 5 nơi dùng 5 ngưỡng tồn thấp khác nhau | Một hàm `evaluateStockStatus` (`atp <= rop`) cho luồng demo; module `replenishment` với 54 unit test | `64b7541` |

Còn lại (F1, F2, và 4 đường tạo PO) → **P0-2 / P0-3, chờ duyệt `00b`**.

---

## 4. Rủi ro cho buổi trình bày

> Nhãn `F1–F8` = phát hiện ở §3 (lỗi trong code). Nhãn `R1–R7` = rủi ro riêng của buổi trình bày.

| # | Rủi ro | Mức | Xử lý |
|---|---|---|---|
| R1 | **Không có LLM nào chạy được**: `GEMINI_API_KEY`/`OPENAI_API_KEY` đều rỗng ⇒ rơi vào Qwen local + bitsandbytes (không hỗ trợ Windows) | 🔴 Cao | Đội tự nhập key vào `.env`. Sau đó chạy `npm run check:llm`. Nếu không kịp: demo chạy **chế độ không LLM** (template giải thích + khớp SKU chuyển sang người map) và nói thẳng trên slide. |
| R2 | Chưa có dữ liệu 3–6 tháng theo SKU × kênh | 🔴 Cao | **Đội đã quyết định chọn phương án (a): dùng dataset công khai**, ghi rõ nhãn "dữ liệu công khai, không phải của doanh nghiệp thật". Vẫn cần đội điền nguồn dữ liệu thật (nếu có) để chốt. |
| R3 | Bị hỏi "sao không dùng công thức ROP?" | 🟠 TB | Pha 1 sẽ trả lời bằng bảng phân vai; trên slide nói thẳng: **ROP là công thức, và LLM không được phép tính ROP**. |
| R4 | Đối thủ (KiotViet/Sapo) đã có cảnh báo tồn tối thiểu | 🟠 TB | Pha 5 sẽ tra cứu và so sánh trung thực; chỗ họ mạnh hơn thì ghi rõ. |
| R5 | Chứng minh "đa kênh" bị chặn vì dữ liệu sàn phải import file | 🟠 TB | Chủ động nói trước trên slide phạm vi. |
| R6 | Đội còn giữ 3 cam kết cũ trong tài liệu Vòng 1 | 🟠 TB | Đội sẽ gửi đường dẫn file. Từ giờ không trích lại ba con số đó trong bất kỳ tài liệu nào. |
| R7 | Bị hỏi về **F3** (hai đường tạo PO vượt kiểm soát / `db-agent/query` mất phân quyền) | 🟡 Thấp | **Đã có lệnh sửa: P0-1 và P0-2.** Khi trình bày: "đã biết và đã vá", không phải "chưa sửa". |

---

## 5. Đã quyết định & còn chờ đội

### 5.1. Đã có quyết định (vòng trả lời sau Pha 0)

| # | Nội dung | Quyết định |
|---|---|---|
| 1 | Luồng demo §2 | ✅ Duyệt, giữ chuỗi 7 bước |
| 2 | Cách trình bày "multi-agent" | ✅ Duyệt cách nói trung thực (5 vai trò, event pipeline, chỉ A5 gọi LLM) — **kèm điều kiện: LLM phải có 2 vai trò đo được, không chỉ viết lời giải thích** |
| 3 | Slide "KHÔNG làm gì" §2.5 | ✅ Duyệt |
| 4 | Kênh sàn | ✅ **Import file CSV Shopee**, ghi rõ không phải realtime. Không đụng adapter ở Vòng 2 |
| 5 | Nguồn số liệu | ✅ Lấy số **từ code**, kèm lệnh đếm chạy lại được (§3.7). Không đưa số kiểu "152 model" lên slide nếu không cần |
| 6 | Dữ liệu thật | ✅ Chọn phương án (a) — dataset công khai, **giữ slide định lượng**, dán nhãn rõ nguồn |
| 7 | LLM | ✅ Gemini qua `config/llm.js` — **một đường LLM duy nhất**, không xây thêm trên `ai.service.js` (Ollama). Demo phải chạy được khi LLM tắt |

### 5.2. Còn chờ đội điền

1. **Dữ liệu thật** `[ĐỘI ĐIỀN: đã có / chưa có / đang liên hệ shop nào? số tháng, số SKU, kênh nào?]` — hạn chót chốt nguồn: `[ĐỘI ĐIỀN: ngày]`
2. **API key Gemini** `[ĐỘI ĐIỀN: đã có key chưa? ngân sách token/tháng?]` — đội tự nhập vào `.env`, không gửi qua kênh chat.
3. **Người thử đo thời gian thao tác** `[ĐỘI ĐIỀN: tên/số người có thể thử]` — chỉ số này bắt buộc đo trên người thật, dataset công khai không thay được.

---

## 6. Trạng thái sau Pha 0

- ✅ Khảo sát code.
- ✅ Đã xác minh 3 điểm rủi ro lớn nhất bằng đọc trực tiếp file: gate không chặn (F2), CDC auto-PO chết (F1), `db-agent/query` thiếu phân quyền (F3).
- ✅ Số liệu §3.7 đã đối chiếu lại bằng lệnh chạy được, có ghi kèm lệnh để đội và giám khảo tự kiểm.
- ⏸ Chờ đội điền 3 mục ở §5.2.
- ⏭ Tiếp theo theo thứ tự đội chỉ định: P0-1 → note thiết kế gate → Pha 1 → P0-2/4/5 → module replenishment → P0-3 code.

---

## 7. Backlog đã ghi nhận (không sửa ở Vòng 2)

Mỗi mục đã được **xác minh** chứ không phải nghi ngờ. Cột "Vì sao hoãn" là lý do cụ thể.

| # | Vấn đề | Vì sao hoãn | Khi nào xử lý |
|---|---|---|---|
| B1 | `requireModule` đặt **trước** `authenticate` ở **16 router** ⇒ paywall không chặn được | Không nằm trên luồng demo. Sửa là đổi 16 file. Đã ghi rõ trong `01`/`06`: **đừng trình bày tính phân quyền theo gói như đang hoạt động.** | Vòng 3 · Kích thước: sửa chỉ là đổi thứ tự middleware + thêm test, **~1 ngày** — báo để đội quyết định có làm không |
| B2 | `PO_APPROVE_THRESHOLD = 50_000_000` hard-code (`purchase.service.js:45,243`), không đọc `companySettings.poApprovalThreshold` | **Đã xác minh KHÔNG nằm trên luồng demo** — nó chỉ chạy trong `approve()`, tức bước duyệt thứ hai của `PO_ABOVE`. Demo dùng PO dưới ngưỡng nên không gọi tới. Chi tiết: `00b` §5.2 | Vòng 3 · Cần đội chốt chính sách *"ai duyệt PO bao nhiêu tiền"* — câu hỏi kinh doanh, không phải kỹ thuật |
| B3 | `automation.service.js` không bọc `runWithTenant` ⇒ notification có `tenantId = null`, người dùng không thấy (F8) | **P0-5 đã đánh giá: không nằm trên luồng demo.** `checkAutoReorder` chạy từ `onOrderCompleted` trong request ⇒ đã có tenant context từ `authenticate`. Các job còn lại (morning briefing, thu nợ, payroll…) đã bị loại khỏi phạm vi | Vòng 3 · **Lưu ý:** P0-2 sẽ gọi từ cron ⇒ **P0-2 phải tự bọc `runWithTenant`** |
| B4 | Pattern `'po'` trong `db-agent.service.js:837` khớp chuỗi `"áo polo"` ⇒ route sai sang tra đơn nhập | Chỉ là lỗi phân loại intent, không có tác dụng phụ | Vòng 3 · Sửa 1 dòng: dùng `\bpo\b` hoặc bỏ khỏi substring |
| B5 | Gói `enterprise` có `price: 0` với `allowedModules: ["*"]` (`seed.js:351`) | Ảnh hưởng hiển thị giá, không ảnh hưởng logic | Pha 6 · Sửa seed, **không** chạy `db:seed` trên DB có dữ liệu thật |
| B6 | `LLM_PROVIDER=openai-compatible` nhưng `config/llm.js:138` hard-code URL Gemini | Vòng 2 chỉ dùng Gemini. Đã chốt "một đường LLM duy nhất" | Vòng 3 |
| B7 | `BCRYPT_ROUNDS` lệch: `auth`/`users` dùng 12, nhưng `seed.js:188` và `hr.service.js:49` dùng 10 | Bảo mật, không ảnh hưởng demo. Nhưng **không được coi là đã xong** — `hr.service.js:49` **bỏ qua biến môi trường** hoàn toàn | Vòng 3 · Sửa 2 dòng |
| B8 | Sai lệch README ↔ code (mục 3.7) | Theo kế hoạch cuối Vòng 2 sẽ có **một commit riêng** cập nhật README theo số đo từ code | Cuối Vòng 2 |
| B9 | `agent.cdc.js:49` truyền `vendorId: null` ⇒ nhánh LOW_STOCK chết (F1) | Sửa cùng P0-2 (đã gộp vào đề xuất gate) | Sau khi duyệt `00b` |
| B10 | `purchase.service.js:164,173` nuốt lỗi audit bằng `.catch(() => {})` | Nằm trên đường demo ⇒ **đề xuất sửa trong commit P0-3**, không để lâu | Cùng P0-3 |

**Đã được xử lý xong:** F1 → P0-2 (chờ duyệt `00b`) · F2 → P0-3 (chờ duyệt `00b`) · F3 phần `db-agent` → **P0-1 xong** (commit `761ea52`) · F3 phần `/api/agent/chat` → **đã kiểm tra, không phải lỗ hổng** (xem mục 8) · nhãn `LLM_CALL` sai → **xong** (commit `ef1c15f`) · ngưỡng tồn thấp 5 kiểu → **P0-4 xong** (commit `64b7541`).

---

## 8. Kiểm tra bổ sung `/api/agent/chat` (yêu cầu mốc 2, mục 3.1)

**Kết luận: `/api/agent/chat` KHÔNG phải lỗ hổng như `db-agent`.** Đã kiểm chứng bằng HTTP thật, không chỉ đọc code.

| Câu hỏi | Trả lời | Bằng chứng |
|---|---|---|
| Route có `authorize` không? | **Không** — `router.post('/chat')` (`agent.routes.js:380`) không có `authorize` | đọc code |
| Nhưng intent ghi có bị kiểm tra quyền không? | **Có** — kiểm tra inline `['ADMIN','MANAGER']` tại `agent.routes.js:415` | đọc code |
| Thực tế thì sao? | **Đúng như mong đợi.** Gọi thật bằng token của `cashier@candory.com`: cả 3 intent ghi (`createOrder`, `createPO`, `sendReminder`) đều bị chặn, trả về *"Xin lỗi, bạn không có quyền thực hiện thao tác này. Chỉ ADMIN và MANAGER…"* | probe HTTP xem dưới |

**Hai khác biệt còn lại so với `db-agent` — không phải lỗ hổng, nhưng nên biết:**

1. **Role bị từ chối trả HTTP 200**, kèm câu từ chối trong nội dung — không phải 403. Đúng về mặt an toàn (không thực thi), nhưng đối tác gọi API không phân biệt được bằng mã trạng thái.
2. **Lần từ chối không được ghi audit.** `recordWriteAudit` chỉ chạy ở nhánh được phép (`agent.routes.js:422`), sau khi hành động đã xong và với `status: 'APPROVED'` cứng. Không có bản ghi cho *"CASHIER đã thử tạo PO và bị chặn"*.

### 8.1. Nhánh đọc dữ liệu nhạy cảm — P0-1 có làm hỏng không?

**Không.** Hai cơ chế hoàn toàn tách biệt:

| | Endpoint | `authorize` sau P0-1 | Luồng `buildDataRequestGate` |
|---|---|---|---|
| Tra cứu NL | `POST /api/db-agent/query` | ✅ có `READ_ROLES` | ❌ không dùng, đã read-only |
| Chat agent | `POST /api/agent/chat` | ❌ **không thêm** (giữ nguyên) | ✅ tạo gate PENDING cho role thấp |

Bằng chứng mạnh nhất: `npm run check:humangate` **PASS** sau P0-1 (§8.2) — đúng script đó chạy luồng `CASHIER hỏi "khách hàng" → bị chặn → tạo gate PENDING → ADMIN duyệt`.

### 8.2. Baseline `check:humangate` (điều kiện trước khi merge P0-3)

Đã chạy với backend + DB thật trên nhánh hiện tại. **Baseline XANH.**

```
=== TẤT CẢ PASS ===
OK | Role CASHIER bị chặn, không lộ dữ liệu nhạy cảm → HTTP 200
OK | Trả lời không chứa SĐT khách hàng → không lộ PII
OK | Tạo được gate mới → 1 gate mới
OK | actionSummary không rỗng (bug PrismaClientValidationError cũ)
OK | triggerRule = SENSITIVE_TOOL_ROLE_GATE
OK | CASHIER không tự duyệt được (403) → HTTP 403
OK | ADMIN duyệt được (200) → HTTP 200
OK | status chuyển sang APPROVED
OK | ghi decidedAt + decidedById + decisionNote (đúng tên field schema)
OK | Duyệt lần 2 bị từ chối (400)
OK | Gate đã xử lý không còn trong danh sách PENDING
```

→ Sau khi P0-3, chạy lại; **đỏ ⇒ lỗi do P0-3**.

Lệnh để đội chạy lại: mở cửa sổ khác chạy `npm run dev`, rồi `npm run check:humangate`.

### 8.3. Frontend có phụ thuộc `/api/db-agent/*` không?

**Không.** Quét toàn `frontend/src`: chỉ 3 nơi gọi API agent —
`components/agent-ui/CRMActionCard.jsx:35` và `ERPAssistantWidget.jsx:51` gọi `/agent/chat`;
`components/agent-ui/SmartApprovalCard.jsx:37` gọi `/api/agent/human-gates/:id/decide`.
Không chỗ nào gọi `/api/db-agent/query` hay `/api/db-agent/tools`.
→ Việc gỡ write tool khỏi danh mục `/tools` và thêm `executableHere` **không làm vỡ UI nào**.

