# 07 — Dàn ý thuyết trình (10 slide)

**Ngày:** 2026-10-03 · **Bám theo:** T17 · **Đi ước:** 8–10 phút · **Kịch bản 5 phút:** `04-demo-script.md`

## Luật kể chuyện (dán lên bàn phím)

1. **KHÔNG** nói "ROP tốt hơn". Kết quả thí nghiệm 1 phải kể **kèm số xấu**: bán ít hơn
   **9,5%**, mất bán nhiều hơn **31,5%**, tỉ lệ lấp đủ yêu cầu **69,51% so với 76,81%**.
2. Chỉ được nói: **khung đánh giá trung thực** + **ở cùng mức phục vụ, ROP trói ít vốn
   hơn** (thí nghiệm 2, **post-hoc**, ràng buộc 95% **không khả thi**, tối đa **88,66%**).
3. **KHÔNG** nói "chính xác hơn KiotViet/Sapo". Luận điểm khác biệt: **đề xuất có cổng
   duyệt bắt buộc + sai số đo được**.
4. LLM · người thử · phỏng vấn: ghi **"CHƯA CÓ DỮ LIỆU"**. Không điền số ước lượng.
5. Slide dữ liệu phải có **nguồn + giấy phép CC BY 4.0**.

---

## Slide 1 — Vấn đề

**Trên màn hình**
- Cửa hàng bán lẻ 300–500 SKU, 1–2 người trông.
- Khi một món sắp hết, ba cách xử lý: đoán, gọi điện, hoặc đặt thừa cho chắc.
- Hết hàng ⇒ mất bán **và** mất khách. Đặt thừa ⇒ vốn nằm không.

**Ghi chú nói**
> "Tôi không mở app bán hàng nào ở đây. Tôi nói đúng cái nỗi này: người ta **không thiếu
> phần mềm quản lý tồn kho** — KiotViet, Sapo đã làm. Họ thiếu một thứ khác: **một con
> số đặt hàng có căn cứ, và ai đó có quyền nói không trước khi tiền đi.**"

---

## Slide 2 — Đúng một luồng, hôm nay tôi trình diễn

**Trên màn hình**
```
Cảnh báo sắp hết hàng
   → hệ thống tính số lượng cần đặt (ATP − ROP, lead time ĐO ĐƯỢC từ lịch sử PO→GRN)
   → NGƯỜI DUYỆT  ← bắt buộc, bỏ qua là không có PO; lệch số thì chặn
   → tạo đúng 1 đơn nhập
   → nhập kho (một phần) + QC
   → HẠCH BÚT TOÁN: Nợ 156 + Nợ 1331 = Có 331   ← phần chúng tôi tự thấy là đang thiếu
   → công nợ NCC tăng
   → AI chỉ viết lời giải thích + tin nhắn NCC, KHÔNG được đổi số (hàng rào kiểm bằng mã)
```
*(kèm ảnh chụp `/agent-approvals`)*

**Ghi chú nói**
> "Đây là **một quy trình, đi trọn tới sổ cái** — không dừng ở bước tạo đơn. Ba phần còn
> lại của phần mềm — sàn thương mại điện tử, hóa đơn điện tử, chấm công — tôi sẽ nói ở
> slide 9 rằng chúng tôi **không** làm."

---

## Slide 3 — Ai tính cái gì (công thức / AI / con người)

**Trên màn hình**
| Việc | Ai quyết định |
|---|---|
| ATP, nhu cầu/ngày, lead time, tồn kho an toàn, **ROP**, số lượng đặt, chọn NCC | **Công thức** (8 dòng) |
| Khớp tên hàng lộn xộn trên sàn → SKU nội bộ | **AI** (ràng buộc) |
| Diễn giải đề xuất + soạn tin cho NCC | **AI** (chỉ soạn, **không gửi**) |
| **Có tạo đơn nhập không** | **Con người** |

**Ghi chú nói**
> "**AI không được phép tính bất kỳ con số nào của quyết định đặt hàng.** Đây là luật
> kỹ thuật, không phải lời hứa: có một bộ test chạy với AI giả trả về con số sai và khẳng
> định số cuối cùng không đổi. AI làm đúng hai việc công thức không làm được, và **tắt
> AI thì luồng vẫn chạy trọn** — hôm nay tôi đang chạy đúng chế độ đó."

---

## Slide 4 — Khác biệt #1: cổng duyệt không thể bỏ qua

**Trên màn hình**
- Không duyệt ⇒ **không tồn tại** đơn nhập (không phải "đã tạo, cần xác nhận sau").
- Lúc duyệt, số liệu **được tính lại từ cơ sở dữ liệu**. Lệch quá ngưỡng ⇒ chặn + bảng
  khác biệt; phải **tự xác nhận có chủ đích** mới qua.
