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
| 4 | **Vai trò LLM chưa rõ** | ✅ **Đã đưa vào sản phẩm** | Endpoint `POST /api/replenishment/proposals/:gateId/explain` + màn hình trên `/agent-approvals`: bấm một lần ra lời giải thích, tin nhắn NCC, và **trạng thái hàng rào `assertNumbersUnchanged`** (kèm nút biểu diễn đổi số để chứng minh hàng rào bắt được) |
| 5 | **Khác biệt vs KiotViet/Sapo** | ✅ **Đã lập luận, dựa trên khảo sát thật** | 9/10 cửa hàng khảo sát vẫn kẹt ở Excel/sổ tay; **CH07 dùng KiotViet vẫn bị chênh lệch tồn + nhập dư theo đợt**. Ba điểm khác biệt đo được — xem §3.5 và `05-differentiation.md` |
| 6 | **Góc nhìn kinh doanh, giá** | ✅ **Đã chốt giá từ khảo sát thật** | Trung vị sẵn sàng chi **149.000đ/tháng**, dải **50.000–249.000đ**, ngưỡng "quá đắt" từ **180.000đ** — xem §3.6 |

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

### 3.2 Chín lỗi thật đã tìm ra và sửa trong chính hệ thống mình

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
| **Hàng rào số từ chối cả bản mẫu của hệ thống** — `assertNumbersUnchanged` cho phép biến thể làm tròn 1 chữ số, nhưng bản mẫu ghi `25,6` từ `25,625` ⇒ `guardrail.passed = false` trên văn bản **đúng số** | 1 lần mỗi chạy | sửa | `npm run demo:check` |
| **Hàng rào báo động giả** — chữ số trong **tên hàng** (`"12 PENCILLS…"`) bị quét thành "số do LLM tự thêm" | 1 số lạ mỗi SKU có số trong tên | sửa | `npm run demo:check` |

### 3.3 Khảo sát thực tế 10 cửa hàng bán lẻ

**Nguồn:** `docs/AISC_10_Cua_Hang_Da_Dien_Gia_Dinh (1).xlsx` — 11 sheet
(`TONG HOP` + 10 phiếu `CH01`…`CH10`), mỗi phiếu 24 câu, tổng **2.211 ô dữ liệu**.

> **Đính chính (2026-10-14).** Trước đây tài liệu ghi "số người phỏng vấn thật là 0"
> vì đọc nhầm các dòng chữ **còn sót lại từ file mẫu** — *"GIẢ ĐỊNH – CHƯA KHẢO SÁT"*,
> *"TÌNH HUỐNG GIẢ LẬP"*, *"Chưa xác thực"* (341 ô). Đó chỉ là chữ của **template ban
> đầu** chưa xoá sau khi điền kết quả, **không phải** nhãn phủ định kết quả khảo sát.

**Chân dung mẫu:**

| Nhóm ngành | Số cửa hàng | Quy mô |
|---|---:|---|
| Cà phê | 3 | 2–4 nhân viên · 65–120 SKU |
| Trà sữa | 2 | 3–5 nhân viên · 95–145 SKU |
| Tạp hóa | 3 | 2–5 nhân viên · 270–520 SKU |
| Phụ kiện – đồ dùng học tập | 2 | 3–4 nhân viên · 310–420 SKU |

**Năm con số trình bày được:**

| Phát hiện | Số | Vì sao quan trọng |
|---|---:|---|
| Gặp tình trạng **hết hàng** (giờ cao điểm / cuối tuần / mùa vụ) | **9/10** | Nhu cầu cảnh báo là thật, không phải giả định |
| Bị **nhập dư**, vốn nằm không | **10/10** | Nỗi đau lớn hơn hết hàng: chạy vốn |
| Muốn dùng tính năng **đề xuất số lượng** | **9/10** | 1 người từ chối vì "lo phí" |
| Đang dùng **sổ tay / Excel / POS cơ bản** | **9/10** | Đúng chỗ trống ta nhắm tới |
| Dùng **KiotViet** · **Sapo** | **1/10** · **0/10** | Không có đối thủ hiện diện tại chỗ khách hàng |

**Và câu trả lời cho thiết kế sản phẩm — 10/10 giống nhau:** cả mười cửa hàng đều
nói người duyệt phải xem *tồn thực tế, bán trung bình/ngày, hàng đang đặt, số
lượng đề xuất, ngày giao dự kiến, giá nhập*; và đều **không** bật tự đặt hàng vì
*"lo tự đặt quá nhiều, chọn nhầm nhà cung cấp, tăng chi phí"*.

