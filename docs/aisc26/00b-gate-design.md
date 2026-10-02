# 00b — Note thiết kế: human-gate có hiệu lực cho PO (P0-3)

**Trạng thái:** CHỜ ĐỘI DUYỆT — chưa viết code.
**Ngày:** 2026-10-02 (bản 2) · **Nhánh:** `round2/p0-hardening`
**Bối cảnh:** phát hiện F2 ở `docs/aisc26/00-scope.md`.

**Quyết định đã chốt (phản hồi mốc 2):**
- Chỉ thêm **một** cột `resultRef String?` — **bỏ `executedAt`**, nullable, additive, một migration, triển khai bằng `npm run db:migrate:deploy`.
- **Giữ 2 lớp duyệt tách biệt** — không gộp.
- Vì bỏ `executedAt`, phải chặt ở trạng thái thất bại → xem mục 3.4.
- Luồng demo **không được bắt duyệt hai lần** cho một PO → xem mục 5.3.

**Chưa duyệt:** phần còn lại của note. **Không viết code P0-3 cho tới khi có xác nhận.**

---

## 1. Vấn đề cần giải

`AgentHumanGate` hôm nay là **audit + thông báo**, không phải approval có hiệu lực:

| Builder | Status | Chặn hành động? |
|---|---|---|
| `buildDataRequestGate` (`agent.humangate.js:46`) | `PENDING` | ✅ Chặn **đọc** dữ liệu nhạy cảm |
| `buildReminderGate` (`:73`) | `PENDING` | ⚠️ Ghi nhận, nhưng tin đã gửi trước đó |
| `buildWriteActionGate` (`:60`) | **`APPROVED` cứng** (`:66`) | ❌ Ghi **sau khi** hành động đã xong |

Thêm: `POST /human-gates/:id/decide` khi `APPROVED` chỉ đóng `AgentSession` (`agent.routes.js:621-628`), **không thực thi** gì.

Mục tiêu: PO do agent đề xuất phải **không tồn tại cho tới khi có người bấm duyệt**.

---

## 2. Dữ liệu gate lưu gì — và có cần model mới không?

### Không cần model mới.

`AgentHumanGate` **đã có đủ cột**: `actionType`, `actionPayload` (Json), `actionSummary`, `triggerRule`, `status`, `decidedById`, `decisionNote`, `decidedAt`, `expiresAt`, `tenantId`, `sessionId`.

### Nhưng cần sửa 3 điểm:

**(a) `sessionId` là bắt buộc + `onDelete: Cascade`** → đề xuất từ CDC (không có phiên chat) cũng cần gate.
→ **Không đổi schema.** Tạo một `AgentSession` tổng hợp với `triggerSource: 'SYSTEM_EVENT'` (giá trị này **đã có** trong schema, `AgentSession.triggerSource`) rồi tạo gate trỏ vào. Đây đúng mô hình CDC vốn dùng.

**(b) Thiếu chỗ ghi "gate này đã sinh ra PO nào"** → không hiển thị được "duyệt xong ra PO-2026...-0001", và khó kiểm chứng trong demo.
→ Đã chốt: thêm **1 cột nullable**:

```prisma
model AgentHumanGate {
  // ... các cột hiện có
  resultRef   String?   // PurchaseOrder.id — KHÔNG có cột executedAt (đã chốt bỏ)
}
```

Không thêm `executedAt`, không thêm index. Hệ quả: **phải xử lý trạng thái thất bại bằng state machine, không dựa vào mốc thời gian** → mục 3.4.

**(c) Không có trường nào chặn "đề xuất lỗi thời".** Đề xuất được tạo lúc T với ATP = 12; đến T+3h người duyệt thì ATP đã = 2.
→ Giải quyết trong payload, **không cần cột mới**: `inputFingerprint` (hash của ATP + ROP + đơn giá tại thời điểm đề xuất). Lúc duyệt, tính lại và so.

### Payload chuẩn cho đề xuất PO