- Bấm duyệt hai lần ⇒ **một** đơn (đảo trạng thái bằng `updateMany` có điều kiện).
- Có hàng trên đường ⇒ không sinh đề xuất trùng.
- Từ chối mà **không ghi lý do** ⇒ không làm được.
- Thiếu giá vốn ⇒ `409` chặn, không cho tạo PO bằng giá 0.

**Ghi chú nói**
> "Bằng chứng là lệnh, không phải lời: `npm run smoke:po-gate` **24/24 trên cơ sở dữ liệu
> thật**, trong đó có kịch bản *đề xuất không có duyệt ⇒ không có PO* và *bấm duyệt hai
> lần ⇒ một PO*. Tôi **không** tuyên bố là đối thủ không có; tôi nói là **trong các
> trang tôi đã đọc, tôi không tìm thấy**."

---

## Slide 5 — Khác biệt #2: sai số đo được — và số xấu đi trước

**Trên màn hình — dữ liệu công khai, mô phỏng**
- Nguồn: **UCI Online Retail II (CC BY 4.0)** · 500 SKU · 739 ngày · 3 cửa sổ kiểm định ·
  lead time 3/7/14 ngày · 2 cách xử lý ngày hết hàng.
- **Thí nghiệm 1 (tiền đăng ký, giao thức commit trước lần chạy đầu):**
  ROP thắng ngưỡng `minStock` cố định trên chỉ số chính (hiệu số −0,4973, CI 95%
  [−0,6172; −0,3982], 377/471 SKU thắng) — **nhưng cái đổi lại là**:
  | | ngưỡng cố định | ROP |
  |---|---:|---:|
  | Đơn vị bán | 849.998 | 769.199 (**−9,5%**) |
  | Đơn vị mất bán | 256.558 | 337.357 (**+31,5%**) |
  | Tỉ lệ lấp đủ yêu cầu | 76,81% | **69,51%** |
- ⇒ **Chỉ số chính không có sàn dịch vụ, nên nó thưởng cho việc bán ít. Ta không kết luận
  "ROP tốt hơn".**

**Ghi chú nói**
> "Đây là chỗ tôi muốn giám khảo tập trung nhất. Chúng tôi đăng ký giao thức đánh giá
> **trước** lần chạy đầu, để không chỉnh sau khi thấy số. Kết quả đầu tiên **không** đẹp,
> và nguyên nhân nằm ở **thiết kế của chính phép đo**, không phải ở công thức. Tôi chọn
> nói nó trước khi nói phần tốt."

---

## Slide 6 — Thí nghiệm 2 (post-hoc): ở cùng mức phục vụ, trói ít vốn hơn

**Trên màn hình**
| | P2 `z=0,95` | P1 `DOC=28` |
|---|---:|---:|
| Tỉ lệ lấp đủ yêu cầu | 75,67% | 85,42% |
| Giá trị tồn TB / SKU | **343,31** | 1.072,87 |

- Trên tập SKU **cùng mức phục vụ** (n = **132/500**): chênh **−954,63**/ngày,
  CI 95% **[−1.209,95; −752,92]** không chứa 0, **99,24%** SKU thắng.
- Ngưỡng cố định **không bị loại — chỉ bị đẩy lên cao**: muốn lên 85,42% nó phải tăng
  gấp **2,4 lần** giá trị tồn.
- **Ràng buộc mức phục vụ 95% KHÔNG khả thi** với cả bốn phương án; cao nhất đạt
  **88,66%**. ⇒ câu *"ở mức 95% thì sao?"* **chưa trả lời được**.

**Ghi chú nói**
> "Thí nghiệm này **post-hoc** — tôi đăng ký hàm mục tiêu **sau khi đã thấy** kết quả
> thí nghiệm 1, nên nó là **khám phá**, không phải kết luận tiền đăng ký. Nó **không** sửa
> kết luận thí nghiệm 1. Nó chỉ trả lời một câu hẹp: **ở cùng một mức phục vụ, phương
> án nào trói ít vốn hơn.**"

---

## Slide 7 — Dữ liệu: nguồn, giấy phép, giới hạn (đọc thành tiếng)

**Trên màn hình**
- **UCI Online Retail II — CC BY 4.0** (`02-data.md`: URL, `sha256`, ngày truy cập
  2026-10-03). Bốn bảng suy ra từ tệp gốc.