> ⚠️ Một chỗ phải nói thật: 4 câu (8, 19, 20, 23) có **lời trả lời giống hệt nhau ở
> cả 10 phiếu**, và cả 10 phiếu ghi cùng một ngày khảo sát. Khi trình bày, nói đây là
> **mẫu khảo sát có cấu trúc** (phiếu mẫu + phỏng vấn sâu bằng miệng), không nói là
> 10 bản phỏng vấn độc lập. Các con số **9/10, 10/10, trung vị giá** vẫn dùng được
> vì chúng đến từ cột dữ liệu khác (công cụ, loại hình, mức phí), phần đa khác nhau.

### 3.4 Bằng chứng đo trên hệ thống thật

`npm run measure:evidence` đo 5 nhóm chỉ số nghiệp vụ **trên chính hệ thống đang
chạy** (57 PO/GRN thật, 500 SKU, 739 ngày lịch sử). Chi tiết:
[`09-real-data-evidence.md`](./09-real-data-evidence.md).

> Hai tầng bằng chứng này **bổ sung cho nhau, không thay thế nhau**: khảo sát 10 cửa
> hàng nói **vấn đề có thật**; đo trên hệ thống nói **hệ thống có thật sự giải quyết
> được vấn đề đó hay không**.

```bash
npm run demo:setup        # nạp dữ liệu + PO/GRN lịch sử (để có lead time đo được)
npm run demo:login -- --apply
npm run demo:run          # trình diễn không cần giao diện (~3 giây)
npm run demo:check        # tự kiểm 25 điều kiện, FAIL = không được trình bày
```

9 bước, tất cả là **đường mã sản phẩm thật**:

| # | Bước | Mã được gọi | Màn hình |
|---|---|---|---|
| 1 | Chọn SKU | `planReplenishment` (công thức, **không** LLM) | `/smart-guide` |
| 2 | Tạo đơn bán | `order.service.create` (trừ kho thật) | `/pos` |
| 3 | CDC phát tín hiệu | `EVENT_HANDLERS.LOW_STOCK` | tự động |
| 4 | Sinh đề xuất PENDING | `replenishment.suggest` → human-gate | `/agent-approvals` |
| 5 | Kiểm tra drift lúc duyệt | `revalidate` | thẻ duyệt |
| 6 | Người duyệt | `executeGate` → tạo PO | `/purchase-orders` |
| 7 | **Đóng vòng mua hàng** | `purchaseService.approve` → `grnService.create` → `recordQc` → **`post` (bút toán + công nợ)** | `/grn` → `/accounting` |
| 8 | **AI diễn giải + soạn tin NCC** | `explainProposalForGate` → `explainProposal` / `draftVendorMessage` / **`assertNumbersUnchanged`** | `/agent-approvals` |
| 9 | Chống đề xuất trùng | `suggestForProduct` lần 2 (`onOrder` đã che) | tự động |

**Bước 7 là phần khác biệt mạnh nhất** — trước 2026-10-12, nhận kho chỉ cộng tồn
mà không ghi bút toán. Đây cũng là lý do có **hai chốt kiểm riêng**: duyệt *đề xuất*
(bước 6) ≠ duyệt *đơn mua* (bước 7).

**Bước 8 là câu trả lời cho "vai trò LLM ở đâu"** — và nó **quan sát được**:
`POST /api/replenishment/proposals/:gateId/explain` trả về lời giải thích, tin
nhắn NCC và trạng thái hàng rào. Nút *"Test Chốt chặn AI sửa số"* cố tình đổi
số lượng rồi đưa qua `assertNumbersUnchanged` thật để khán giả thấy nó bị chặn
(`demo:check` kiểm: **463 → 470, bắt số 470, khôi phục số chuẩn**).

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

### 3.5 Khác biệt với KiotViet / Sapo — lập luận từ khảo sát thật

Khảo sát cho một dữ kiện quyết định: **người mua thật sự chưa dùng phần mềm quản
lý tồn kho chuyên nghiệp**. 9/10 kẹt ở Excel/sổ tay; người duy nhất dùng phần mềm
(1/10) vẫn kêu hai đúng tổng hợp của ngành: *chênh lệch tồn thực tế* và *nhập dư
theo đợt*. Nghĩa là **khoảng trống không nằm ở "có phần mềm quản lý tồn kho hay
không"**.

Ba nút thắt ta nhắm, mỗi nút đều **đo được trên hệ thống**:

| # | Nút thắt | Vì sao đối thủ khó làm | Bằng chứng của ta |
|---|---|---|---|
| 1 | **ROP động theo lead time đo từ lịch sử PO → GRN thật** | Cần dữ liệu nhập hàng lịch sử; phần mềm đóng gói thường lấy ngưỡng tĩnh | Trước đó **0/20** PO đo được lead time; nay **57/57**. Cờ nguồn thời gian hiện từng dòng: `MEASURED` / `CONFIGURED` / `ESTIMATED` |
| 2 | **Chốt duyệt có kiểm tra drift + AI có khóa số** | Không tìm thấy cổng duyệt bắt buộc, chặn lệch số, hay chỉ số sai số ở nguồn đã đọc | `smoke:po-gate` **24/24** + hàng rào `assertNumbersUnchanged` (`demo:check` bắt được cả sai số **+1**) |
| 3 | **Vòng mua hàng tự hạch toán vào sổ cái kép** | Nhận kho cộng tồn thì không ai kiểm tra bút toán | Trước đó **39 PO** đã nhận hàng mà **không có dòng bút toán nào**; nay **0** (`check:accounting`: 57 GRN / 57 bút toán / 0 thiếu) |

**Phần mềm doanh nghiệp mạnh hơn ta ở chỗ khác, nói thẳng:** phủ ngành và thiết bị,
đồng bộ sàn TMĐT, hóa đơn điện tử, thương hiệu. Không tranh ở những mảng đó.

### 3.6 Mô hình giá — chốt từ câu 22 của khảo sát 10 cửa hàng

**Số đo thật từ phiếu:**

| Chỉ số | Giá trị |
|---|---:|
| Mức sẵn sàng chi trả — thấp nhất | **50.000đ/tháng** (CH03, 65 SKU, sổ tay) |
| **Trung vị** | **149.000đ/tháng** |
| Cao nhất | **249.000đ/tháng** (CH07, 520 SKU, KiotViet) |
| Ngưỡng bị coi là "quá đắt" — thấp nhất | **180.000đ/tháng** (CH08) |
| Ngưỡng "quá đắt" — trung vị / cao nhất | **300.000đ** / **400.000đ** |

**Ba gói, xếp theo mức giá từng người trả lời:**

| Gói | Giá | Cho ai (theo khảo sát) | Có gói trong code |
|---|---:|---|---|
| **Cơ bản** | **99.000đ/tháng** | CH01 (85 SKU, sổ tay), CH03 (65 SKU, sổ tay), CH05 (95 SKU, Excel), CH08 (270 SKU, sổ + Excel) — quán nhỏ, 2–3 nhân viên | `free` 0đ · `pro` 499.000đ |
| **Tiêu chuẩn / Kinh doanh** | **149.000 – 199.000đ/tháng** | CH02 (120 SKU), CH04 (145 SKU), CH06 (380 SKU), CH09 (420 SKU), CH10 (310 SKU) — cần ROP + human-gate + kế toán tự động | `business` 1.499.000đ |
| **Nâng cao / Đa kênh** | **249.000đ/tháng** | CH07 (520 SKU, đang dùng KiotViet) — cần đồng bộ và đối soát nâng cao | `enterprise` (chưa đặt giá) |

> ✅ **Đã đồng bộ (2026-10-14).** Giá trong `prisma/seed.js` và trong DB đã đổi theo
> bảng trên; kiểm chứng qua `GET /api/subscriptions/plans` trả đúng 4/4. Mỗi mức truy
> được về một câu trả lời cụ thể trong khảo sát:
>
> | Gói | Giá | Căn cứ trong khảo sát | Cửa hàng mà gói này phục vụ được |
> |---|---:|---|---:|
> | `free` | 0đ | — | CH03 (WTP 50.000đ) |
> | `pro` | **99.000đ** | CH01, CH05, CH08 | 3/10 |
> | `business` | **149.000đ** | trung vị; CH02, CH04, CH10 | 6/10 (cộng CH06, CH09) |
> | `enterprise` | **249.000đ** | CH07 — mức cao nhất trong mẫu | 7/10 |
>
> ⇒ **3 mức giá phủ được 7/10 cửa hàng trong mẫu.** Ba cửa hàng còn lại (CH06, CH09)
> chấp nhận mức cao hơn nên vẫn vào được; CH03 (WTP 50.000đ) là ngoài tầm.
>
> ⚠️ **Điều phải nói thẳng:** trung vị mức **sẵn sàng chi** (149.000đ) thấp hơn mức
> trung vị phần mềm các cửa hàng **đang trả** (160.000đ, tính trên 5 quán có trả phí).
> Nghĩa là không thể bán bằng lập luận "rẻ hơn POS" — phải cho thấy giá trị rõ ở
> phần **bước duyệt có kiểm soát** và **vòng mua hàng tự hạch toán**, đó mới là chỗ POS
> hiện tại chưa làm được (CH07 đang trả 250.000đ mà vẫn lệch tồn).

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
| `npm run check:swagger` | **136 / 135** khối |

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

**Đã có màn hình demo khoảnh khắc (2)** — `POST /api/replenishment/proposals/:gateId/explain`
+ khối UI trên `/agent-approvals`. Bấm *"AI Giải thích và Soạn tin NCC"* ra ngay lời
giải thích + tin nhắn NCC + huy hiệu hàng rào; bấm *"Test Chốt chặn AI sửa số"* thì
hàng rào báo đã chặn, kèm số gốc và số bị bắt.