```jsonc
{
  "kind": "PURCHASE_ORDER_PROPOSAL",
  "vendorId": "...", "vendorName": "...",
  "items": [{ "productId": "...", "sku": "...", "name": "...",
              "quantity": 24, "unitCost": 45000 }],
  "expectedAt": "2026-10-10",
  "totalEstimate": 1080000,
  // chặn spam đề xuất (yêu cầu mục 3 của đội): mỗi (SKU, NCC) chỉ 1 đề xuất mở
  "proposalKey": "PROP:<productId>:<vendorId>",
  // phát hiện đề xuất đã lỗi thời lúc duyệt
  "inputFingerprint": "sha256(ATP|ROP|unitCost|...)",
  // mọi con số ở đây do công thức tính, KHÔNG do LLM sinh ra
  "rationale": {
    "atp": 12, "rop": 30, "demandPerDay": 2.1, "leadTimeDays": 7,
    "leadTimeEstimated": true, "stockoutInDays": 5.7, "method": "moving-average-28d"
  }
}
```

`rationale` là thứ **chỉ để hiển thị cho người duyệt**. Executor **không** tính lại từ `rationale` — nó chỉ dùng `items` đã chốt.

---

## 3. Cơ chế resume

```
người duyệt bấm APPROVED
        ↓
[1] Đảo trạng thái NGAY, nguyên tử, có điều kiện:
      updateMany({ where:{ id, status:'PENDING' }, data:{ status:'APPROVED', ... } })
      count !== 1  → 409 "gate đã được xử lý" (dừng, không tạo PO)
        ↓
[2] Kiểm tra lại (mục 4)
        ↓
[3] purchaseService.create(payload.items, userId = người duyệt)
        ↓
[4] Ghi executedAt + resultRef, audit log, notification
```

Ba điều bất di bất dịch:

1. **Không có đường tắt.** Executor **bắt buộc** gọi `purchase.service.create` — không được `prisma.purchaseOrder.create`. Nhờ vậy PO tự động có audit log, workflow `PO_ABOVE`, mã `PO-YYYYMMDD-XXXX` có `withCodeRetry`, và bắt buộc có `vendorId`.
2. **`userId` = người duyệt**, không phải "system". PO phải ghi đúng ai đã bấm.
3. **Đảo trạng thái trước, thực thi sau** — xem 3.4.

### 3.4. Trạng thái thất bại (quan trọng — vì đã bỏ `executedAt`)

Tình huống cần trả lời rõ: `updateMany` đã giành được quyền (`status` đã thành `APPROVED`) nhưng `purchase.service.create` **ném lỗi**.

**Đề xuất: đưa `purchase.service.create` vào cùng transaction với lần ghi `resultRef`.**

```js
const po = await prisma.$transaction(async (tx) => {
  const created = await purchaseService.create(payload.items, decidedById, { tx });
  await tx.agentHumanGate.update({
    where: { id: gateId },
    data: { resultRef: created.id },
  });
  return created;
});
```

Nhưng `purchase.service.create` **hiện không nhận `tx`** — nó tự gọi `prisma.purchaseOrder.create` và `auditService.log` (dòng 134, 164). Đây là **một thay đổi cần đội duyệt thêm**, vì nó chạm `purchase.service`.

**Ba phương án, xếp theo mức độ cần sửa code:**

| | Cách | Cần sửa | Đánh giá |
|---|---|---|---|
| **A** (khuyến nghị) | Bọc transaction: sửa `purchase.service.create` nhận tham số `{ tx }` tuỳ chọn, mặc định `prisma` | thêm 1 tham số tuỳ chọn, không đổi hành vi call site cũ | **Sạch nhất.** PO và `resultRef` cùng thành công hoặc cùng hỏng. Không cần `executedAt`. |
| **B** | Không sửa `purchase.service`. Ghi `APPROVED` + `decisionNote` kiểu `THỰC THI LỖI: <msg>`, để `resultRef = null` | không sửa service | Kém hơn: có khoảnh khắc PO tồn tại mà `resultRef` chưa ghi. Khoảnh khắc đó rất ngắn và chỉ xảy ra khi lỗi, nhưng là **cửa sổ không khép kín**. |
| **C** | Thêm cột `executionError String?` | 1 migration | **Không dùng** — thêm cột chỉ để ghi lỗi là xấu; lỗi thuộc về `decisionNote` + audit log. |

**Chốt theo đội: phương án A, kèm điều kiện bắt buộc.**