- Nhãn: **MÔ PHỎNG**. Giá tính bằng **sterling của tệp dữ liệu**, không quy đổi.
- **Giới hạn phải nói:** một nhà bán, một quốc gia, một mặt hàng, 25 tháng. Tệp gốc
  **không có** tồn kho, **không có** lead time quan sát được, **không có** kênh bán,
  **không có** giá vốn ⇒ mọi chỉ số tồn kho là mô phỏng. Giá vốn là **giả định**.
  3 cửa sổ, 1 tập dữ liệu. 27/500 SKU không dùng được cho đối chiếu từng SKU.
- **Nhánh hành vi quan sát (PO thật): SKIPPED** — tệp gốc không có dữ liệu mua.

**Ghi chú nói**
> "Nếu tôi chỉ có một slide để làm thành thật, đây là slide đó. Chúng tôi không có khách
> hàng thật, không có dữ liệu vận hành thật. Cái chúng tôi có là **một khung đánh giá
> công khai, chạy được, tái lập được** — và đó là cái tôi muốn giám khảo kiểm."

---

## Slide 8 — So với đối thủ, trên đúng luồng này

**Trên màn hình** (rút gọn từ `05-differentiation.md`, nguồn + ngày ở
`notes/competitors.md`)
| Bước | KiotViet | Sapo | VietPOS.AI | CMBcoreSeller | **Chúng tôi** |
|---|:---:|:---:|:---:|:---:|:---:|
| Tính được số lượng cần đặt | ❌ | ◐ | ❌ (sắp có) | ◐ | ✅ công thức + cờ ước lượng |
| **Cổng duyệt bắt buộc** | ❌ | ❌ | ❌ | ❌ | ✅ không duyệt ⇒ không có PO |
| Chặn khi số liệu lệch | — | — | — | — | ✅ `DRIFT_BLOCK` / `409` |
| Chống tạo PO trùng | — | — | — | — | ✅ khóa nguyên tử theo `onOrder` |
| **Đo được sai số** | ❌ | ❌ | ❌ | ❌ | ◐ giao thức + backtest (**từ 1 tập công khai**) |

Legend: ✅ có bằng chứng đọc được · ◐ nói chưa rõ phạm vi · **❌ không tìm thấy trong
nguồn đã đọc** (không phải chắc chắn không có) · — chưa xác minh.

**Ghi chú nói**
> "Tôi **không** nói chúng tôi chính xác hơn KiotViet hay Sapo — chúng tôi chưa đo được
> điều đó và đo cũng chưa đủ cơ sở. Chỗ tôi đứng được là **hai ô cuối**: cổng duyệt và
> chỉ số sai số. Và tôi thừa nhận thẳng: ở POS, kênh sàn, hóa đơn điện tử, khách hàng
> và độ tin cậy thương hiệu, **họ thắng rõ**."

---

## Slide 9 — Chúng tôi KHÔNG làm gì ở Vòng 2

**Trên màn hình**
| Không làm | Vì sao |
|---|---|
| POS bán tại cửa hàng, máy in bill, máy POS | Đối thủ mạnh hơn rõ ràng; ta một luồng, một nhóm SKU nhỏ |
| Đồng bộ Shopee/TikTok/Lazada thời gian thực | Luồng demo lấy đơn từ **tệp xuất mô phỏng** ⇒ **không được nói "đa kênh"** |
| Hóa đơn điện tử, chữ ký số | Đã có mã nối VNPT nhưng chưa nghiệm thu ở Vòng 1 |
| Chấm công, lương, sản xuất/BOM | Ngoài phạm vi chấm |
| Đa tenant tách vật lý 1 khách = 1 DB | Ta cách ly bằng lớp truy vấn + kiểm thử 11+4+4 trên DB thật |
| Nhận tiền, đăng ký dịch vụ | Chưa tới giai đoạn đó |

**Ghi chú nói**
> "Tôi liệt kê cái này trước khi giám khảo kịp hỏi. `ai` và `replenishment` **đã** được
> gate đúng như bảng giá khai báo — nhưng còn **6/96** file route đặt middleware kiểm tra
> gói **trước** middleware xác thực, nên 6 module đó **chưa thực sự bị chặn theo gói**.
> Tôi không nói 'AI chỉ ở gói Business' như một điều đã bảo đảm, và sửa nốt 6 file đó là
> việc đầu tiên trước khi bán bất kỳ gói nào."

---

## Slide 10 — Đã đo được gì, và còn thiếu gì

**ĐÃ ĐO ĐƯỢC — số thật, chạy lại được bằng lệnh:**

