# 01 — Vai trò của công thức và của LLM

**Ngày:** 2026-10-02 · **Nhánh:** `round2/p0-hardening`
**Bám theo:** phản hồi giám khảo "vai trò thực sự của LLM chưa rõ khi phần lớn logic (ROP, BOM) có thể giải bằng công thức".

> **Câu trả lời một dòng:** LLM **không** tính bất kỳ con số nào của quyết định nhập hàng. Công thức tính hết. LLM làm đúng hai việc mà công thức không làm được — **khớp tên sản phẩm lộn xộn về SKU nội bộ**, và **diễn giải kết quả cho người không rành số liệu**. Cả hai đều **đo được**, và cả hai đều **tắt được mà luồng vẫn chạy**.

---

## 1. Bảng phân vai

Cột "Ai quyết định" là câu trả lời cho *"nếu người khác kiểm tra code, họ thấy gì?"*

| # | Việc | Cách giải | **Ai quyết định kết quả** | Lý do cụ thể |
|---|---|---|---|---|
| 1 | ATP (tồn khả dụng) = tổng tồn − đã giữ, **gộp mọi kênh** | **Công thức** | Máy | Chỉ là phép trừ trên số nguyên. Sai số ở đây là lỗi đọc DB, không phải lỗi suy luận. |
| 2 | Nhu cầu nền (demand/day) | **Thống kê**: trung bình trượt 28 ngày, có hiệu chỉnh ngày hết hàng | Máy | Lịch sử bán là đầu vào đủ dùng. LLM không nhìn thấy gì thêm. |
| 3 | Lead time (PO→GRN) | **Thống kê** median lịch sử theo NCC; thiếu → mặc định + cờ `leadTimeEstimated` | Máy | Là số đo từ chính hệ thống. |
| 4 | Safety stock | **Công thức**: `z(α) × σLT × sqrt(LT)` theo mức dịch vụ chọn | Máy | Chỉ có nghĩa khi gắn với một α cụ thể. |
| 5 | **ROP** = `nhu_cầu × LT + SS` | **Công thức** | Máy | **LLM không được phép tính ROP.** Đây là câu trả lời trực tiếp cho giám khảo. |
| 6 | Số lượng đặt (EOQ / làm tròn theo bao bì NCC) | **Công thức** | Máy | Ràng buộc bao bì là quy tắc cứng của NCC. |
| 7 | Chọn NCC cho mỗi SKU | **Công thức**: NCC từ PO gần nhất còn active | Máy | Là tra cứu, không phải suy luận. |
| 8 | **Khớp tên sản phẩm trên sàn → SKU nội bộ** | **LLM** (ràng buộc) | **LLM, người xác nhận nếu thấp** | Tên trên sàn lộn xộn, có biến thể, viết tắt, đổi tên theo đợt. **Đây là nơi công thức bất lực.** |
| 9 | **Giải thích đề xuất cho chủ shop** | **LLM** (template dự phòng) | LLM | Người dùng không đọc bảng số. |
| 10 | **Soạn tin nhắn cho NCC** | **LLM** (chỉ soạn) | LLM | **Không tự gửi.** Người gửi. |
| 11 | Điều phối bước nào chạy trước | **Event pipeline + code** | Máy | Đã có ở CDC. Không cần LLM quyết định thứ tự. |
| 12 | Quyết định tạo PO hay không | **Con người** | **Người** | Human-gate. Xem `00b-gate-design.md`. |

**8 trong 12 dòng là công thức hoặc tra cứu. 3 dòng LLM (8, 9, 10). 1 dòng của người (12).**

---

## 2. Ranh giới bất di bất dịch: LLM không bao giờ chạm vào số

Đây là luật kỹ thuật, không phải quy ước miệng. Cơ chế:

```
┌─ BƯỚC A: CÔNG THỨC (modules/replenishment/*.calc.js — hàm thuần) ─────────┐
│                                                                              │
│  input : salesHistory[], inventory, poHistory, settings                     │
│  output: { atp, demandPerDay, leadTimeDays, leadTimeEstimated,              │
│            safetyStock, rop, orderQty, vendorId,                            │
│            fingerprint }   ← ĐÂY là nguồn sự thật duy nhất                 │
│                                                                              │
│  ❌ KHÔNG import LLM. KHÔNG đọc .env. KHÔNG async (ngoại trừ input từ DB) │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼  (chỉ đọc, không ghi)
┌─ BƯỚC B: LLM (modules/replenishment/*.llm.js) ────────────────────────────┐
│                                                                              │
│  input : CHỈ các số đã tính ở Bước A, dạng JSON                            │
│  output: { explanation, vendorMessage, skuMatches[] }                        │
│  ràng  : không được trả về con số nào khác; không được sửa số              │
│  kiểm  : Zod validate; có confidence; dưới ngưỡng → chuyển người          │
│  lỗi  : fallback template, KHÔNG ném lỗi ra ngoài                          │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─ BƯỚC C: NGƯỜI DUYỆT (human-gate) ──────────────────────────────────────────┐
│                                                                              │
│  nhìn thấy: số từ Bước A + lời giải thích từ Bước B + cảnh báo lệch số    │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Cách bắt vi phạm:** mọi module LLM ở Bước B có một unit test "số không đổi" — chạy với provider giả lập trả về `explanation` chứa con số sai, và test khẳng định output cuối **vẫn dùng số từ Bước A**. Nếu số trong output khác số ở Bước A → test đỏ.

---

## 3. Vai trò LLM 1 — Khớp SKU giữa file sàn và ERP

### 3.1. Vì sao công thức bất lực

Mẫu thật từ Shopee Seller Centre vs ERP:

| Tên trên sàn | SKU ERP | Vì sao khó |
|---|---|---|
| `Kem đánh răng Fresh B 100g - 2 TUÝ (HOT)` | `KEM-FRESH-100` | Bundle 2 tuý, có chữ promo |
| `Nến thơ Vani 200g` | `NEN-VAN-200` | Khác 1 chữ "thơ" |
| `Nến thơ Vani 200g - Giảm 20%` | `NEN-VAN-200` | Cùng hàng, khác đợt khuyến mãi |
| `dầu gội abc xyz 500ml` | `DAU-GOI-XYZ-500` | Khác đơn vị (ml vs 500) |
| `Áo Polo Nam` | `AO-POLO-NAM` | Trùng tên, khác màu/size |

Không có quy tắc chuỗi nào xử lý được cả 5 ca. Fuzzy match chuẩn (Levenshtein) **cho** điểm cao nhầm cho "Nến thơ Vani 200g" vs "Nến thơ Vani 300g" — gần như giống nhau nhưng là hàng khác.

### 3.2. Thiết kế

```
input  : [{ externalName, externalSku, unit?, qty, price }, ...]   (từ CSV sàn)
         + danh mục ERP: [{ productId, sku, name, unit, category }] (top-K theo từ khóa)