Với phương án A, nếu transaction rollback thì **trạng thái gate vẫn là `APPROVED` với `resultRef = null`** — vì `status` được ghi ở *request trước*, ngoài transaction. Đây là khoảng trạng thái cần xử lý tường minh:

| Quy tắc | Nội dung |
|---|---|
| Nhận diện | `status = APPROVED` **và** `resultRef = null` **và** `decidedAt` trong 5 phút gần nhất ⇒ **"đã duyệt, đang thực thi / thực thi lỗi"**. Không phải "đã xong". |
| Hiển thị UI | Hiện cảnh báo đỏ *"Đã duyệt nhưng chưa tạo được PO — cần thử lại"*, kèm `decisionNote`. **Không** hiện như đã hoàn tất. |
| Audit | Bắt buộc ghi `AGENT_PO_GATE_EXECUTION_FAILED` với `gateId`, `decidedById`, message lỗi. **Không** dùng `.catch(() => {})` (quy ước `AGENTS.md`). |
| Thử lại | **Thao tác có chủ đích.** Endpoint riêng `POST /human-gates/:id/retry-execution`, `authorize(ADMIN, MANAGER)`, chạy lại executor. Không có cron, không có tự động retry — PO là hành động tài chính, tự retry là điều không được phép. |
| Chống chạy đôi | `retry` cũng dùng atomic `updateMany` với điều kiện `status='APPROVED' AND resultRef IS NULL` ⇒ `count=0` nghĩa là đã có người thắng. |
| Điều kiện duy nhất để retry | `resultRef IS NULL`. Không kiểm tra hạn (đã APPROVED thì hạn không còn ý nghĩa), nhưng **phải** chạy lại toàn bộ re-validation ở mục 4 — dữ liệu đã cũ hơn. |

**Nếu đội không muốn đụng `purchase.service`:** phương án B vẫn chấp nhận được, nhưng phải ghi rõ trong báo cáo giới hạn *"khoảnh khắc gate APPROVED nhưng PO chưa ghi resultRef là trạng thái cần người kiểm tra"* — và thêm test cho nó.

---

## 4. Kiểm tra lại lúc duyệt (re-validation)

Không được tin payload cũ. Trước khi gọi `create`, kiểm tra:

| # | Kiểm tra | Hành động nếu fail |
|---|---|---|
| 1 | Gate còn `PENDING` (đã xử lý ở bước [1] bằng atomic update) | 409 |
| 2 | Chưa quá `expiresAt` | 400 |
| 3 | NCC còn tồn tại và `isActive` | 400 "NCC không còn hợp lệ" |
| 4 | `inputFingerprint` khớp tính lại từ DB | **409, chặn**, kèm diff ATP cũ/mới. Không có đường override tự động |
| 5 | `(productId, vendorId)` không còn đề xuất `PENDING` khác | 409 |
| 6 | Tổng tiền > 0, mọi dòng có `productId` + `quantity > 0` | 400 |

Điểm 4 là điểm quan trọng nhất: **ATP thay đổi là lý do chính khiến một đề xuất nhập hàng trở nên sai**. Người duyệt phải thấy "lúc đề xuất còn 12, giờ còn 2" rồi tự quyết, chứ hệ thống không được âm thầm tạo PO.

**Idempotent:** bấm duyệt 2 lần → `updateMany` lần 2 có `count = 0` → 409, **không tạo PO thứ hai**.

---

## 5. Quyền duyệt & ngưỡng — đề xuất TÁCH

Repo đang có **hai ngưỡng mâu thuẫn**: `getPoApprovalThreshold()` đọc `companySettings.poApprovalThreshold` (mặc định 5tr, quyết định `DRAFT` vs `PENDING_APPROVAL`) và `PO_APPROVE_THRESHOLD = 50_000_000` hard-code (quyết định ai được duyệt, `purchase.service.js:45,243`). Thêm ngưỡng thứ ba ở gate làm tệ hơn.

**Đề xuất: gate KHÔNG có ngưỡng tiền riêng.**

