# 00b — Note thiết kế: human-gate có hiệu lực cho PO (P0-3) — **BẢN 3**

**Ngày:** 2026-10-02 · **Nhánh:** `round2/p0-hardening`
**Trạng thái:** đội đã duyệt **có điều kiện**; bản 3 thực hiện các sửa đổi của mốc 4.

> **⚠️ ĐIỀU KIỆN DỪNG (mục 6 của phản hồi) ĐÃ KÍCH HOẠT.**
> Hướng "bọc toàn bộ trong một interactive transaction" (mục 2 của bản này) **không khả thi
> với `purchase.service.create` hiện tại**. Bằng chứng ở mục 3. Vì vậy bản 3 dùng
> **phương án dự phòng (A′)** mà đội đã định sẵn, với đúng hai sửa đã nêu.
> Phần code chưa viết cho tới khi đội xác nhận chọn A′ hay yêu cầu tái cấu trúc.

---

## 1. Các quyết định đã chốt

| # | Vấn đề | Quyết định |
|---|---|---|
| a | Xử lý thất bại | **Phương án A′** (bản 2 phương án A, đã sửa) — xem mục 3. Lý do bắt buộc ở mục 3. |
| b | `ACCOUNTANT` duyệt đề xuất PO? | **KHÔNG.** Chỉ `ADMIN` / `MANAGER` / `SUPER_OMEGA_ULTRA_ADMIN`. Đây là mặc định Vòng 2, sau này có thể cấu hình. Lý do: quyết định *mua bao nhiêu* là quyết định vận hành; quyết định *cho thanh toán* là quyết định tài chính. |
| c | Tách người đề xuất / người duyệt | **KHÔNG chặn cứng.** Cho tự duyệt, nhưng audit log **bắt buộc** ghi `selfApproved: true/false` (so `decidedById` với `session.userId`). |

**Về (c) — đồng ý với đội, và đây là bài học tôi đã sai:**

Nhận xét "chi phí gần bằng 0" của tôi chỉ đúng khi tenant có **tối thiểu hai người có quyền duyệt**. Khách hàng mục tiêu là shop SME, rất nhiều trường hợp **một chủ shop duy nhất là `ADMIN`**. Chặn cứng nghĩa là tính năng vô dụng đúng với nhóm chính.

| Nguồn đề xuất | Có người đề xuất? | Xử lý |
|---|---|---|
| `SYSTEM_EVENT` (CDC — **luồng demo chính**) | Không | `selfApproved = false` theo cấu trúc |
| `USER_CHAT` (chủ shop chat với agent) | Có (`session.userId`) | So sánh với `decidedById`, ghi `selfApproved` |

**Hạn chế đã biết, ghi vào tài liệu:** *"chưa có tuỳ chọn bắt buộc bốn mắt cho tenant có nhiều người duyệt"*. Không phải lỗ hổng (vẫn có audit đầy đủ), là **giới hạn thiết kế** phải nói thẳng.

---

## 2. Phát hiện của đội về fingerprint là ĐÚNG — đã thay

Đội nói đúng: `hash(ATP | ROP | unitCost)` sẽ gần như **luôn** lệch.

ATP đổi **mỗi lần bán hàng**. Với SKU đang bán thật, vài phút sau là fingerprint khác ⇒ người duyệt gần như luôn nhận 409 ⇒ tính năng không dùng được. Tôi đã đề xuất và đội đã duyệt về nguyên tắc — rút lại.

**Đã thay bằng so sánh theo ngưỡng ý nghĩa** (đã code + 94 unit test, commit `cdda246`):

`replenishment.calc.js` → `evaluateProposalFreshness({ proposed, current, acknowledgeDrift })`

Tính lại từ DB lúc duyệt bằng **đúng hàm** `planReplenishment` của module replenishment — không tái tạo công thức ở chỗ khác.