| Chỉ số | Số | Lệnh kiểm chứng |
|---|---|---|
| PO đã nhận hàng mà **thiếu bút toán** | **39 → 0** | `npm run check:accounting` |
| Bút toán `tenantId` NULL (cách ly tenant vỡ) | **18 → 0** | `npm run check:tenant` |
| Màn hình đề xuất **ẩn** SKU dưới ngưỡng | **458 / 468 → 0** | `npm run measure:evidence` |
| PO có **lead time đo được** | **0/20 → 57/57** | `npm run demo:check` |
| **Token thật** mỗi lần gọi LLM | **457,6** · **99,2**/cặp · độ trễ **1 226 ms** | `npm run llm:eval -- --mode live` |
| Ca chuyển người khi khớp SKU mơ hồ | **13,33% → 5,00%** (8/60 → 3/60) | `npm run llm:eval -- --mode live` |
| Tỉ lệ chuyển người khi SKU mơ hồ | **13,33%** | `npm run llm:eval` |
| Khảo sát 10 cửa hàng: hết hàng / nhập dư / muốn đề xuất | **9/10 · 10/10 · 9/10** | tệp khảo sát, sheet `TONG HOP` |
| Trung vị sẵn sàng chi trả | **149.000đ/tháng** (dải 50–249k) | cột E dòng 28 các phiếu `CH01`–`CH10` |

**CHƯA CÓ DỮ LIỆU — để trống, không điền số:**

| Cần đo | Vì sao chưa có | Lệnh/đường đi |
|---|---|---|
| Độ đúng khớp SKU của **phần AI** | `mode=live` **đã chạy thật**: F1 0,8515 → **0,8762**. Nhưng CI95 [−0,014 ; 0,0679] **vẫn chứa 0** ⇒ không kết luận được hybrid tốt hơn | cần mẫu nhiều hơn để CI tách khỏi 0 |
| Chênh lệch hybrid vs fuzzy | **+0,0113 F1, CI95 [0; 0,0379]** — CI **vẫn chứa 0**, chưa kết luận được | cần mẫu LLM thành công nhiều hơn |
| Độ tin cậy giữa người gán | chỉ 1 người gán ⇒ Cohen kappa chưa đo được | cần người gán thứ hai, độc lập |
| Độ đúng khớp SKU trên dữ liệu xuất sàn thật | tệp UCI chỉ dùng để dựng bộ nhãn | cần tệp xuất sàn thật |
| Thời gian người thử | Bộ công cụ đã sẵn, **chưa có ai thử** | `docs/aisc26/usertest/README.md` |
| Lời phỏng vấn **sâu** dạng ghi âm | khảo sát 24 câu đã có; nhưng 4 câu (8, 19, 20, 23) trùng khít 10/10 nên cần hỏi sâu để tách mẫu khỏi lời thật | bộ 8 câu ở `06-business.md` §4 |
| Thí nghiệm có ràng buộc ≥ 95% | post-hoc chưa đủ; cần lưới rộng hơn, tiền đăng ký mới | `03-evaluation-protocol.md` §13.2 |

**Hạn chế kỹ thuật đã biết:** 6 file route còn đặt middleware kiểm gói trước middleware xác thực ⇒ 6 module chưa thật sự bị chặn theo gói, nên tôi không nói "AI chỉ ở gói Business" như một điều đã bảo đảm. · Luồng demo bỏ qua `pg_notify` và phần HTTP (có script riêng phủ) · Giá gói trong seed còn cao hơn trung vị khảo sát 3,3 lần, đang hạ. · CROSTON không vượt ROP trên tập này.

**Ghi chú nói**
> "Tôi kết thúc bằng hai phần. Phần một là những gì **tôi tự đo được, và tự tìm ra lỗi
> của chính mình**: 39 đơn mua không vào sổ cái, 458 SKU bị màn hình giấu mất, lead time
> chết âm thầm — giờ cả ba đều bằng 0 hoặc bằng 57/57.
>
> Phần hai là những ô tôi **để trống**: token LLM chạy hàng ngày, thời gian người dùng,
> và lời phỏng vấn sâu dạng ghi âm. Tôi có thể điền số vào chúng bằng những con số nghe
> rất thuyết phục. Nhưng khi anh/chị hỏi "con số đó lấy từ đâu", tôi sẽ không có câu trả
> lời — và người mất niềm tin lúc đó là tôi, chứ không phải con số."

---

## Phụ lục slide dự phòng (không trình bày, để trả lời)

| A | Sổ kiểm chứng: `npx jest` · `check:modules` 203 · `check:tenant` 11/11+4/4+4/4 · `smoke:po-gate` 24/24 · `smoke:demo-flow` 12/12 · `check:humangate` 11/11 · `check-tenant-aidocs` 12/12 |
| B | Bảng frontier của thí nghiệm 2 (9 cấu hình, fill rate × giá trị tồn) |
| C | Ma trận so sánh đầy đủ 4 đối thủ + nhãn bằng chứng `[MỞ]`/`[TRÍCH]` |
| D | So đồ vai trò công thức / LLM / con người (`01-llm-role.md` §1) |