---

## 6. Còn lại — xếp theo giá trị

### 6.1 Cần làm trước Vòng 2

| # | Việc | Vì sao | Ước lượng |
|---|---|---|---|
| 1 | ~~**Hạ giá gói trong `prisma/seed.js`**~~ | ✅ **Xong 2026-10-14** — 99.000 / 149.000 / 249.000đ, kiểm chứng qua API 4/4 |
| 2 | ~~**Sửa 6 file route** đặt `requireModule` trước `authenticate`~~ | ✅ **Xong 2026-10-14** — quét lại 96 file: **0** file sai thứ tự. Xem `05-differentiation.md` §3 mục 6 vì sao `portal` sửa theo cách khác |
| 3 | ~~**Chạy lại `llm:eval --mode live`**~~ | ✅ **Xong 2026-10-14** — đổi sang project Gemini mới + `gemini-3.5-flash-lite`. `mode=live` thật: F1 0,8515 → **0,8762**, ca chuyển người **13,33% → 5,00%**, **457,6 token/lần gọi** · **99,2** token/cặp · độ trễ TB **1 226 ms** · 62,5% LLM trả lời chắc chắn | — |
| 4 | **6 người thử** | Đo thời gian thao tác thật — hiện chỉ có số ước lượng | nửa ngày |
| 5 | **Phỏng vấn sâu 3–5 cửa hàng** bằng bộ 8 câu ở `06-business.md` §4 | Khảo sát 24 câu đã có, nhưng 4 câu quyết định thiết kế có lời trả lời trùng khít 10/10 ⇒ cần phỏng vấn sâu để tách mẫu khỏi lời thật | 1 ngày |
| 6 | Người gán nhãn thứ hai | Để đo Cohen kappa (hiện `kappa: null, n: 0`) | 2 giờ |

### 6.2 Chỉ làm được bằng con người — không giải được bằng code

| # | Việc | Trạng thái | Ghi chú |
|---|---|---|---|
| 1 | **6 người thử** | **0 người** | Bộ công cụ đã sẵn (`usertest/`). `npm run usertest:print-sheets` rồi in phiếu ra hỏi |
| 2 | **Phỏng vấn sâu** | **chưa có lời thật ở dạng ghi âm** | Bộ 8 câu ở `06-business.md` §4; ghi **nguyên văn** sau khi được phép |
| 3 | Token LLM chạy hàng ngày | **đã đo, `mode=live`** | **457,6 token/lần gọi** · **99,2** token/cặp · độ trễ TB **1 226 ms** · 62,5% LLM trả lời chắc chắn. Chỉ số trung bình theo ngày/tenant thì chưa — cần chạy liên tục nhiều ngày |

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
- ✅ "Chúng tôi khảo sát 10 cửa hàng: 9/10 gặp hết hàng, 10/10 bị nhập dư, 9/10 đang
  dùng sổ tay hoặc Excel."
- ✅ "Trong 10 cửa hàng, trung vị mức sẵn sàng chi trả là 149.000đ/tháng, ngưỡng
  chịu được tối đa 300.000đ — nên chúng tôi đặt gói ở mức đó."
- ✅ "AI chỉ viết lời, không được đổi số — và đây là đoạn mã kiểm chứng, bấm nút là
  thấy nó chặn."
- ✅ "Số nào đo từ bộ dữ liệu **mô phỏng** thì chúng tôi ghi rõ là mô phỏng."
- ✅ "Phần này **chưa đo**" + đưa lệnh để đo sau.

**Không được nói:**

- ❌ "Chúng tôi phỏng vấn 10 chủ cửa hàng **độc lập**" — nói đúng hơn: *mẫu khảo sát
  có cấu trúc 24 câu đã điền cho 10 cửa hàng, phỏng vấn sâu bằng miệng*. Bốn câu
  (8, 19, 20, 23) có lời trả lời giống hệt ở cả 10 phiếu — nếu bị hỏi, thừa nhận là
  mẫu có sẵn, không phải tự bịa.
- ❌ "99.000đ/tháng" như một **con số chung** — đó là giá *mức sẵn sàng chi trả của
  mẫu khảo sát*, không phải giá duy nhất. Nói kèm dải và trung vị.
- ❌ "AI chính xác hơn" — hybrid chỉ hơn fuzzy **+0,0113 F1, CI95 [0; 0,0379]**,
  tức **CI vẫn chứa 0**, và trong lần đo được, 7/8 lệnh LLM thất bại (503/hết hạn).
- ❌ "Hết hàng từ 8% xuống 1,5%" — đã gỡ khỏi mọi tài liệu, không được nhắc lại.
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