# STATE-P3 — trạng thái gói P3 (T7 + T8), chế độ song song

> File này **không** thay `docs/aisc26/STATE.md` (P1 đang giữ). Khi P1 hợp nhất, chép các
> dòng đánh dấu **[MERGE]** vào `STATE.md`.

| Mục | Nội dung |
|---|---|
| Ngày | 2026-10-03 |
| Nhánh | `round2/p3-research` |
| Worktree | `D:\aduu-p3` (tách từ `round2/p0-hardening` @ `1f1a402`) |
| Không push | đúng — không `push`, không `checkout`/`merge`/`rebase` nhánh khác |
| Không chạm | DB, backend, cổng 4000 — đúng (gói P3 chỉ là tài liệu + đọc mã) |

## Việc trong gói P3

| # | Việc | Trạng thái | Bằng chứng |
|---|---|---|---|
| T7 | Nghiên cứu đối thủ hiện tại + `05-differentiation.md` | **DONE-VERIFIED** (về mặt "có dằn nguồn") | `docs/aisc26/notes/competitors.md`, `docs/aisc26/05-differentiation.md` |
| T8 | `06-business.md` | **DONE-UNVERIFIED phần nhu cầu** — số đo được thì có; phần khách hàng là giả định chưa phỏng vấn | `docs/aisc26/06-business.md` |

## Đầu ra tối thiểu của P3 — đã đạt

- [x] Ma trận so sánh **≥ 3 đối thủ** có nhãn đã tra / chưa xác minh: **4 đối thủ**
  (KiotViet, Sapo, VietPOS.AI, CMBcoreSeller) + 1 tham chiếu (Analy).
- [x] Khách hàng mục tiêu cụ thể + hồ sơ loại trừ.
- [x] **3 phương án giá** (PA/PB/PC) gắn cơ chế gói có sẵn, chọn tạm PA+PC.
- [x] Bộ câu hỏi 8 câu + kế hoạch 5–10 phỏng vấn thật (BLOCKER-HUMAN).
- [x] Kinh tế đơn vị: chỉ số đo thật có nhãn phạm vi; phần còn lại ghi "chưa đo".

## Kiểm chứng (chạy lúc viết, không chạy DB)

| Lệnh | Kết quả | Loại |
|---|---|---|
| `webfetch https://www.kiotviet.vn/phi-dich-vu` | đọc trực tiếp bảng giá bán lẻ 270.000/330.000/490.000đ, `+150.000đ/kho`, "Cảnh báo tồn kho", "Dự báo tiêu thụ" | web thật |
| `webfetch https://vietpos.ai/` | đọc trực tiếp: gói 0/99.000/199.000đ; 4 agent live; **"Agent Đề xuất nhập hàng — Sắp ra mắt"** | web thật |
| `websearch` (Sapo, CMBcore, Analy) | lấy trích trang chính thức; giá chỉ dùng của Sapo (URL chính thức), CMBcore ghi "chưa xác minh" | web thật, nhãn [TRÍCH] |
| `Select-String requireModule\("([^"]+)"\) src/modules/*/*.routes.js` | **30** module key được gate; **không có** `ai`, không có `replenishment` | đọc mã |
| Quét 92 file `*.routes.js`: vị trí `requireModule` vs `authenticate` | **18/92** file đặt `requireModule` trước `authenticate` | đọc mã |
| `plan.middleware.js:68,109` | `requireModule`/`checkFeature` **fail-open** khi chưa có `req.user` | đọc mã |
| `prisma/seed.js:296–357` | free 0 · pro 499.000 · business 1.499.000 · enterprise price 0 | đọc mã |

Không chạy `npx jest`/`check:*` trong gói này: **không sửa mã**, chỉ thêm tài liệu.

## Số liệu đã dùng (đừng tự đổi)

- Giá gói trong mã: **0 / 499.000 / 1.499.000 VND/tháng** (`free`/`pro`/`business`).
- Số module key được gate: **30**. File route đặt sai thứ tự: **18/92**.
- Giá đối thủ (2026-10-03): KiotViet **270.000/330.000/490.000**; Sapo
  **170.000/249.000/449.000/600.000/999.000**; VietPOS.AI **0/99.000/199.000**.
- Giá trị đơn hàng TB của dữ liệu demo: **89.862.000 ÷ 82 = ≈ 1.095.878 VND/đơn**
  (DB local thật, 1 tenant mẫu — **không** dùng để suy rộng).
- Ba số cũ (−90%, 8%→1,5%, 98,5%) **không** xuất hiện trong tài liệu P3.

## Phát hiện đáng chú ý (cho đội biết)

1. **Khác biệt "AI gợi ý đặt hàng" đã có người tuyên bố trước.** CMBcore ghi tính năng
   "Dự báo & đề xuất nhập hàng — Đang chạy" (chưa mở trực tiếp xác minh); Sapo mô tả
   "tự động đề xuất nhập hàng" theo ngưỡng. ⇒ Luận điểm khác biệt đã **đổi** thành: *đề xuất
   có cổng duyệt bắt buộc + sai số đo được bằng backtest công khai*.
2. **Gating theo gói không có hiệu lực cho luồng demo.** `ai` và `replenishment` không
   được gate ở đâu cả ⇒ **Free cũng dùng được** luồng đề xuất đặt hàng, dù `allowedModules`
   của gói `business` có `"ai"`. Ngoài ra 18/92 file đặt `requireModule` trước
   `authenticate` mà middleware lại fail-open.
3. **VietPOS.AI tự mâu thuẫn giá trên cùng trang** (bảng 99k/199k vs đoạn văn
   "170k→490k") — nhắc đội đừng trích nhầm khi so sánh.

## [MERGE] — gợi ý để P1 đưa vào STATE.md / MORNING-REPORT.md

- T7: **DONE-VERIFIED** — `05-differentiation.md` + `notes/competitors.md`; luận điểm
  khác biệt đã chốt và **không** dùng "AI đề xuất đặt hàng" làm điểm khác biệt.
- T8: **DONE-UNVERIFIED phần khách hàng** — `06-business.md`; 3 phương án giá, chọn tạm
  PA+PC; **BLOCKER-HUMAN**: 5–10 phỏng vấn.
- Phát hiện mới cần đưa vào danh sách "rủi ro còn lại": paywall chưa bảo đảm (§5.2 của
  `06-business.md`) — trước đây ghi "16 router", đo lại được **18/92 file**.
- Sổ kiểm chứng P3: xem bảng trên (không có mục DB thật vì gói này không đụng DB).

## Bước tiếp theo

- `PACKAGES.md` §4: sau P3 là **P4** (T9 — nạp dữ liệu + khớp SKU không-LLM). P4 **không**
  được chạy song song với P1 vì cần `scripts/` và có thể đụng dữ liệu ⇒ chờ P1 xong.
- Trước khi trình bày: mở trực tiếp 3 trang ghi nhãn [TRÍCH] (Sapo, CMBcore) để đổi nhãn
  sang [MỞ], hoặc nói "chưa xác minh" trên slide.