| Lớp | Câu hỏi | Cơ chế | Ngưỡng |
|---|---|---|---|
| `AgentHumanGate` | "Agent có được tạo PO này không?" | Người bấm duyệt — `ADMIN`/`MANAGER` | Không có (quyết định của người) |
| `workflow PO_ABOVE` | "PO này có cần quản lý duyệt tiếp không?" | Đã có, `purchase.service.js:178` | `companySettings.poApprovalThreshold` |

Mỗi lớp trả lời **một câu hỏi khác nhau**, không chồng lấn. Luồng: CDC → đề xuất → gate PENDING → ADMIN/MANAGER duyệt → `purchase.service.create` → hàm này tự tính `needsApproval` và bắn `PO_ABOVE` nếu vượt ngưỡng. **Không gộp, không thêm ngưỡng mới.**

**Một câu để nói trên slide:**
> Gate hỏi *"có cho phép AI tạo PO này không"* — con người trả lời.
> `PO_ABOVE` hỏi *"PO này có cần duyệt tài chính tiếp không"* — ngưỡng tiền trả lời.

### 5.2. Hai ngưỡng mâu thuẫn đã tìm thấy — xử lý thế nào

| Ngưỡng | Vị trí | Dùng để | Vấn đề |
|---|---|---|---|
| `companySettings.poApprovalThreshold` (mặc định 5.000.000) | `purchase.service.js:34-40` | Quyết định PO tạo ra là `DRAFT` hay `PENDING_APPROVAL` | Đọc từ settings ✅ |
| `PO_APPROVE_THRESHOLD = 50_000_000` | `purchase.service.js:45`, dùng ở `:243` | Quyết định **ai** được duyệt: dưới ngưỡng thì role nào cũng duyệt, từ ngưỡng trở lên phải `ADMIN`/`MANAGER` | **Hard-code, không đọc settings** ❌ |

**Trả lời câu hỏi của đội: `PO_APPROVE_THRESHOLD` có nằm trên luồng demo không?**

- **Không nằm trên luồng demo.** Nó chỉ chạy trong `purchase.service.approve()` (`:237-265`) — tức bước duyệt **thứ hai** của `PO_ABOVE`. Luồng demo Vòng 2 dừng ở bước gate và dùng kịch bản PO **dưới ngưỡng** (mục 5.3), nên `approve()` không được gọi.

**→ Đề xuất: ghi backlog, không sửa ở Vòng 2.** Lý do: sửa nó là đổi hành vi phân quyền của một endpoint khác (`POST /purchase-orders/:id/approve`), nằm ngoài luồng demo, và cần đội thống nhất chính sách *"ai được duyệt PO bao nhiêu tiền"* — đó là câu hỏi kinh doanh, không phải kỹ thuật.

**Nhưng phải nói thẳng trong tài liệu:** trước khi sửa, cơ chế phân quyền duyệt PO **không nhất quán với cấu hình của tenant**. Đây là hạn chế đã biết, không phải bí mật. Nếu muốn sửa: một commit riêng, đọc `getPoApprovalThreshold()`, kèm test cho cả hai vế ngưỡng.

### 5.3. Ràng buộc cho kịch bản demo: không được duyệt hai lần

Để khỏi trả lời câu *"vậy phải bấm duyệt 2 lần à?"*:

| Kịch bản | Hành vi | Cách đạt |
|---|---|---|
| **PO dưới ngưỡng `PO_ABOVE`** *(kịch bản dùng cho demo)* | 1 lần duyệt: gate → PO `DRAFT`, xong | Demo chọn nhóm SKU nhỏ để tổng PO < `poApprovalThreshold` |
| PO từ ngưỡng trở lên | 2 lớp: gate duyệt (cho phép tạo) → PO `PENDING_APPROVAL` → `PO_ABOVE` duyệt tài chính | Hợp lệ, có chủ đích |

**Cách duy trì bảo mật cho kịch bản 1 bước:** demo dùng PO nhỏ, nhưng **không được** hạ ngưỡng trong settings để "cho dễ". Ngưỡng lấy nguyên từ `companySettings`; nếu cần PO nhỏ thì **chọn SKU rẻ**, không chỉnh ngưỡng.

**Phải ghi trong tài liệu, không được che:**
> "PO vượt `poApprovalThreshold` của công ty sẽ có thêm một bước duyệt tài chính nữa. Chúng tôi giữ cả hai lớp vì chúng trả lời hai câu hỏi khác nhau; đây là kiểm soát, không phải trùng lặp."

