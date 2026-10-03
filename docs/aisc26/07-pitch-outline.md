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
   → hệ thống tính số lượng cần đặt (ATP − ROP)
   → NGƯỜI DUYỆT  ← bắt buộc, bỏ qua là không có PO
   → tạo đúng 1 đơn nhập
   → hàng trên đường chặn đề xuất trùng
```
*(kèm ảnh chụp `/agent-approvals`)*

**Ghi chú nói**
> "Ba phần còn lại của phần mềm — POS, sàn thương mại điện tử, hóa đơn điện tử — tôi sẽ
> nói ở slide 9 rằng chúng tôi **không** làm."

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
> "Tôi liệt kê cái này trước khi giám khảo kịp hỏi. Có một ô trong bảng giá của chúng tôi
> ghi `AI` là của gói Business — nhưng **đo được** là `ai` và `replenishment` **chưa được
> gate ở đâu cả**, và 18/92 file route đặt middleware kiểm tra gói **trước** middleware
> xác thực nên kiểm tra đó **fail-open**. Nói thẳng: **paywall hiện chưa đáng tin.** Sửa nó
> là việc đầu tiên trước khi bán bất kỳ gói nào."

---

## Slide 10 — Hạn chế đã biết + cái chúng tôi cần

**Trên màn hình**
**CHƯA CÓ DỮ LIỆU (không điền số):**
| Cần đo | Vì sao chưa có | Lệnh/đường đi |
|---|---|---|
| Chi phí LLM thật | Chưa đặt key; `LlmUsageLog` mới chỉ có dữ liệu `replay` | đặt key → `npm run check:llm`, `npm run llm:eval` |
| Độ đúng khớp SKU | Bộ nhãn tay 120 cặp **đang để trống** | `npm run llm:labels` → gán nhãn → `npm run llm:eval` |
| Thời gian người thử | Bộ công cụ đã sẵn, **chưa có ai thử** | `docs/aisc26/usertest/README.md` |
| Nhu cầu khách hàng, mức giá | **Chưa phỏng vấn ai** | bộ 8 câu ở `06-business.md` §4 |
| Thí nghiệm có ràng buộc ≥ 95% | post-hoc chưa đủ; cần lưới rộng hơn, tiền đăng ký mới | `03-evaluation-protocol.md` §13.2 |

**Hạn chế kỹ thuật đã biết:** chưa đo được chi phí LLM · giao diện đọc được trạng thái
"lơ lửng" nhờ endpoint mới `GET /api/agent/human-gates/by-status` (chỉ đọc) · luồng demo
bỏ qua `pg_notify` và phần HTTP (có script riêng phủ) · CROSTON không vượt ROP trên tập này.

**Ghi chú nói**
> "Tôi kết thúc bằng cái tôi **không** có. Bốn ô trên đều ghi 'chưa có dữ liệu' và tôi để
> nguyên. Nếu tôi điền số vào chúng thì tôi chỉ đang kể một câu chuyện đẹp hơn, không
> phải một sản phẩm tốt hơn."

---

## Phụ lục slide dự phòng (không trình bày, để trả lời)

| A | Sổ kiểm chứng: `npx jest` · `check:modules` 203 · `check:tenant` 11/11+4/4+4/4 · `smoke:po-gate` 24/24 · `smoke:demo-flow` 12/12 · `check:humangate` 11/11 · `check-tenant-aidocs` 12/12 |
| B | Bảng frontier của thí nghiệm 2 (9 cấu hình, fill rate × giá trị tồn) |
| C | Ma trận so sánh đầy đủ 4 đối thủ + nhãn bằng chứng `[MỞ]`/`[TRÍCH]` |
| D | So đồ vai trò công thức / LLM / con người (`01-llm-role.md` §1) |
