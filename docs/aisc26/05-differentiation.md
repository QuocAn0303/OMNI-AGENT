# 05 — Pha 5: Khác biệt với KiotViet / Sapo (T7, gói P3)

Ngày tra cứu: **2026-10-03**. Mọi nhận định về đối thủ gắn URL + ngày; nguồn thẳng chi tiết
nằm ở [`notes/competitors.md`](notes/competitors.md). Không có bằng chứng thì ghi
"chưa xác minh".

**Phạm vi so sánh: đúng một luồng demo của Vòng 2** — *cảnh báo sắp hết hàng → đề xuất đặt
hàng (kèm số lượng) → người có quyền duyệt → tạo PO*. Không so sánh POS, sàn TMĐT,
hóa đơn điện tử, chấm công — ở những mảng đó đối thủ mạnh hơn ta rõ ràng và ta không
tranh.

---

## 1. Đối thủ trong tầm ngắm (và vì sao)

| # | Đối thủ | Vì sao đưa vào | Nhãn bằng chứng |
|---|---|---|---|
| 1 | **KiotViet** | Bảng giá + tính năng kho/cảnh báo/dự báo nổi tiếng nhất | [MỞ] https://www.kiotviet.vn/phi-dich-vu (2026-10-03) |
| 2 | **Sapo** | Đối thủ trực tiếp về đa kênh + có mô tả "tự động đề xuất nhập hàng" | [TRÍCH] https://www.sapo.vn/bang-gia.html + blog 2026-03-11 (2026-10-03) |
| 3 | **VietPOS.AI** | Định vị gần ta nhất: POS+ERP+AI agent, multi-tenant, agent tự cảnh báo | [MỞ] https://vietpos.ai/ (2026-10-03) |
| 4 | **CMBcoreSeller** | Đã tuyên bố "đề xuất nhập hàng AI" + "tạo PO tự chia theo NCC" | [TRÍCH] https://cmbcore.com/phan-mem-ban-hang-da-kenh (2026-10-03) |
| — | Analy (F&B) | Tham chiếu cơ chế "đề xuất nhập" theo tỷ lệ SL/ngày | [TRÍCH] https://analy.co/tinh-nang-quan-ly-kho-nguyen-vat-lieu-gia-von/ (2024-12-13) |

## 2. Ma trận trung thực — trên đúng luồng demo

Legend: **✅** = có bằng chứng đọc được · **◐** = có một phần / nói chưa rõ phạm vi ·
**❌** = không tìm thấy trong nguồn đã đọc (**không** đồng nghĩa chắc chắn là không có) ·
**—** = chưa xác minh.

| Bước trong luồng | KiotViet | Sapo | VietPOS.AI | CMBcoreSeller | **OmniAgent (ta)** |
|---|---|---|---|---|---|
| Cảnh báo tồn kho / sắp hết | ✅ "Cảnh báo tồn kho", "Dự báo tiêu thụ" | ◐ cảnh báo ngưỡng tối thiểu | ✅ agent Kho hàng, dự báo 3–7 ngày | ✅ cảnh báo "còn 8 ngày là hết" | ✅ cảnh báo tồn + tuổi đề xuất |
| **Tính được số lượng cần đặt** | ❌ không thấy | ◐ "đề xuất nhập" theo ngưỡng (blog) | ❌ agent "Đề xuất nhập hàng" **sắp ra mắt** | ◐ "tốc độ bán 30 ngày, tự đề xuất đúng lượng" | ✅ công thức (ATP/ROP) + lead time, có cờ ước lượng |
| **Đề xuất có người duyệt bắt buộc** | ❌ không thấy | ❌ không thấy | ❌ agent tự cảnh báo, chỉ "bấm Gửi" cho tin nhắn nợ | ❌ PO tự chia theo NCC (không thấy cổng duyệt) | ✅ **human-gate**: không duyệt thì không có PO (`smoke:po-gate` 18/18 DB thật) |
| Chặn khi số liệu lệch / không đủ | — | — | — | — | ✅ `DRIFT_BLOCK` (chặn) + `DRIFT_WARN` + `409 MISSING_COST` |
| Chống tạo PO trùng | — | — | — | — | ✅ khóa nguyên tử theo đơn (`onOrder`) |
| Ghi log ai duyệt, số nào | — | — | — | — | ✅ `AuditLog` + `decidedById/decidedAt/decidedNote` |
| **Đo được sai số của đề xuất** | ❌ không thấy | ❌ không thấy | ❌ không thấy | ❌ không thấy | ◐ **giao thức đã viết, backtest CHƯA chạy** (P2/P5) |
| Chi phí LLM trên luồng này | — | — | công bố "~$0.02/KH/tháng" cho bot Telegram | — | ✅ **0đ**: số lượng do công thức quyết định, LLM chỉ giải thích/soạn tin (có đường lui không-LLM) |
| Nhập dữ liệu hàng loạt có sẵn | ✅ | ✅ | ✅ (import Excel) | ✅ | ◐ có `import`, **chưa nạp được lịch sử đơn** (F4 trong `00-scope.md`) |