---

## 6. Ai được phép duyệt

### 6.1. Xem danh sách gate

`GET /human-gates` — giữ nguyên `authorize('ADMIN', 'MANAGER')` (`agent.routes.js:588`). Đã đúng.

### 6.2. Quyết định gate

`POST /human-gates/:id/decide` — giữ `authorize('ADMIN', 'MANAGER')` (`agent.routes.js:602`).

**Không thêm ngưỡng tiền cho quyền duyệt gate** (lý do ở mục 5). Bảng quyền:

| Role | Xem gate | Duyệt gate đồ nhạy cảm (`DATA_REQUEST`) | Duyệt đề xuất PO | Thử lại thực thi lỗi |
|---|---|---|---|---|
| `SUPER_OMEGA_ULTRA_ADMIN` | ✅ | ✅ | ✅ | ✅ |
| `ADMIN` | ✅ | ✅ | ✅ | ✅ |
| `MANAGER` | ✅ | ✅ | ✅ | ✅ |
| `ACCOUNTANT` | ❌ | ❌ | ❌ | ❌ |
| `CASHIER` / `WAREHOUSE` / `SALE` | ❌ | ❌ | ❌ | ❌ |

**Hai điểm chống lạm dụng cần ghi rõ:**

1. **Không cho người đề xuất tự duyệt.** Nếu đề xuất do người dùng `U` gửi (trigger `USER_CHAT`), thì `decidedById` phải khác `session.userId`. Nếu do CDC/system gửi (`SYSTEM_EVENT`), không có người đề xuất nên không áp dụng. Đề xuất PO là hành động tài chính — tách người đề xuất và người ký là nguyên tắc bốn mắt, áp dụng được ở Vòng 2 với chi phí gần bằng 0.
2. **`ACCOUNTANT` không được duyệt gate PO** dù có vai trò tài chính, vì quyết định "mua bao nhiêu" là quyết định vận hành; quyết định "cho thanh toán" là quyết định tài chính. Việc này hiện nằm ở `PO_ABOVE` (`purchase.service.js:243` yêu cầu `ADMIN`/`MANAGER`). **Điểm này cần đội xác nhận** vì có thể mâu thuẫn với cách họ tổ chức quy trình thật.

## 7. Nhánh REJECTED và hết hạn

### 7.1. REJECTED

| Việc | Cách làm |
|---|---|
| Ghi quyết định | `buildDecisionData({ decision: 'REJECTED', note, userId })` — có sẵn |
| Tạo PO | **Không.** `REJECTED` là terminal, executor không bao giờ chạy |
| `decisionNote` | **Bắt buộc có lý do.** UI chặn submit rỗng. Người duyệt nói "không" mà không nói vì sao thì người sau không sửa được |
| Audit | `AGENT_PO_GATE_REJECTED` |
| Đóng đề xuất để CDC sinh lại | **Có**, nhưng có điều kiện: chỉ mở lại nếu (a) đã qua ≥ 24h kể từ lúc reject, **và** (b) ATP vẫn ≤ ROP. Tránh lặp vô hạn mỗi lần CDC bắn |

### 7.2. Hết hạn

- `sweepExpiredHumanGates()` (`agent.humangate.js:126`) đã có, cron `*/5` (`cron.js:84-93`), có `@@index([status, expiresAt])`. **Tái dùng, không viết mới.**
- Cron này chạy **ngoài tenant context** (`updateMany` không có `where tenantId`) → quét mọi tenant một lượt. Đúng cho sweep hết hạn, không phải lỗi.

**TTL riêng theo loại** — `GATE_TTL_MS` hiện là 24h cho mọi gate (`agent.humangate.js:32`). Với đề xuất PO, 24h là dài: tồn kho đã đổi nhiều, và re-validation sẽ chặn gần hết. Đề xuất:

| Loại gate | TTL | Lý do |
|---|---|---|
| `DATA_REQUEST` | 24h (giữ nguyên) | Dữ liệu nhạy cảm vẫn nhạy cảm sau một ngày |
| `PURCHASE_ORDER_PROPOSAL` | **8h** | Quá 8h thì fingerprint lệch gần như chắc chắn; người duyệt thà tạo lại đề xuất mới còn hơn duyệt cái cũ |

