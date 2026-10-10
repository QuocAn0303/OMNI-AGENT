# FILL-IN — mọi chỗ cần NGƯỜI điền sau khi phiên agent đã dừng

**Lập ngày:** 2026-10-03 (gói P8) · **Nguyên tắc:** chỗ nào chưa có số thì ghi
**"CHƯA CÓ DỮ LIỆU"** — **không** điền số ước lượng, không dán số từ bài báo, không
đoán. Agent chỉ chuẩn bị chỗ trống; phần điền là của con người.

Mỗi mục có: **tệp cần sửa · vị trí · nguồn số liệu · lệnh để lấy số**.

---

## A. Nhãn tay cho bộ đánh giá khớp SKU (chặn mọi số về AI)

| # | Việc | Tệp · vị trí | Nguồn số liệu | Lệnh |
|---|---|---|---|---|
| A1 | Gán nhãn **120 cặp** tên hàng → SKU: cột `label_sku`, `label_confidence`, `label_note` | `data/aisc26/skus/labels/label-sheet.csv` (đã sinh, các cột này **để trống**) | Người biết hàng hoặc tra catalogue; hướng dẫn ở `docs/aisc26/notes/sku-labeling-guide.md` | `npm run llm:labels` (sinh lại bộ) |
| A2 | Nhãn **hai người** độc lập để đo độ khớp: `labeler_a`, `labeler_b` | cùng tệp A1 | hai người gán độc lập, không thấy nhau | — |
| A3 | Chạy đánh giá khớp SKU ở chế độ **thật** | `docs/aisc26/notes/sku-eval-last-run.json` + `docs/aisc26/03-evaluation-results.md` (mục đánh giá SKU) | script tự tính P/R/F1 tại ngưỡng 0,85, `fallbackRate`, ms/cap, bootstrap F1, Cohen kappa | `npm run llm:eval` (không nhãn ⇒ in `BLOCKER-HUMAN` và **từ chối** ra số) |

> **Cấm:** dùng `truth.simulated.csv` (đáp án mô phỏng) để chấm điểm thay cho nhãn tay.
> Tệp đó sinh bằng đúng thuật toán đang đo ⇒ kết quả tự nó cho 100%.

---

## A. Cập nhật 2026-10-10 — nhãn tay ĐÃ CÓ, đã chạy được `llm:eval`

> **A1–A2: XONG (107/120 nhãn).** Kết quả thật: fuzzy không-LLM **P=0,8269 · R=0,8776 ·
> F1=0,8515** (tập kiểm định 60 cặp, 56 có nhãn), chuyển người **13,33%**. Nhưng
> `mode=off` ⇒ **KHÔNG công bố như kết quả AI**; hybrid ≡ fuzzy nên CI = [0; 0];
> token/cặp **CHƯA ĐO**. Bốn giới hạn: `notes/labeling-and-interview-status.md` §1.
>
> **Còn lại trong nhóm A:** (A3a) gán nhãn **13 cặp** còn trống · (A3b) **hai người gán
> độc lập** để đo Cohen kappa (hiện `labeler_b` mới có 2 dòng) · (A3c) chạy `--mode live`
> sau khi có key.

## B. Số LLM thật (chưa có key, chưa chạy `live`)

| # | Việc | Tệp · vị trí | Nguồn số liệu | Lệnh |
|---|---|---|---|---|
| B1 | Xác nhận **có** biến môi trường key (không in giá trị) | `docs/aisc26/01-llm-role.md` §8, `07-qa-prep.md` mục 6 | `npm run llm:policy` in chế độ + có/không key | `npm run llm:policy` |
| B2 | Số token/độ trễ thật theo vai trò | bảng `LlmUsageLog` trong DB local; tóm tắt đưa vào `06-business.md` §6 và slide 10 của `07-pitch-outline.md` | query bảng `llm_usage_logs` sau khi chạy `live` | 1 request thật: `npm run check:llm` (in provider/model/configured, **không** in key). Với số **theo vai trò** thì cần `npm run llm:eval -- --mode live` — nhưng lệnh đó **từ chối chạy** nếu chưa có nhãn tay (mục A), nên làm A1–A3 trước. |
| B3 | Chi phí LLM/ngày/tenant | `docs/aisc26/06-business.md` §6 (dòng "Chi phí LLM/ngày/tenant" đang ghi `chưa đo`) | `token × đơn giá nhà cung cấp tại ngày đo`; hạn mức Free tier xem `docs/aisc26/notes/gemini-free-tier.md` | sau B2 |
| B4 | Điều khoản dữ liệu khi dùng nhà cung cấp miễn phí | `docs/aisc26/notes/gemini-free-tier.md` | trang chính thức của nhà cung cấp (chỉ trích **chiều độ**, không ghi số hạn ngạch vì phải xem trong console) | đọc lại tài liệu chính thức |

> Trong lúc B2–B4 chưa xong: **mọi chỗ chi phí LLM ghi "chưa đo"**. Luồng demo **không**
> cần LLM (mặc định `off`) nên không có lý do gì để bật lên.

---

## C. Bài thử người dùng (6 người) — chưa có ai thử