| Kết quả | Điều kiện | Người duyệt được làm gì |
|---|---|---|
| `NO_LONGER_NEEDED` | ATP **mới** > ROP | Chỉ **Từ chối**. Không có đường override |
| `DRIFT_BLOCK` | Lệch > `QTY_DRIFT_TOL` (25%) hoặc `COST_DRIFT_TOL` (10%) | 409 + diff → gửi lại kèm `acknowledgeDrift: true`, hoặc Từ chối |
| `DRIFT_WARN` | Lệch nhỏ hơn ngưỡng | Duyệt được, kèm cảnh báo |
| `DRIFT_NONE` | Không lệch | Duyệt thẳng |

Sau khi `acknowledgeDrift`, `status` **vẫn là `DRIFT_BLOCK`** kèm `acknowledged: true` — để UI phân biệt được "đã vượt ngưỡng và đã được xác nhận" với "chưa ai xác nhận".

**Không phải override tự động:** người duyệt phải thấy diff và bấm xác nhận có chủ đích; server **vẫn tính lại** ở lần gọi thứ hai.

> ⚠️ Hai hằng số 25% / 10% là **mặc định chưa hiệu chỉnh, không có căn cứ thực nghiệm** — đã ghi rõ trong code. Sẽ xem lại sau backtest. **Không trích ra slide như kết quả đo.**

`inputFingerprint` bị loại khỏi payload. `rationale` (snapshot số lúc đề xuất) **giữ lại** cho phần hiển thị.

---

## 3. [BẮT BUỘC] Vì sao không thể bọc transaction — bằng chứng

Đội yêu cầu kiểm chứng 4 điểm trước khi chọn hướng. Kết quả:

### 3.1. `withCodeRetry` không thể chạy trong transaction — vấn đề cấu trúc

`purchase.service.create` gọi `withCodeRetry(generateCode, tx => ...)` (`purchase.service.js:131`). Hàm đó (`journal.service.js`) thử `fn(code)` tối đa 5 lần:

```js
for (let i = 0; i < maxRetries; i++) {
  const code = await generator();
  try { return await fn(code); }
  catch (err) {
    if (!isUniqueConstraintError(err)) throw err;   // ← chết ở đây
    ...
  }
}
```

Trong Postgres, một unique violation **abort toàn bộ transaction**; mọi câu lệnh sau đó trả `25P02` *"current transaction is aborted"*.

- Lần 1: `insert` va chạm `PO-YYYYMMDD-XXXX` → unique violation → **tx đã chết**.
- Lần 2: `generator()` gọi `tx.purchaseOrder.count()` → lỗi `25P02`.
- `isUniqueConstraintError(25P02)` = `false` → **`throw err` ngay**.

⇒ **Retry bên trong transaction là bất khả thi.** Cách đúng phải là bọc **cả transaction** trong retry — tức phải cấu trúc lại `create`, **không phải thêm một tham số tuỳ chọn**.

### 3.2. Side effect dùng `prisma` toàn cục ⇒ sống sót qua rollback

| Chỗ | Gọi gì | Vấn đề |
|---|---|---|
| `purchase.service.js:164` | `auditService.log(...)` | Dùng `prisma` toàn cục → connection khác → **ngoài tx** |
| `purchase.service.js:178` | `workflowService.trigger("PO_ABOVE", ...)` | `workflow.service` dùng `prisma` toàn cục → **ngoài tx** |

Khi tx rollback, hai bảng này **vẫn có dòng** ⇒ audit log và workflow run ghi nhận một PO **không tồn tại**.

Tệ hơn: `AuditLog.entityId` và `WorkflowRun.entityId` đều là `String` thuần, **không có khóa ngoại** tới `PurchaseOrder`. Nghĩa là nó **hỏng âm thầm** — không ném lỗi để bắt, chỉ phát hiện được khi đọc lại log.

⇒ Cần truyền `tx` vào `audit.service` và `workflow.service` (**2 module nữa**), hoặc dời cả hai ra **sau commit** (đổi hành vi mọi caller cũ).

### 3.3. Timeout

Prisma mặc định `maxWait: 2000ms`, `timeout: 5000ms`. Đủ cho một lần tạo PO, nhưng thêm vòng retry 5 lần có thể vượt. Phải nâng `timeout`.

### 3.4. Kết luận

**Điều kiện dừng mục 6 #1 ĐÃ BỊ KÍCH HOẠT.** `create` không thể tx-safe chỉ bằng tham số tuỳ chọn.

