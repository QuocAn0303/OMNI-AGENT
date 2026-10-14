# AISC'26 — Bản đồ dự án cho đội OmniAgent

> **Tài liệu này là điểm vào.** Đọc file này để biết: thi gì, đã làm được gì,
> chưa làm gì, và phải làm gì tiếp theo. Mọi chi tiết kỹ thuật nằm ở các file
> khác trong `docs/aisc26/`.

**Cập nhật:** 2026-10-14 · **Nhánh:** `round2/p0-hardening` (chưa đẩy remote)

---

## 1. Thông tin thi

| | |
|---|---|
| **Giải** | Advanced Information Systems Contest lần 6 — năm 2026 (**AISC'26**) |
| **Đơn vị tổ chức** | Khoa Hệ thống Thông tin, Trường Đại họt Công nghệ Thông tin — ĐHQG-HCM |
| **Mã hồ sơ** | **AISC26-0058** |
| **Tên đội** | **OmniAgent** |
| **Tên đề tài** | Hệ thống Multi-Agent Tự hành Khai thác Dữ liệu Đa kênh Tối ưu hóa Tồn kho và Chuỗi cung ứng Doanh nghiệp Bán lẻ |
| **Quy mô nhóm** | **3 người** |
| **Trạng thái** | ✅ Qua **Vòng 1 – Vòng Khởi động** → Vượt qua **Vòng 2 – Vòng Trình bày đề tài trực tiếp** |

---

## 2. Phản hồi từ ban xét duyệt Vòng 1 — và đã xử lý được gì

Ban tổ chức đánh giá:

> *"Đề tài chọn bài toán có giá trị (tồn kho đa kênh cho SME) và có nền tảng kỹ
> thuật khá bài bản, nhưng **phạm vi còn quá rộng so với quy mô nhóm 3 người**.
> Nhiều **chỉ số cam kết như giảm 90% thao tác, hết hàng từ 8% xuống 1,5% hay
> độ chính xác 98,5% chưa có căn cứ**, và **vai trò thực sự của LLM chưa rõ** khi
> phần lớn logic (ROP, BOM) có thể giải bằng công thức. Ở vòng 2, nhóm nên tập
> trung **demo một luồng cụ thể trên dữ liệu thực tế**, làm rõ **điểm khác biệt so
> với các giải pháp có sẵn (KiotViet, Sapo...)** và bổ sung **góc nhìn kinh doanh
> như khách hàng mục tiêu, mô hình giá**."*

| # | Phàn nàn | Trạng thái | Bằng chứng |
|---|---|---|---|
| 1 | **Chỉ số không có căn cứ** | ✅ **Đã gỡ khỏi toàn bộ tài liệu** | Không còn chuỗi nào trong repo chứa −90% / 8%→1,5% / 98,5%. Thay bằng số đo thật — xem §4 |
| 2 | **Phạm vi quá rộng** | ✅ **Đã thu hẹp còn MỘT luồng** | `npm run demo:run` — 8 bước, một luồng duy nhất từ đơn bán đến bút toán |
| 3 | **Demo trên dữ liệu thực tế** | ✅ **Đã đóng vòng mua hàng** | PO → phiếu nhập kho → **bút toán Nợ 156 + Nợ 1331 = Có 331** → công nợ NCC |
| 4 | **Vai trò LLM chưa rõ** | 🟡 **Một nửa** | Đã có lập đứng thiết kế + số đo. **Chưa có màn hình** để demo khoảnh khắc LLM làm việc |
| 5 | **Khác biệt vs KiotViet/Sapo** | 🟡 **Có vật liệu, chưa có lập luận** | 39 PO lệch sổ cái, 458/468 SKU bị ẩn — nhưng bảng so sánh còn ghi `[CHƯA XÁC MINH]` |
| 6 | **Góc nhìn kinh doanh, giá** | ❌ **Chưa làm** | Có gói giá trong code nhưng chưa chốt được mức giá (xem §6) |

---

## 3. Dự án đã làm được gì

### 3.1 Năm hạng mục nghiệp vụ theo tham khảu Odoo — **5/5 XONG**

| Hạng mục | Commit | Kiểm chứng DB thật |
|---|---|---|
| **Vòng mua hàng khép kín** — GRN ghi bút toán + cộng dồn công nợ NCC | `dadfbf1` | `smoke:grn-posting` **16/16** |
| **Quy tắc nhập hàng** (`Reordering Rules`) theo SKU × kho | `5dcfcd2` | `smoke:replenishment-rules` **16/16** |
| **RFQ — so sánh báo giá NCC** (`Request for Quotation`) | `0ce1b09` | `smoke:rfq` **20/20** |
| **Cây vị trí kho** (`stock.location`) | `89ea028` | `smoke:warehouse-tree` **18/18** |
| **Dashboard KPI chuỗi cung ứng** | `b788dac` | `check:supply` **12/12** |

Nền tảng đã có sẵn và **không phá gì**: ERP kế toán kép, POS, F&B (bàn/KDS/QR order),
CRM + PRM, nhân sự, sản xuất (BOM/WO/QC), AI agent có human-gate, multi-tenant, 63 module.

### 3.2 Bảy lỗi thật đã tìm ra và sửa trong chính hệ thống mình

Đây là phần **đáng giá nhất khi trình bày** — vì nó trả lời câu "chỉ số của các bạn
lấy từ đâu?" mà không cần bất kỳ con số nào không kiểm chứng được.

| Lỗi | Đo được | Hiện tại | Lệnh kiểm tra |
|---|---:|---:|---|
| **PO đã nhận hàng mà không vào sổ cái** | **39 PO** | **0** | `npm run check:accounting` |
| Bút toán `tenantId` NULL (cách ly tenant vỡ) | 18 dòng | **0** | `npm run check:tenant` |
| **Màn hình đề xuất nhập ẩn gần hết SKU** | **458/468** | **0** | `npm run measure:evidence` |
| Lead time đo được chết âm thầm | **0/20** PO | **57/57** PO | `npm run demo:check` |
| Bộ đếm mã bút toán (`count+1`) hỏng khi có lỗ hổng | — | sửa | `npm run check:accounting` |
| `LotTransaction.note` không tồn tại → hỏng xuất kho FIFO **mọi đơn** | — | sửa | `smoke:grn-posting` |
| `smart-guide/reorder` dùng hằng số cứng `10` thay vì `minStock` | — | sửa | `npm run measure:evidence` |

### 3.3 Bằng chứng thay cho "đã phỏng vấn" — nhưng **không** gọi là phỏng vấn

Bộ 24 câu hỏi trong `docs/AISC_10_Cua_Hang_Da_Dien_Gia_Dinh (1).xlsx` là **GIẢ ĐỊNH** —
tệp tự ghi ở từng dòng *"GIẢ ĐỊNH – CHƯA KHẢO SÁT"*. **Số người phỏng vấn thật
vẫn là 0** và không nên đổi.

Thay vào đó, `npm run measure:evidence` đo 5 nhóm chỉ số nghiệp vụ **trên chính hệ
thống đang chạy**. Chi tiết: [`09-real-data-evidence.md`](./09-real-data-evidence.md).

> ⚠️ Đây chứng minh **sản phẩm tự kiểm chứng được**, KHÔNG chứng minh **nhu cầu
> người dùng**. Hai thứ khác nhau, không thay thế được nhau. **Không được nói là
> "chúng tôi phỏng vấn 10 chủ cửa hàng".**

### 3.4 Luồng demo Vòng 2 — một luồng, đóng trọn vẹn

```bash
npm run demo:setup        # nạp dữ liệu + PO/GRN lịch sử (để có lead time đo được)
npm run demo:login -- --apply
npm run demo:run          # trình diễn không cần giao diện (~3 giây)
npm run demo:check        # tự kiểm 13 điều kiện, FAIL = không được trình bày
```

8 bước, tất cả là **đường mã sản phẩm thật**:

| # | Bước | Mã được gọi |
|---|---|---|
| 1 | Chọn SKU | `planReplenishment` (công thức, **không** LLM) |
| 2 | Tạo đơn bán | `order.service.create` (trừ kho thật) |
| 3 | CDC phát tín hiệu | `EVENT_HANDLERS.LOW_STOCK` |
| 4 | Sinh đề xuất PENDING | `replenishment.suggest` → human-gate |
| 5 | Kiểm tra drift lúc duyệt | `revalidate` |
| 6 | Người duyệt | `executeGate` → tạo PO |
| 7 | **Đóng vòng mua hàng** | `purchaseService.approve` → `grnService.create` → `recordQc` → **`post` (bút toán + công nợ)** |
| 8 | Chống đề xuất trùng | `suggestForProduct` lần 2 (`onOrder` đã che) |

**Bước 7 là phần khác biệt mạnh nhất** — trước 2026-10-12, nhận kho chỉ cộng tồn
mà không ghi bút toán. Đây cũng là lý do có **hai chốt kiểm riêng**: duyệt *đề xuất*
(bước 6) ≠ duyệt *đơn mua* (bước 7).

#### ⚠️ Chạy một lần "hâm nóng" TRƯỚC khi lên sân khấu

Đo được 2026-10-14 bằng `npm run diag:order-timing`:

| Lần chạy | `create-order` | Toàn luồng |
|---|---:|---:|
| **Lần đầu** (vừa bật máy) | **19 157 ms** | ~27 s |
| **Lần sau** (đã ấm) | **952 ms** | **~2,4 s** |

Chênh 20 lần, và **không phải** do số lượng bán (đã loại trừ bằng cách đo
`qty=1` vs `qty=572` trên cùng một SKU) — là chi phí nạp cây module lần đầu.

> **⇒ Chạy `npm run demo:run` một lần ngay trước khi lên trình bày.** Lần đầu
> để sẵn Node warm cache, lần trình diễn thật sẽ chạy **2–3 giây**.

---

## 4. Kết quả kiểm chứng (2026-10-14, chạy TUẦN TỰ)

> **Quy tắc bất di bất dịch:** unit test với mock **KHÔNG phải** bằng chứng thay đổi
> an toàn với DB thật. Chạy script **tuần tự, không song song** — hai script ghi
> dữ liệu cùng lúc sẽ tranh nhau sinh mã và làm nhau FAIL.

### Tĩnh

| Lệnh | Kết quả |
|---|---|
| `npm test` | **4488 / 4493** pass (90 suite, 5 skip) |
| `npm run check:modules` | **212** module load được |
| `npm run check:swagger` | **135 / 135** khối |

### Trên DB thật

| Lệnh | Kết quả |
|---|---|
| `npm run check:tenant` | **11/11 + 4/4 + 4/4** — PASS |
| `npm run check:accounting` | **57 GRN / 57 bút toán / 0 thiếu**, cân bằng N = C |
| `npm run smoke:demo-flow` | **17 / 17** |
| `npm run demo:check` | **13 / 13**, hai lần liên tiếp không rác |
| `npm run smoke:grn-posting` | **16 / 16** |
| `npm run smoke:replenishment-rules` | **16 / 16** |
| `npm run smoke:rfq` | **20 / 20** |
| `npm run smoke:warehouse-tree` | **18 / 18**, chạy 2 lần cùng kết quả |
| `npm run smoke:po-gate` | **24 / 24** |
| `npm run smoke:demo-flow` (bước 7) | PO qua duyệt thứ hai · GRN nhận một phần · tồn đúng bằng hàng đạt QC · **bút toán cân bằng N = C** · công nợ NCC tăng |

### Trên HTTP thật (cần `npm run dev`)

| Lệnh | Kết quả |
|---|---|
| `npm run check:humangate` | **11 / 11** |
| `npm run check:replenishment-rules` | **12 / 12** |
| `npm run check:supply` | **12 / 12** |
| `npm run check:evidence` | **14 / 14** |

### Đánh giá khớp SKU (chế độ không-LLM)

`npm run llm:eval` → P = **0,8269** · R = **0,8776** · F1 = **0,8515** trên 107 nhãn tay
(tập kiểm định 60 cặp, 56 có nhãn) · chuyển người **13,33%**.

> ⚠️ Ở `mode=off`, hybrid ≡ fuzzy nên `CI95 [0; 0]` ⇒ **KHÔNG được nói LLM làm tốt
> hơn**. Token/cặp **CHƯA ĐO**.

---

## 5. Câu trả lời cho câu hỏi khó nhất: "Vai trò LLM ở đâu?"

Ban giám khảo nói đúng: phần lớn logic (ROP, BOM, tồn tối thiểu) **giải bằng công
thức được**. Đây là lập đứng thiết kế, không phải điểm yếu:

> "LLM của chúng tôi chỉ làm **hai việc**, và cả hai đều là việc công thức không
> làm được:
> **(1)** khớp tên hàng tiếng Việt tự do với mã SKU — người bán ghi *"cao lanh
> trắng 800g"*, không có khoá chung nào để khớp bằng so khớp ký tự;
> **(2)** soạn tin nhắn đề nghị nhà cung cấp từ con số ROP.
> Mọi quyết định về **số lượng** do công thức quyết định — AI không được chạm vào
> bất kỳ con số nào. Và ranh giới đó không phải lời hứa: hệ thống tự quét sau mỗi
> lần gọi LLM (`assertNumbersUnchanged`), phát hiện số bị sửa là loại bỏ kết quả."

**Còn thiếu:** màn hình để demo khoảnh khắc (2). Bước `explain-proposal` hiện chỉ
chạy trong script, chưa có UI.

---

## 6. Còn lại — xếp theo giá trị

### 6.1 Cần làm trước Vòng 2 (kỹ thuật + tài liệu)

| # | Việc | Vì sao | Ước lượng |
|---|---|---|---|
| 1 | **Màn hình soạn tin nhắn NCC** | Là nơi duy nhất trong sản phẩm LLM thật sự tham gia — trả lời trực tiếp phàn nàn #4 | 1 phiên |
| 2 | **Viết lại kịch bản demo** (`04-demo-script.md`) theo luồng 8 bước, thay đoạn 45 giây đọc số backtest | Phạm vi + uy tín số liệu | 1 phiên |
| 3 | **Bảng khác biệt vs KiotViet/Sapo** | Phàn nàn #5. Hiện 3 mục còn ghi `[CHƯA XÁC MINH]` | 0,5 phiên tra cứu |
| 4 | **Góc kinh doanh**: khách hàng mục tiêu + mô hình giá | Phàn nàn #6. Giá PA/PB/PC **chốt được sau khi có phỏng vấn** (`06-business.md` §5.3) | 0,5 phiên |

### 6.2 Chỉ làm được bằng con người — không giải được bằng code

| # | Việc | Trạng thái | Ghi chú |
|---|---|---|---|
| 1 | **6 người thử** | **0 người** | Bộ công cụ đã sẵn (`usertest/`). `npm run usertest:print-sheets` rồi in phiếu ra hỏi |
| 2 | **5–10 phỏng vấn thật** | **0 người** | Bộ 24 câu trong tệp xlsx — xoá cột "Trả lời thực tế" rồi điền lại. **3 câu trả lời thật hơn 10 câu giả** |
| 3 | Token LLM thật | **chưa đo** | Cần `npm run llm:eval -- --mode live` (đã có key) |
| 4 | Người gán nhãn thứ hai | **chưa có** | Để đo độ khớp giữa hai người |

> Ba việc đầu tốn **vài giờ** mỗi việc. Việc 1 và 2 là thứ lớn nhất còn thiếu cho
> Vòng 2, và là thứ **không làm được bằng code**.

### 6.3 Nợ kỹ thuật nhỏ đã biết

- `data:import` tạo kho với `id = "<tenantId>:wh-main"` (không phải UUID). `warehouseId`
  là `String` nên DB chấp nhận, nhưng hỏng khi code giả định UUID. Cần migration.
- 36 GRN kẹt `QC_DONE` thuộc tenant seed `crm-phase1-demo` — không ảnh hưởng luồng demo.
- 141/146 bảng scoped chưa có FK tới `tenants` — backlog đã biết.
- Duyệt **CC BY 4.0** cho tập dữ liệu UCI trước khi công bố (chưa có trong `DECISIONS.md`).

---

## 7. Quy tắc trình bày — đọc trước khi lên sân khấu

**Được nói:**

- ✅ "Chúng tôi tự viết lệnh kiểm tra hệ thống của chính mình và phát hiện 39 đơn
  mua đã nhận hàng thật mà không vào sổ cái. Đã sửa, giờ bằng 0."
- ✅ "Chúng tôi chưa phỏng vấn được người dùng thật."
- ✅ "Số nào đo từ bộ dữ liệu **mô phỏng** thì chúng tôi ghi rõ là mô phỏng."
- ✅ "Phần này **chưa đo**" + đưa lệnh để đo sau.

**Không được nói:**

- ❌ "Chúng tôi phỏng vấn 10 chủ cửa hàng" — tệp nguồn tự ghi là giả định.
- ❌ "99.000đ/tháng", "trên 200.000đ là đắt" — câu trả lời của người chưa tồn tại.
- ❌ "AI chính xác hơn" — ở chế độ mặc định hybrid ≡ fuzzy, `CI95 [0;0]`.
- ❌ "ROP tốt hơn" — thí nghiệm 1 cho thấy ROP **mất bán nhiều hơn 31,5%**; chỉ nói
  được "ở cùng mức phục vụ, ROP trôi ít vốn hơn" (thí nghiệm 2, **post-hoc**, ràng buộc
  95% **không khả thi** — cao nhất đạt 88,66%).

> Chi tiết các con số và giới hạn: [`03-evaluation-results.md`](./03-evaluation-results.md),
> [`07-qa-prep.md`](./07-qa-prep.md), [`08-qa-business-judge.md`](./08-qa-business-judge.md).

---

## 8. Bản đồ tài liệu

| File | Nội dung | Khi nào đọc |
|---|---|---|
| **`00-index.md`** (file này) | Bản đồ dự án, trạng thái, việc còn lại | **Đầu tiên, luôn** |
| [`00-scope.md`](./00-scope.md) | Phạm vi bài toán, giả định | Hiểu vì sao chọn bài toán |
| [`02-data.md`](./02-data.md) | Nguồn dữ liệu, giả định A1–A5 | Khi bị hỏi "dữ liệu đâu" |
| [`03-evaluation-protocol.md`](./03-evaluation-protocol.md) | Giao thức backtest S1–S12 | Khi bị hỏi "thí nghiệm chuẩn không" |
| [`03-evaluation-results.md`](./03-evaluation-results.md) | Kết quả thí nghiệm 1 + giới hạn | Khi bị hỏi về con số |
| [`04-demo-script.md`](./04-demo-script.md) | Kịch bản trình diễn | **Cần cập nhật** theo luồng 8 bước |
| [`05-differentiation.md`](./05-differentiation.md) | Luận điểm khác biệt | **Cần cập nhật** — 3 mục còn `[CHƯA XÁC MINH]` |
| [`06-business.md`](./06-business.md) | Khách hàng mục tiêu, mô hình giá | **Cần cập nhật** — giá chưa chốt |
| [`07-pitch-outline.md`](./07-pitch-outline.md) | Dàn ý pitch 10 slide | Trước khi lên sân khấu |
| [`07-qa-prep.md`](./07-qa-prep.md) | 16 câu hỏi dự kiến + trả lời | **Bắt buộc đọc** trước khi thi |
| [`08-qa-business-judge.md`](./08-qa-business-judge.md) | Câu hỏi giám khảo nghiệp vụ | **Bắt buộc đọc** |
| [`09-real-data-evidence.md`](./09-real-data-evidence.md) | 5 nhóm chỉ số đo được thay cho khảo sát | **Chỗ trả lời "chỉ số lấy từ đâu"** |
| [`FILL-IN.md`](./FILL-IN.md) | Mọi chỗ cần người điền sau | Danh sách việc còn treo |
| [`STATE.md`](./STATE.md) | Nhật ký phiên làm việc + bài học | Phiên sau cần nối tiếp |

---

## 9. Quy tắc làm việc cho phiên sau

1. **Dừng mọi tiến trình nền trước khi chạy script ghi dữ liệu**
   (`Get-Process node | Stop-Process -Force`).
2. **Chạy script kiểm chứng TUẦN TỰ**, không song song.
3. **PowerShell `Add-Content`/`Set-Content` làm hỏng tiếng Việt** trong file Markdown —
   dùng thẻ `edit`/`write`.
4. **Không đẩy `main`.** Nhánh hiện tại `round2/p0-hardening`, **chưa push remote**.
5. **Sửa schema ⇒ `npx prisma generate`**, và model có `tenantId` mới phải khai báo
   trong `TENANT_SCOPED_MODELS` (có contract test chặn).
6. **Sửa xong luôn chạy lại kiểm chứng.** Đã có tiền lệ: đổi một hàm thành công với
   mock cũng làm `smoke:grn-posting` rớt 16/16 → 11/16.