output : [{ externalName, productId, confidence, reason, needsHuman }]
```

**Ba nguyên tắc:**

1. **Ứng viên được thu hẹp trước bằng công thức.** LLM chỉ chọn trong ≤5 ứng viên đã lọc (cùng danh mục + cùng đơn vị + token chung nhất). Nếu không có ứng viên nào khớp token → **không gọi LLM**, đánh dấu `NEEDS_HUMAN`.
2. **LLM không được bịa `productId`.** Chỉ được trả `productId` nằm trong danh sách ứng viên. Zod `.refine()` kiểm tra; vi phạm → coi như không khớp.
3. **Ngưỡng chuyển người: `confidence < 0.85` → `needsHuman: true`.** Đề xuất vẫn hiện, nhưng **không tự áp dụng** — người bấm chọn. Trên UI hiển thị rõ "AI đề xuất, cần xác nhận".

### 3.3. Hai chế độ chạy — không phụ thuộc API key

Cùng một mã, hai provider:

| Chế độ | Provider | Dùng khi nào | Precision/recall có công bố? |
|---|---|---|---|
| `replay` | Đọc bản ghi đã lưu (JSONL) | Unit test, CI, demo dự phòng khi mất mạng | ❌ **Không** — chỉ kiểm thử pipeline |
| `live` | Gemini qua `config/llm.js` | Đo thật | ✅ **Có**, kèm ngày chạy + key dùng model nào |

`replay` là **record-replay**: lần chạy `live` thành công sẽ ghi lại `(prompt hash → raw response)`; lần `replay` trả đúng response đó. Nhờ vậy pipeline kiểm thử được **không cần key**, và khi Gemini đổi model cũng không làm hỏng test.

> **Quy tắc báo cáo:** mọi con số precision/recall trong `03-evaluation.md` phải kèm `mode: live` + ngày chạy + tên model. Số từ `replay` chỉ dùng để chứng minh pipeline chạy, tuyệt đối không đưa vào slide.

### 3.4. Tập dữ liệu có nhãn tay — và điểm đang bị chặn

Precision/recall chỉ có nghĩa nếu có nhãn thật. Tình hình:

| Nguồn nhãn | Cỡ | Ai gán | Trạng thái |
|---|---|---|---|
| CSV export thật từ Shopee, khớp tay với ERP | **chưa có** | — | ⛔ **Bị chặn** — chờ quyết định dữ liệu |
| Bộ mẫu tự dựng (sinh 50–200 cặp tên lộn xộn, biến thể) | 50–200 cặp | **Tôi dựng theo kịch bản thật** | ✅ Làm được ngay, nhưng **không phải dữ liệu thật** |

**Phải nói thẳng trong báo cáo:** nếu cuối cùng chỉ có bộ mẫu tự dựng, con số đó đo **"LLM có khớp được tên lộn xộn không"** chứ **không** đo độ hiệu quả trên dữ liệu doanh nghiệp thật. Hai việc khác nhau, không được trộn.

**Đề xuất quy trình gán nhãn khi có CSV thật:** 2 người trong đội gán độc lập, đối chiếu phần bất đồng, tính Cohen's κ, đưa κ vào báo cáo. Cỡ mẫu mục tiêu ≥ 100 cặp (để sai số của một tỉ lệ ≈ 10 điểm phần trăm khoảng ±5).

---

## 4. Vai trò LLM 2 — Giải thích và soạn tin cho NCC

### 4.1. Ràng buộc đầu vào

LLM **chỉ** nhận khối JSON đã tính sẵn:

```jsonc
{
  "sku": "NEN-VAN-200",
  "name": "Nến thơ Vani 200g",
  "atp": 12, "rop": 30, "safetyStock": 9, "demandPerDay": 2.1,
  "leadTimeDays": 7, "leadTimeEstimated": true,
  "daysOfCoverLeft": 5.7, "orderQty": 42, "unitCost": 45000, "total": 1890000,
  "vendorName": "NCC Huy Hà",
  "vendorOtfif": 0.86, "stockoutDaysLast90": 3
}
```

Prompt ghi rõ: *"Không được tạo, sửa hay làm tròn bất kỳ con số nào. Chỉ diễn giải."*

### 4.2. Ba đầu ra

| Đầu ra | Dùng khi | Kiểm tra |
|---|---|---|
| `explanation` | Luôn | Template fallback khi LLM lỗi |
| `vendorMessage` | Chủ shop bấm "soạn tin NCC" | **Chỉ soạn, không gửi** |
| `flags` *(tùy chọn, mục 5)* | Có ghi chú tự do của chủ shop | Chỉ là gợi ý, có cờ |

### 4.3. Đường lui — bắt buộc, không tùy chọn

Đây là điều kiện để demo chạy được khi không có API key.

```
llm.generateText(...)
  ├─ thành công + Zod hợp lệ  → dùng kết quả
  └─ lỗi / timeout / 429 / 503 / JSON hỏng / tắt qua env
        └─ TEMPLATE (không ném lỗi ra ngoài)
              "SKU {sku}: còn {atp}, điểm đặt lại {rop},
               nhu cầu {demand}/ngày, nhập chậm nhất {leadTime} ngày
               → đề xuất nhập {orderQty} ({total})."