Hết hạn = `EXPIRED`, terminal, không executor. Người duyệt thấy `EXPIRED` thì bấm "Sinh lại đề xuất" (tạo gate mới), không retry được vì chưa từng được duyệt.

---

## 8. Audit log

Ghi qua `auditService.log` sẵn có, **không** dùng `.catch(() => {})` (quy ước `AGENTS.md`):

| Action | `entityId` | Ghi kèm |
|---|---|---|
| `AGENT_PO_PROPOSED` | `gateId` | payload + rationale |
| `AGENT_PO_GATE_APPROVED` | `gateId` | payload, fingerprint cũ/mới, PO id tạo ra |
| `AGENT_PO_GATE_REJECTED` | `gateId` | `decisionNote` (bắt buộc có) |
| `AGENT_PO_GATE_EXPIRED` | `gateId` | do cron sweep ghi, không cần hành động người |
| `AGENT_PO_GATE_EXECUTION_FAILED` | `gateId` | `decidedById`, message lỗi — **bắt buộc**, đây là dấu vết của khoảng trạng thái mục 3.4 |
| `CREATE_PURCHASE_ORDER` | `poId` | **đã có** sẵn trong `purchase.service:164` |

Cần trả lời được câu *"ai đề xuất, ai duyệt, lúc nào, dựa trên số liệu nào"* bằng **truy vấn được**, không phải bằng lời.

**Quy tắc bắt buộc:** không dùng `.catch(() => {})` (quy ước `AGENTS.md`). Lỗi audit phải `logger.error` + **làm rõ hành động đã xảy ra hay chưa**. Hiện `purchase.service.js:164,173` đang nuốt lỗi — nằm ngay trên đường demo ⇒ **đề xuất sửa trong cùng commit P0-3**, tách bạch khỏi thay đổi hành vi.

---

## 9. Schema & migration

| Hạng mục | Kết luận |
|---|---|
| Model mới | **Không** |
| Cột mới | `AgentHumanGate.resultRef String?` — **1 cột, nullable, additive, không backfill**. Không `executedAt` (đã chốt). |
| Migration | Một file duy nhất, chạy bằng **`npm run db:migrate:deploy`** |
| Cấm | **`npm run db:migrate`** — repo có bảng RAG vector tại `prisma/migrations/20260620100000_add_ai_vector_tables/migration.sql` (đã kiểm tra) → `migrate dev` có nguy cơ sinh `ALTER` phá `real[]`/`vector` |
| `TENANT_SCOPED_MODELS` | `AgentHumanGate` **đã có** sẵn (`src/config/prisma.js:79`), `AgentSession` ở `:78` → không sửa |
| Contract test | `tests/tenant-scoped-models.contract.test.js` phải xanh sau migration (thêm cột nullable không đổi tập model) |
| Gộp với `LlmUsageLog`? | **Khuyến nghị gộp** vào một migration duy nhất (xem `01-llm-role.md` §4.4) để chỉ deploy một lần. `LlmUsageLog` có `tenantId` nên **phải** thêm vào `TENANT_SCOPED_MODELS`. |

> Ghi chú: khi đã bỏ `executedAt`, trạng thái "đã duyệt nhưng chưa tạo được PO" nhận diện bằng **`resultRef IS NULL`**, không bằng mốc thời gian. Mọi test và UI đều dựa vào điều kiện này.

---

## 10. Contract test bắt buộc

Yêu cầu của đội: **write tool không thực thi được nếu chưa có `APPROVED`**.