→ Dùng **phương án dự phòng A′** (mục 4). Nếu đội muốn giữ hướng transaction thì phải cấu trúc lại `create` + `audit.service` + `workflow.service` ⇒ **3 module**, cần phê duyệt riêng.

---

## 4. Phương án A′ — cơ chế resume và xử lý thất bại

### 4.1. Luồng

```
người duyệt bấm APPROVED
        ↓
[1] Đảo trạng thái NGAY, nguyên tử, có điều kiện:
      updateMany({ where:{ id, status:'PENDING' }, data:{ status:'APPROVED', ... } })
      count !== 1  → 409 (đã có người thắng)
        ↓
[2] Re-validation (mục 5) — gồm evaluateProposalFreshness
        ↓
[3] purchaseService.create(payload.items, decidedById)
        ↓
[4] update gate.resultRef = po.id
        ↓
    thành công: audit APPROVED, notification, trả mã PO cho UI
```

Ba điều bất di bất dịch:

1. **Không đường tắt.** Bắt buộc gọi `purchase.service.create` — không `prisma.purchaseOrder.create`. Nhờ vậy có audit, có workflow `PO_ABOVE`, có `withCodeRetry`, và bắt buộc có `vendorId`.
2. **`userId` = người duyệt**, không phải "system".
3. **Đảo trạng thái trước, thực thi sau** — hệ quả ở 4.2.

### 4.2. Trạng thái thất bại — hai sửa so với bản 2

Bản 2 tự mâu thuẫn: §3.4 nói "cửa sổ 5 phút", ghi chú §9 nói chỉ cần `resultRef IS NULL`. Đã bỏ cửa sổ 5 phút.

**Nhận diện duy nhất:**

```
actionType = 'PURCHASE_ORDER_PROPOSAL'  AND  status = 'APPROVED'  AND  resultRef IS NULL
```