```

Trên UI hiện nhãn **"Giải thích tạo bằng mẫu (LLM không khả dụng)"** — không được im lặng giả vờ là LLM viết. Giám khảo hỏi "LLM có thật không" thì trả lời "khi này không, đây là đường dự phòng" là câu trả lời tốt; giả vờ thì mất hết điểm.

**Cấu hình:** `LLM_DISABLED=1` ép tắt LLM toàn hệ thống cho demo dự phòng. Không nới gate, không giả vờ.

### 4.4. Ghi nhận token

`config/llm.js:144` hiện đọc `candidates[0].content.parts` và **bỏ qua `usageMetadata`** → không biết tốn bao nhiêu token.

Thay đổi cần làm (một commit riêng, không gộp P0):
1. `callModel` đọc `json.usageMetadata.{promptTokenCount, candidatesTokenCount, totalTokenCount}`.
2. `generateText` trả kèm `{ text, usage }` — **giữ nguyên tương thích**: vẫn trả chuỗi? Không. Đổi thành object sẽ phá call site cũ.
   → Chọn: `generateText` giữ trả chuỗi; thêm `generateTextWithUsage()` mới, hoặc gắn `lastUsage`. **Khuyến nghị: `lastUsage`** — ít đổi chữ ký, nhưng phải cẩn thận khi chạy song song.
3. Ghi vào bảng mới `LlmUsageLog`: `tenantId`, `task`, `model`, `promptTokens`, `completionTokens`, `totalTokens`, `latencyMs`, `succeeded`, `at`.

**Lưu ý:** `LlmUsageLog` có `tenantId` ⇒ **phải** thêm vào `TENANT_SCOPED_MODELS` và phải xanh `tests/tenant-scoped-models.contract.test.js`. Đây là lý do tôi **chưa** làm ngay: nó đòi thêm schema trong khi `00b` còn chưa duyệt. Đề xuất gộp vào **một** migration duy nhất cho cả `AgentHumanGate.resultRef` và `LlmUsageLog`.

---

## 5. Tùy chọn — đọc ghi chú tự do của chủ shop

Chỉ làm nếu còn thời gian. Không bắt buộc.

Chủ shop gõ tự do: *"NCC báo trễ 1 tuần"*, *"tuần sau khuyến mãi 20%"*, *"mùa này bán chậm"*.

| Việc | Cách |
|---|---|
| Trích xuất gợi ý điều chỉnh | LLM đọc ghi chú → trả `flags[]` |
| Ví dụ | `{ type:'LEAD_TIME_RISK', note:'NCC báo trễ 1 tuần', suggestIncreaseLeadTimeDays: 7, confidence: 0.6 }` |
| Áp dụng | **Không tự áp dụng.** Chỉ hiện cạnh đề xuất PO, có cờ, người duyệt quyết định có nghe không |

Đây là vai trò LLM đáng kể nhất về mặt "công thức không làm được" — nhưng **rủi ro cao nhất** về độ tin cậy (LLM hay bịa). Vì vậy xếp tùy chọn, và nếu làm thì bắt buộc `confidence` + người duyệt.

---

## 6. Sơ đồ luồng đầy đủ (luồng demo Vòng 2)

```
                    ┌──────────────────────────────┐
                    │  CSV sàn + đơn cửa hàng      │
                    └──────────────┬───────────────┘
                                   │
    ┌──────────────────────────────▼───────────────────────────────┐
    │ BƯỚC 1 · Khớp SKU                         [VAI TRÒ LLM #1]  │
    │  thu hẹp ứng viên bằng công thức → LLM chọn trong ≤5 ứng viên│
    │  conf ≥ 0.85 ──► auto      conf < 0.85 ──► NGƯỜI CHỌN      │
    │  nếu không có ứng viên ──► đánh dấu chưa map, không gọi LLM │
    └──────────────────────────────┬───────────────────────────────┘
                                   │  salesHistory (SKU × ngày, đã khớp)
    ┌──────────────────────────────▼───────────────────────────────┐
    │ BƯỚC 2 · Công thức                     [KHÔNG LLM]           │
    │  sửa censored demand → demandPerDay                          │
    │  lead time từ lịch sử PO→GRN (hoặc mặc định + cờ)           │
    │  safetyStock, ROP, orderQty                                   │
    └──────────────────────────────┬───────────────────────────────┘
                                   │  fingerprint
    ┌──────────────────────────────▼───────────────────────────────┐
    │ BƯỚC 3 · ATP gộp đa kênh                  [KHÔNG LLM]        │
    │  available = Σ(tồn mọi kho) − reserved                        │
    │  đánh dấu SKU nào ATP ≤ ROP                                   │
    └──────────────────────────────┬───────────────────────────────┘
                                   │
    ┌──────────────────────────────▼───────────────────────────────┐
    │ BƯỚC 4 · Gom đề xuất theo NCC              [CÔNG THỨC]       │
    │  NCC = PO gần nhất còn active                                 │
    │  chặn trùng: 1 đề xuất PENDING cho mỗi (SKU, NCC)            │
    │  NCC chưa có lịch sử → "chưa có NCC", người chọn              │
    └──────────────────────────────┬───────────────────────────────┘
                                   │  payload đã tính sẵn + rationale
    ┌──────────────────────────────▼───────────────────────────────┐
    │ BƯỚC 5 · Giải thích + soạn tin NCC      [VAI TRÒ LLM #2]     │
    │  vào : số đã tính sẵn, JSON                                  │
    │  ra  : { explanation, vendorMessage }                         │
    │  lỗi → TEMPLATE, có nhãn báo "mẫu", không giả vờ là LLM      │
    │  vendorMessage CHỈ SOẠN — không gửi                           │
    └──────────────────────────────┬───────────────────────────────┘
                                   │
    ┌──────────────────────────────▼───────────────────────────────┐
    │ BƯỚC 6 · HUMAN-GATE                        [CON NGƯỜI]        │
    │  PENDING, có hạn. KHÔNG có PO tồn tại ở bước này.            │
    │  lúc duyệt: kiểm lại fingerprint, NCC còn active, còn hạn    │
    │  lệch số → 409 chặn, không có đường override tự động          │
    └──────────────────────────────┬───────────────────────────────┘
                                   │ APPROVED, dưới danh nghĩa người duyệt
    ┌──────────────────────────────▼───────────────────────────────┐
    │ BƯỚC 7 · purchase.service.create            [CÔNG THỨC]       │
    │  có audit log · sinh mã PO có withCodeRetry · workflow PO_ABOVE│
    └─────────────────────────────────────────────────────────────────┘
```

**Điểm quan trọng nhất của sơ đồ:** chỉ **2 khối** có LLM (Bước 1, Bước 5), và **không khối nào** trong đó tạo ra con số nào mà hệ thống dùng để quyết định. Bước 6 và 7 không có LLM.

---

## 7. Câu hỏi giám khảo dự kiến — trả lời sẵn

| Câu hỏi | Trả lời |
|---|---|
| "Sao không dùng công thức ROP?" | **Đúng, và đó là chủ ý.** ROP là công thức và nó chạy bằng code, có unit test. LLM không được phép tính ROP — nếu LLM tính sai thì không ai phát hiện được. |
| "Vậy LLM làm gì?" | Đúng 2 việc mà công thức không làm: **khớp tên sản phẩm lộn xộn trên sàn về SKU nội bộ**, và **viết lời giải thích cho người không rành số liệu**. Cả hai đều tắt được mà luồng vẫn chạy — chỉ mất độ tự động. |
| "Đo được không?" | Khớp SKU: precision/recall trên tập có nhãn tay. Giải thích: bấm giờ đọc của người dùng thật + số lần phải sửa lại câu chữ. Chi phí: token ghi lại từng lần gọi. |
| "LLM sai thì sao?" | Số thì không sai được vì LLM không chạm vào số. Khớp SKU dưới ngưỡng chuyển người xác nhận. Giải thích sai thì PO vẫn đúng — người duyệt đọc số, không đọc lời. |
| "Không có API key thì sao?" | Chạy đường dự phòng: template giải thích + bỏ qua tự động khớp SKU. Trên màn hình có nhãn báo đang ở chế độ dự phòng. |

---

## 8. Phần đang bị chặn

| Việc | Bị chặn bởi | Cần gì |
|---|---|---|
| Số precision/recall thật cho khớp SKU | Chưa có CSV sàn thật | Đội chốt nguồn dữ liệu (`00-scope.md` §5.2) |
| Số chi phí LLM/tenant/tháng | Chưa ghi `usageMetadata` | Commit đo token + migration `LlmUsageLog` (mục 4.4) |
| Số thời gian tiết kiệm thao tác | Chưa có người thử | Đội điền tên/số người (`00-scope.md` §5.2) |
| Chạy `live` với Gemini | `GEMINI_API_KEY` rỗng | Đội nhập key rồi `npm run check:llm` |
| Đo được `check:humangate` baseline | Cần DB + backend chạy thật | Đội chạy `npm run check:humangate` |

**Không cái nào trong 5 dòng trên chặn được việc viết code.** Tất cả đều là điều kiện để **công bố số**, không phải để xây. Xây tiếp được ngay.