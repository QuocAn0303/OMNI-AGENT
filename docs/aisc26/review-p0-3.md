# Review pack — P0-3 "đề xuất PO có hiệu lực, không có PO trước khi duyệt"

> Đọc trong ~10 phút. Mọi nhận định kèm lệnh đã chạy. Ô nào chưa đo thì ghi
> "chưa đo".
>
> Đây là hạng mục mà Ban Tổ chức nêu đích danh (luồng demo duy nhất:
> *cảnh báo sắp hết hàng → đề xuất đặt hàng → duyệt qua human-gate → tạo PO*).

---

## 1. Vấn đề đã sửa

Trước P0-3, `checkAutoReorder` (đường "tự động") gọi thẳng
`prisma.purchaseOrder.create` và tự đặt `status: 'APPROVED'` khi tổng tiền
< 5.000.000 — ngưỡng **hard-code**, không đọc `companySettings.poApprovalThreshold`.
Tức hệ thống **tự tạo PO đã được duyệt mà không ai bấm duyệt**. Đó là đường né
kiểm soát (ghi ở `00-scope.md` F2/F3).

Nay: mọi đường sinh PO đều đi qua **một** cơ chế — công thức tính số →
`AgentHumanGate` ở trạng thái `PENDING` → người duyệt → mới có PO.

## 2. Những gì P0-3 định nghĩa

| Khái niệm | Vị trí | Ý nghĩa |
|---|---|---|
| Trạng thái freshness | `replenishment.calc.evaluateProposalFreshness` | `NO_LONGER_NEEDED` / `DRIFT_BLOCK` / `DRIFT_WARN` / `DRIFT_NONE` / `MISSING_COST` |
| Ngưỡng trôi | `QTY_DRIFT_TOL = 0.25`, `COST_DRIFT_TOL = 0.1` | **Mặc định chưa hiệu chỉnh, không có căn cứ thực nghiệm** — xem mục 5 |
| `proposalKey` + `pg_advisory_xact_lock` | `replenishment.suggest.withProposalLock` | chống hai đề xuất trùng cho một (SKU, NCC) |
| `resultRef` trên gate | `agent.gate.exec` | mốc để tra ngược PO nào sinh từ gate nào |
| `retryExecution` | `agent.gate.exec` | đường thoát cho gate `APPROVED` mà `resultRef` còn `null` |

## 3. Bằng chứng

| Lệnh | Kết quả | Loại |
|---|---|---|
| `npx jest tests/agent-gate-po.contract.test.js` | 45/45 PASS (Express thật + Prisma mock) | mock |
| `npx jest tests/frontend-decide-contract.test.js` | PASS — hợp đồng response cho màn hình duyệt | mock |
| `npm run smoke:po-gate` | **24/24** trên **DB thật**: sinh đề xuất → duyệt song song chỉ tạo 1 PO → `onOrder` chặn trùng → `NO_LONGER_NEEDED` → `DRIFT_BLOCK` → `DRIFT_WARN` → retry trạng thái lơ lửng → **`MISSING_COST` (kịch bản 11, thêm 2026-10-03)** | **DB thật** |
| `npm run check:tenant` | 11/11 + 4/4 + 4/4 | **DB thật** |
| `npx jest` | 4023 pass / 4028 (5 skip) | mock |
| `npm run check:modules` | 203 module load được, không export `undefined` | tĩnh |

## 4. Điều đã kiểm chứng và điều CHƯA

**Đã kiểm chứng (DB thật):**

- Duyệt song song (hai request cùng lúc) chỉ tạo **một** PO — nhờ `updateMany` có
  điều kiện `status = PENDING` rồi mới gọi executor.
- Hàng đang trên đường (`onOrder`) làm hệ thống **không** sinh đề xuất thứ hai cho
  cùng nhu cầu (vị thế tồn = ATP + onOrder, không phải ATP thô).
- Chặn được `NO_LONGER_NEEDED`, `DRIFT_BLOCK`; cảnh báo `DRIFT_WARN`.
- `MISSING_COST`: đề xuất vẫn hiện cho người duyệt, nhưng duyệt thì **409**, không
  tạo PO với tổng tiền 0; bổ sung giá vốn rồi duyệt lại thì ra PO với **giá mới**
  (`costSubstituted = true`, có ghi audit).
- Retry sau khi PO đã tạo không tạo PO thứ hai.

**CHƯA kiểm chứng (ghi rõ, không tô vẽ):**

- **Chưa có lần chạy nào trên môi trường thật.** Tất cả là DB local.
- **Chưa có đánh giá LLM nào.** Nhánh này không gọi LLM: công thức tính số, LLM
  chỉ đọc ở T14 (chưa làm).
- **Chưa có số liệu hiệu quả** (giảm tồn thất, tỉ lệ đề xuất đúng). Cần backtest
  P5 theo giao thức đã commit. Hiện **chưa đo**.
- **Chưa có giao diện cho người dùng thật** (T12): màn hình duyệt mới chỉ có
  `SmartApprovalCard.jsx` tái dùng, chưa đo được với người dùng.
- **Chưa đo** tỉ lệ người duyệt bấm "xác nhận lệch" bao nhiêu lần — đây là chỉ số
  quyết định ngưỡng `*_DRIFT_TOL` có hợp lý không.

## 5. Điểm yếu nói thẳng

1. **Hai ngưỡng `*_DRIFT_TOL` là số đặt theo kinh nghiệm chung, chưa hiệu chỉnh trên
   dữ liệu nào.** Không được trích ra slide như kết quả đo. Sẽ xem lại sau backtest.
2. **Cổng paywall chưa đáng tin** (ghi ở `06-business.md` nhiệm vụ): `requireModule`
   được đặt **trước** `authenticate` ở 16 router ⇒ gating theo gói chưa chặn được
   người dùng thiếu quyền. Ngoài phạm vi Vòng 2, nhưng **phải nói khi trình bày**.
3. **Trạng thái lơ lửng** (`APPROVED` + `resultRef = null`) là thật và có đường thoát,
   nhưng nếu không ai bấm "thử lại" thì đề xuất đó không tự tạo PO. Đây là giới hạn
   đã biết cần nói rõ.
4. **`MISSING_COST` chặn theo trạng thái hiện tại.** Nếu người dùng bổ sung giá vốn
   sau đó thì đi tiếp với giá mới — tức PO có thể mang giá **khác** giá trong ảnh
   chụp mà người duyệt thấy lúc đề xuất. Việc thay số được ghi vào audit
   (`AGENT_PO_GATE_EXECUTED.costSubstituted`), nhưng UI chưa hiện.

## 6. Cách hồi quy

Bản vá P0-3 là một commit (`025c989`). Hồi quy = `git revert 025c989`, **không** có
công tắc tắt gate. Nếu chỉ cần tắt đường tự động thì `AUTO_REORDER_PROPOSAL`
(mặc định OFF) là cờ có sẵn và được thiết kế để tắt.

## 7. Tài liệu liên quan

- `docs/aisc26/00b-gate-design.md` — thiết kế human-gate.
- `docs/aisc26/01-llm-role.md` — vì sao LLM không nằm trong đường tính số này.
- `docs/aisc26/03-evaluation-protocol.md` — giao thức đo (sẽ sửa ở T5).
- `docs/aisc26/review-hotfix-tenant.md` — review pack hotfix cách ly tenant.
- `tests/agent-gate-po.contract.test.js` — bằng chứng chạy được.