| # | Test | Chứng minh |
|---|---|---|
| 1 | Executor gọi với gate `PENDING` | throw, `purchaseService.create` **0 lần** |
| 2 | Executor gọi với gate `REJECTED` / `EXPIRED` / `CANCELLED` | throw, 0 lần |
| 3 | Bấm duyệt 2 lần song song | đúng 1 PO (`updateMany.count === 1` ở đúng một lần) |
| 4 | Fingerprint lệch (ATP đã đổi) | 409, 0 lần, trả về diff |
| 5 | NCC bị vô hiệu hoá sau khi đề xuất | 400, 0 lần |
| 6 | `purchase.service.create` ném lỗi | gate `APPROVED` + `resultRef = null`; audit có `AGENT_PO_GATE_EXECUTION_FAILED`; **không** trả `success: true` giả |
| 7 | Executor chạy **ngoài** tenant context | không đọc/ghi được dữ liệu tenant khác |
| 8 | **Người đề xuất bấm duyệt chính đề xuất của mình** | 403 (mục 6.2, điểm 1) |
| 9 | `REJECTED` không tạo PO, `decisionNote` rỗng bị chặn | 400, 0 lần |
| 10 | Gate quá hạn bấm duyệt | 400, 0 lần |
| 11 | `retry-execution` chạy 2 lần song song | đúng 1 PO (điều kiện `resultRef IS NULL`) |
| 12 | `retry-execution` khi `resultRef` đã có | 409, 0 lần |
| 13 | `POST /query` của `db-agent` không tạo được gate PO | Write tool vẫn bị chặn (bảo đảm P0-1 không bị lấn) |
| 14 | Tenant A không thấy gate của tenant B | `findUnique` không tự chặn ⇒ phải có `where: { id, tenantId }` |

Test 1, 2 và 14 là trái tim: 1–2 biến "gate là trang trí" thành "gate là ràng buộc"; 14 là cái duy nhất chứng minh gate cũng cách ly tenant như phần còn lại hệ thống.

**Cảnh báo về test 14:** `prisma.agentHumanGate.findUnique({ where: { id } })` — cách dùng hiện tại ở `agent.routes.js:611` — **không** tự giới hạn theo tenant. Prisma extension chỉ can thiệp `findMany`/`updateMany`/`create`, không can thiệp `findUnique` với `where` chỉ có `id`. Đây là điểm cần sửa kèm P0-3.

---

## 11. Phạm vi code dự kiến (sau khi duyệt)

| File | Việc |
|---|---|
| `src/modules/ai/agent.humangate.js` | thêm `buildPoProposalGate` (PENDING) + TTL riêng 8h cho PO; giữ nguyên 3 builder cũ |
| `src/modules/ai/agent.gate.exec.js` **(mới)** | `executeGate(gateId, decidedById)` — re-validation + `purchase.service.create`; `retryExecution(gateId, decidedById)` |
| `src/modules/ai/agent.routes.js` | `decide` → atomic `updateMany` + `where: { id, tenantId }`; thêm nhánh resume; thêm `POST /human-gates/:id/retry-execution` |
| `src/modules/accounting/purchase.service.js` | `create(data, userId, { tx })` — tham số tuỳ chọn cho mục 3.4 phương án A; bỏ `.catch(() => {})` ở `:164,173` |
| `prisma/schema.prisma` + 1 migration | 1 cột `resultRef` |
| `tests/agent-gate-po.contract.test.js` **(mới)** | 14 test ở mục 10 |

**Không** đụng: `automation.service.js` (P0-2 làm riêng), `smart-guide`, `ai-forecast`, adapter marketplace.

> **Cảnh báo phạm vi:** `purchase.service.js` là file thứ 4 bị đụng, ngoài `modules/ai/`. Đề nghị đội xác nhận riêng việc cho phép thêm `{ tx }` vào `purchase.service.create`, vì đó là thay đổi nằm ngoài module agent.

---

## 12. Câu hỏi còn chờ đội quyết định

*(Câu 1 và 2 đã chốt ở đầu note — không hỏi lại.)*

1. **Phương án xử lý thất bại:** phương án **A** (sửa `purchase.service.create` nhận `{ tx }`, bọc transaction) hay **B** (không sửa service, chấp nhận khoảng trạng thái `APPROVED` + `resultRef = null` phải có người kiểm tra)? Mục 3.4. **Khuyến nghị A.**
2. **`ACCOUNTANT` có được duyệt đề xuất PO không?** Mục 6.2 điểm 2 — hiện đề xuất là **không**.
3. **Chốt tách người đề xuất / người duyệt** (mục 6.2 điểm 1)? Đề nghị **có** cho `USER_CHAT`, không áp dụng cho `SYSTEM_EVENT`.