## 3. Chỗ **đối thủ tốt hơn ta** — nói thẳng

1. **Phủ ngành và thiết bị.** KiotViet có mẫu ngành sẵn, máy POS, máy in, HĐĐT, chữ ký
   số, Public API (chỉ gói Cao cấp). Ta demo **một luồng, một nhóm SKU nhỏ**.
2. **Số khách và độ tin cậy thương hiệu.** Sapo tự công bố 230.000+ khách; KiotViet là
   thương hiệu dẫn đầu. Ta là dự án thi đại, **không có khách hàng thật nào**.
3. **Kênh sàn & vận chuyển đã tích hợp.** KiotViet/Sapo đồng bộ Shopee/TikTok/Lazada,
   Sapo có Sapo Automate. Luồng demo của ta lấy đơn từ **tệp xuất mô phỏng**, không
   phải tích hợp thời gian thực ⇒ **không được nói "đa kênh"**.
4. **Đã có người tuyên bố tính năng đề xuất nhập trước ta.** CMBcore ghi rõ "Đang
   chạy"; VietPOS.AI đã có agent dự báo tồn. Ta không được dùng "có AI đề xuất đặt
   hàng" làm luận điểm khác biệt.
5. **Hạ tầng đa tenant khác hẳn.** VietPOS.AI công bố "1 KH = 1 PostgreSQL DB riêng"
   (tách DB vật lý); ta cách ly bằng scoping cấp truy vấn + AsyncLocalStorage. Hai mô
   hình khác nhau, không so được bằng điểm số.
6. **Gating theo gói hiện chưa đáng tin.** Đo được **18/92** file route đặt
   `requireModule` **trước** `authenticate`, mà `requireModule` **fail-open** khi chưa
   có `req.user` (`src/middleware/plan.middleware.js:109`) ⇒ các module đó thực tế
   **không bị chặn theo gói**. Chưa sửa (không thuộc gói P3).

## 4. Chốt **một** luận điểm khác biệt bảo vệ được

> **Ta bán "đề xuất đặt hàng mà không ai có thể bỏ qua bước duyệt, và sai số đo được
> bằng backtest công khai" — không bán "AI thông minh".**

Vì sao luận điểm này đứng được:

- **Có bằng chứng lệnh hôm nay:** `npm run smoke:po-gate` = **18/18 trên DB thật**
  (đề xuất không có duyệt ⇒ không có PO; có duyệt ⇒ đúng một PO); `check:tenant` PASS;
  `check-tenant-aidocs` 12/12; `check:modules` 203.
- **Đối thủ không có bằng chứng tương đương trong những gì đã đọc:** không tìm thấy cổng
  duyệt, chặn lệch số liệu, hay chỉ số sai số ở cả bốn đối thủ (dòng tương ứng là ❌, và
  ghi rõ ❌ = *không tìm thấy*, không phải *chắc chắn không có*).
- **Hợp với rủi ro mà khách thật sợ:** người ta sợ hệ thống tự quyết tiền. Đây là nỗi
  đau có thể kiểm chứng bằng phỏng vấn (xem `06-business.md`).

**Điều kiện để luận điểm này còn đứng được sau ngày mai:** phải có `03-evaluation-results.md`
(có CI, ba kịch bản lead time, nhãn dữ liệu) và kết quả người thử. Trước khi có, **không
được nói "chính xác hơn KiotViet/Sapo"** — hiện trạng là **chưa đo**, và nói vậy là sai.

## 5. Hạn chế của chính tài liệu này (để đội biết trước khi trích)

- Tìm kiếm trả về nhiều blog nguồn thứ ba với giá **mâu thuẫn nhau** (ví dụ KiotViet 200k /
270k / 330k / 490k / 800k tùy trang). Tài liệu này chỉ dùng số lấy từ **trang chính thức**
  và ghi nhãn [MỞ]/[TRÍCH]; **không** dùng số từ blog để so sánh giá.
- Không tạo tài khoản dùng thử nào ⇒ mọi khẳng định về tính năng của đối thủ là **từ
  trang công bố của họ**, không phải từ trải nghiệm dùng thật.
- [CHƯA XÁC MINH]: giá CMBcoreSeller; hệ thống nội bộ duyệt PO của KiotViet/Sapo; tài liệu
  kỹ thuật/help/wiki của cả bốn (chỉ đọc trang giá + trang chủ).