Ba điều kiện **cùng lúc**. Hai điều kiện còn lại bắt buộc vì:
- `DATA_REQUEST` và các gate khác cũng có `resultRef = null` ⇒ **không được tính nhầm**. Đã có contract test cho việc này (mục 8 test #6b).
- `resultRef` có thể rỗng vì lý do khác (chưa bao giờ từng chạy) ⇒ phải thêm `actionType`.

| Quy tắc | Nội dung |
|---|---|
| Hiển thị UI | Cảnh báo đỏ *"Đã duyệt nhưng chưa tạo được PO — cần thử lại"*. **Không** hiện như hoàn tất. |
| Tuổi đề xuất | Hiện thời gian đã duyệt. Không dùng để quyết định. |
| Audit | Bắt buộc `AGENT_PO_GATE_EXECUTION_FAILED` kèm `gateId`, `decidedById`, message lỗi. **Không** `.catch(() => {})` |
| Thử lại | `POST /human-gates/:id/retry-execution`, `authorize(ADMIN, MANAGER)`. Điều kiện duy nhất: `status='APPROVED' AND resultRef IS NULL` ⇒ atomic `updateMany`, `count=0` nghĩa là đã có người thắng |
| Không tự retry | **Không cron, không tự động.** PO là hành động tài chính |
| Retry có chạy lại validation không | **Có, đầy đủ** — dữ liệu đã cũ hơn. Không kiểm tra hạn (đã APPROVED thì hạn không còn ý nghĩa) |

### 4.3. Schema

| Hạng mục | Kết luận |
|---|---|
| Model mới | **Không** |
| Cột mới | `AgentHumanGate.resultRef String?` — 1 cột, nullable, additive, không backfill |
| Migration | 1 file, chạy bằng **`npm run db:migrate:deploy`** |
| Cấm tuyệt đối | **`npm run db:migrate`** — repo có bảng RAG vector tại `prisma/migrations/20260620100000_add_ai_vector_tables/migration.sql` (đã kiểm tra) |
| Gộp `LlmUsageLog`? | **Khuyến nghị gộp** — một lần deploy. `LlmUsageLog` có `tenantId` ⇒ **phải** thêm vào `TENANT_SCOPED_MODELS` |
| `TENANT_SCOPED_MODELS` | `AgentHumanGate` đã có (`src/config/prisma.js:79`), `AgentSession` ở `:78` → không sửa |
| Contract test | `tests/tenant-scoped-models.contract.test.js` phải xanh |

---

## 5. Re-validation lúc duyệt

| # | Kiểm tra | Hành động nếu fail |
|---|---|---|
| 1 | Gate còn `PENDING` (atomic `updateMany` ở bước [1]) | 409 |
| 2 | Chưa quá `expiresAt` | 400 |
| 3 | NCC còn tồn tại và `isActive` | 400 |
| 4 | `evaluateProposalFreshness` (§2) | `NO_LONGER_NEEDED` → 409 không override; `DRIFT_BLOCK` → 409 + diff |
| 5 | Không còn đề xuất `PENDING` khác cho cùng `proposalKey` | 409 |
| 6 | Tổng tiền > 0, đúng một dòng hàng, `productId` + `quantity > 0` | 400 |

---

## 6. Chống trùng đề xuất — nguyên tử

`proposalKey` nằm trong JSON nên không có ràng buộc DB: hai sự kiện CDC đồng thời vẫn tạo hai đề xuất.

**Chọn `pg_advisory_xact_lock`** — không cần đổi schema:

```
BEGIN;
  SELECT pg_advisory_xact_lock(hashtext(tenantId || '::' || proposalKey));
  -- đếm gate PENDING có proposalKey này
  -- nếu = 0 thì tạo
COMMIT;
```

Khoá tự giải phóng khi transaction kết thúc ⇒ không cơ hội deadlock do khoá bị giữ lâu, không cần dọn khoá khi lỗi.

*(Phương án thay thế: partial unique index bằng SQL thô trong migration. Chọn phương án này vì không sửa schema — `AgentHumanGate` đã dùng một migration cho `resultRef`, tránh thêm.)*

**Đơn giản hoá có chủ đích:** payload có `items` là mảng nhưng khoá theo (SKU, NCC). **Chốt Vòng 2: mỗi đề xuất đúng một dòng hàng** (`items.length === 1`), không gộp theo NCC. Vì một `PurchaseOrder` mới đây đã là một PO đơn giản; gộp nhiều NCC vào một PO sẽ tạo đề xuất với `vendorId` không xác định.

---

## 7. TTL — giữ 24h, bỏ cơ chế TTL theo loại

Cửa hàng mở 8h sáng sẽ **không bao giờ** thấy đề xuất CDC sinh lúc 22h nếu TTL là 8h. Với §2 đã bảo vệ khỏi dữ liệu cũ, giữ nguyên `GATE_TTL_MS` = 24h.

**Bỏ** cơ chế TTL riêng theo loại ⇒ ít code hơn.
**Thay vào đó:** UI hiển thị **tuổi của đề xuất** (số giờ kể từ `createdAt`).

---

## 8. Quyền duyệt

`GET /human-gates`, `POST /human-gates/:id/decide`, `POST /human-gates/:id/retry-execution` → `authorize('ADMIN','MANAGER')`, giữ nguyên như hiện tại.

| Role | Xem gate | Duyệt PO | Duyệt `DATA_REQUEST` | Retry |
|---|---|---|---|---|
| `SUPER_OMEGA_ULTRA_ADMIN` | ✅ | ✅ | ✅ | ✅ |
| `ADMIN` / `MANAGER` | ✅ | ✅ | ✅ | ✅ |
| `ACCOUNTANT` | ❌ | ❌ | ❌ | ❌ |
| `CASHIER` / `WAREHOUSE` / `SALE` | ❌ | ❌ | ❌ | ❌ |

**Không có ngưỡng tiền cho quyền duyệt gate.** Lý do ở `00b` §5 bản 2 (giữ nguyên): hai lớp trả lời hai câu hỏi khác nhau — gate hỏi *"có cho phép AI tạo PO này không"*, `PO_ABOVE` hỏi *"PO này có cần duyệt tài chính tiếp không"*.

**Tự duyệt:** cho phép. Audit bắt buộc ghi `selfApproved` = (`decidedById === session.userId`) khi `triggerSource === 'USER_CHAT'`; `false` cho `SYSTEM_EVENT`.

---

## 9. Giữ nguyên hành vi các gate khác

Nhánh resume **chỉ kích hoạt** cho `actionType === 'PURCHASE_ORDER_PROPOSAL'`. Duyệt `DATA_REQUEST` và mọi gate hiện có phải chạy y như cũ.

`check:humangate` phải giữ **11/11** — đây là baseline đã đo (xem `00-scope.md` §8.2).

---

## 10. Bộ contract test

| # | Test | Chứng minh |
|---|---|---|
| 1 | Executor với gate `PENDING` | throw, `purchaseService.create` **0 lần** |
| 2 | Executor với `REJECTED` / `EXPIRED` / `CANCELLED` | throw, 0 lần |
| 3 | Duyệt 2 lần song song | đúng 1 PO (`updateMany.count === 1`) |
| 4a | `NO_LONGER_NEEDED` (ATP mới > ROP) | 409, 0 lần, **không** override được kể cả khi `acknowledgeDrift: true` |
| 4b | `DRIFT_BLOCK` chưa acknowledge | 409, 0 lần, trả diff |
| 4c | `DRIFT_BLOCK` + `acknowledgeDrift: true` | chạy được, số lượng lấy **số vừa tính lại** chứ không phải số cũ |
| 4d | Lệch nhỏ (`DRIFT_WARN`) | duyệt được, kết quả có cảnh báo |
| 5 | NCC bị vô hiệu hoá sau khi đề xuất | 400, 0 lần |
| 6 | `create` ném lỗi | gate `APPROVED` + `resultRef IS NULL`; audit `AGENT_PO_GATE_EXECUTION_FAILED`; **không** trả `success: true` |
| 6b | Gate `DATA_REQUEST` đã `APPROVED` (không phải đề xuất PO) | **không** bị tính nhầm là trạng thái lỗi |
| 7 | Executor ngoài tenant context | không đọc/ghi được dữ liệu tenant khác |
| 8 | Tự duyệt (`USER_CHAT`) | **được phép**, audit có `selfApproved: true` |
| 8b | Đề xuất `SYSTEM_EVENT` | `selfApproved: false` |
| 9 | `REJECTED` | không tạo PO; `decisionNote` rỗng bị chặn |
| 10 | Gate quá hạn bấm duyệt | 400, 0 lần |
| 11 | `retry-execution` 2 lần song song | đúng 1 PO |
| 12 | `retry-execution` khi `resultRef` đã có | 409, 0 lần |
| 13 | `POST /db-agent/query` không tạo được gate PO | Write tool vẫn bị chặn (bảo đảm P0-1 không bị lấn) |
| 14 | Va chạm mã PO trong retry | được thử lại đúng, không tạo 2 PO |
| 15 | Tạo 2 đề xuất song song cùng `proposalKey` | đúng **1** gate (kiểm `pg_advisory_xact_lock`) |
| 16 | **Hồi quy:** duyệt `DATA_REQUEST` | chạy y như cũ, `check:humangate` 11/11 |

**Đính chính so với bản 2:** bản 2 mục test #14 viết *"phải có `where: { id, tenantId }` vì `findUnique` không tự giới hạn"*. **Điều đó SAI.** Đã kiểm chứng bằng DB thật (commit `a758ce4`): `prisma.js:96` khai báo `READ_OPS` **bao gồm `findUnique`**, nên extension tiêm `tenantId` — `findUnique({where:{id}})` **được bảo vệ đúng**. `npm run check:tenant`: 11/11 pass. Yêu cầu sửa `where: { id, tenantId }` **không còn cần thiết về mặt an toàn**.

Điểm mới đáng biết: extension **ghi đè** `tenantId` trong `where` (`{ ...args.where, tenantId }` — `tenantId` spread sau nên thắng). Truyền `tenantId: B` trong khi context là A vẫn ra kết quả của A, **không phải `null`**. An toàn, nhưng dễ gây hiểu nhầm.

---

## 11. Phạm vi frontend

Demo cần một màn hình thật. **Nguyên tắc: sửa cái có sẵn, không dựng giao diện mới.**

### 11.1. 🐞 Bug sẵn có phải sửa trước

`frontend/src/components/agent-ui/SmartApprovalCard.jsx:40` gửi:

```js
await api.post(endpoint, { action, note: '' });
```

nhưng backend đọc `req.body.decision` (`agent.routes.js:605`). ⇒ `decision` là `undefined` ⇒ **400 "decision must be APPROVED or REJECTED"**.

→ **Thẻ duyệt hiện tại luôn lỗi.** Đã kiểm tra trực tiếp, chưa sửa (ngoài phạm vi commit này).
Ngoài ra `note: ''` — thiết kế mới yêu cầu `REJECTED` **bắt buộc có lý do**.

### 11.2. Danh sách file sẽ sửa

| File | Việc | Ước lượng |
|---|---|---|
| `components/agent-ui/SmartApprovalCard.jsx` | Sửa `{action}` → `{decision}`; bắt buộc nhập lý do khi từ chối; hiện tuổi đề xuất; hiện diff khi `DRIFT`; hiện mã PO sau khi duyệt | ~2 giờ |
| Trang danh sách gate (tìm chỗ render `SmartApprovalCard`) | Lọc theo `actionType`, hiện `rationale` (ATP/ROP/nhu cầu/lead time/cờ ước lượng), nút "Duyệt" / "Từ chối", badge cảnh báo `resultRef IS NULL` | ~3 giờ |
| `src/api/` (thêm hàm gọi gate) | `listGates`, `decide(gateId, decision, note, acknowledgeDrift)`, `retryExecution(gateId)` | ~30 phút |
| `i18n` | Chuỗi mới vào `locales/vi.json` + `en.json` | ~30 phút |

**Tổng ~1 ngày công.** Không cần trang mới — danh sách gate đã có `GET /human-gates`.

---

## 12. Phạm vi code dự kiến (sau khi đội xác nhận A′)

| File | Việc |
|---|---|
| `src/modules/ai/agent.humangate.js` | `buildPoProposalGate` (PENDING, TTL 24h) |
| `src/modules/ai/agent.gate.exec.js` **(mới)** | `executeGate(gateId, decidedById, { acknowledgeDrift })`; `retryExecution(...)` |
| `src/modules/ai/agent.routes.js` | `decide` → atomic `updateMany` + nhánh resume; thêm `POST /:id/retry-execution`; ghi `selfApproved` |
| `src/modules/replenishment/replenishment.suggest.js` **(mới)** | dựng đề xuất từ DB: `pg_advisory_xact_lock` + `planReplenishment` + `proposalKey` |
| `prisma/schema.prisma` + 1 migration | `resultRef`; gộp `LlmUsageLog` |
| `tests/agent-gate-po.contract.test.js` **(mới)** | 16 test mục 10 |
| `src/modules/accounting/purchase.service.js:164,173` | Bỏ `.catch(() => {})` → `logger.error` — **commit riêng**, không gộp thay đổi hành vi |

**Không** đụng `automation.service.js` (P0-2 riêng), `smart-guide`, `ai-forecast`, adapter marketplace.

> `purchase.service.create` **không** cần thêm `{ tx }` nữa — vì đã chọn A′. Diff nhỏ hơn nhiều so với hướng transaction.

---

## 13. Hạn chế đã biết (ghi thẳng vào tài liệu trình bày)

1. **Chưa có tuỳ chọn bốn mắt** cho tenant có nhiều người duyệt (mục 1).
2. **Trạng thái `APPROVED + resultRef IS NULL` tồn tại** — cần người kiểm, đã có nhãn cảnh báo đỏ và nút thử lại thủ công.
3. **`QTY_DRIFT_TOL` / `COST_DRIFT_TOL` chưa hiệu chỉnh** — mặc định 25% / 10%, không có căn cứ thực nghiệm.
4. **Adapter marketplace chưa chạy với credential thật** — luồng demo dùng file CSV.
5. **PO vượt `poApprovalThreshold` có thêm một bước duyệt tài chính.** Demo dùng PO dưới ngưỡng để chỉ một lần duyệt; ngưỡng lấy nguyên từ settings, **không hạ ngưỡng cho dễ** — chọn SKU rẻ thay thế.