| # | Việc | Tệp · vị trí | Nguồn số liệu | Lệnh |
|---|---|---|---|---|
| C1 | In bảng SKU cho **bài 1** (không cột đề xuất) và **bài 2** (có cột đề xuất) | `docs/aisc26/usertest/print/sheets.md` (sinh ra, không commit) | `docs/aisc26/usertest/sku-sets.md` | `node scripts/usertest/print-sheets.js --out docs/aisc26/usertest/print` |
| C2 | Chạy 6 phiếu, nhóm `AB`/`BA` xen kẽ, bấm giờ theo giây | `docs/aisc26/usertest/results/tasks.csv` | giấy đã bấm giờ + câu trả lời **nguyên văn** | theo `docs/aisc26/usertest/moderator-guide.md` |
| C3 | Chép số lượng từ phiếu giấy | `docs/aisc26/usertest/results/decisions.csv` | số người thử viết tay — **không sửa**, kể cả khi có vẻ sai | — |
| C4 | Tổng hợp + chấm quyết định tay (P4) | báo cáo in ra + điền vào `03-evaluation-results.md` mục "chưa đo thời gian thao tác" và slide 10 | script | `npm run usertest:summarize -- --tasks docs/aisc26/usertest/results/tasks.csv --decisions docs/aisc26/usertest/results/decisions.csv` |
| C5 | Chép **nguyên văn** câu trả lời vào báo cáo | `07-pitch-outline.md` slide 2/10, `06-business.md` §2 | phiếu giấy, chỉ trích sau khi được phép ghi | — |

> **Dưới 5 người thử: chỉ báo trung vị + khoảng min–max.** Không phần trăm, không p-value,
> **không nói "có ý nghĩa thống kê"**. Script đã in sẵn cảnh báo này.

---

## D. Phỏng vấn khách hàng — số người thật vẫn bằng **0**

> **Đã có công cụ, chưa có người thật.** `docs/AISC_10_Cua_Hang_Da_Dien_Gia_Dinh (1).xlsx`
> gồm 10 phiếu × 24 câu, nhưng **mọi dòng** đều ghi *"GIẢ ĐỊNH – CHƯA KHẢO SÁT"* /
> *"TOÀN BỘ NỘI DUNG TRONG SHEET LÀ TÌNH HUỐNG GIẢ LẬP"* ⇒ **MÔ PHỎNG, không phải phỏng vấn
> thật**. Dùng để mang đi hỏi: xoá cột *"Trả lời thực tế"* rồi điền lại. Chi tiết:
> `notes/labeling-and-interview-status.md` §2.

| # | Việc | Tệp · vị trí | Nguồn số liệu | Lệnh / cách làm |
|---|---|---|---|---|
| D1 | 5–10 cuộc phỏng vấn, 20–30 phút, bộ 8 câu | `docs/aisc26/06-business.md` §4 (bộ câu hỏi đã viết) | trả lời thật, ghi trích **nguyên văn** | tuyển người thật (agent **không** được liên hệ) |
| D2 | Gỡ nhãn "giả định chưa kiểm chứng" ở `06-business.md` §1–§2 | `06-business.md` §1, §2 | chỉ gỡ nơi có trích dẫn thật | sau D1 |
| D3 | Chốt phương án giá PA/PB/PC | `06-business.md` §5.3, `DECISIONS.md` | chỉ chốt được sau D1 | sau D1 |
| D4 | Sửa paywall rồi mới bán gói | `src/middleware/plan.middleware.js`, **18 file** route đặt `requireModule` trước `authenticate`; gate `ai` + `replenishment` | `npm run check:tenant`, smoke | việc kỹ thuật, không cần người ngoài — nhưng **chưa** nằm trong phạm vi Vòng 2 |

---

## E. Những chỗ khác còn ghi "chưa có / chưa đo"

| # | Chỗ để trống | Tệp · vị trí | Điền khi nào |
|---|---|---|---|
| E1 | "nhánh hành vi quan sát (PO thật)" — **SKIPPED** vì tệp UCI không có dữ liệu mua | `03-evaluation-results.md` §4 | khi có tập dữ liệu có PO/GRN thật |
| E2 | Thí nghiệm có ràng buộc mức phục vụ **≥ 95%** | `03-evaluation-protocol.md` §13.2, `03-evaluation-results.md` §5.7 | người quyết có chạy **thí nghiệm 3 tiền đăng ký** với lưới rộng hơn (`z` tới 0,99, `DOC` tới 42) hay không |
| E3 | Duyệt **CC BY 4.0** cho mục đích trình bày | `DECISIONS.md` (còn treo) | quyết định của người |
| E4 | [CHƯA XÁC MINH]: giá CMBcoreSeller · hệ thống duyệt PO nội bộ của KiotViet/Sapo · tài liệu kỹ thuật | `05-differentiation.md` §5 | người tra cứu (tối đa 8 lần đọc trang) |
| E5 | Nhật ký **tiền gửi hàng vào kho** (import lịch sử đơn) chưa có | `00-scope.md` mục F4 | gói sau Vòng 2 |
| E6 | Số người dùng thật / khách hàng thật | mọi slide | **không** điền cho tới khi có; hiện là **0** |
| E7 | Triển khai hotfix cách ly tenant lên môi trường thật (D7) | `docs/aisc26/runbook-tenant-null.md` | người, theo runbook: sao lưu → thử staging → triển khai → `tenant:null -- --scan` → backfill → scan |

---

## F. Thứ tự nên làm sau khi phiên agent dừng

1. **A1–A3** (nhãn tay) — mở khóa mọi số về AI, mất nhiều công nhất.
2. **B1–B3** (key + `live`) — một lệnh, nhưng **không bật lúc trình bày**.
3. **C1–C5** (6 người thử) — cần người thật.
4. **D1–D3** (phỏng vấn, giá).
5. **E2, E3** (quyết định nghiên cứu + giấy phép).
6. **E7** (triển khai) — theo runbook, không theo đường tắt.
