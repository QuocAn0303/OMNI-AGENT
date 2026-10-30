# PACKAGES.md — CHIA VIỆC THEO PHIÊN

## 0. Cách dùng (dành cho người, đọc trước khi ngủ)

**Vấn đề đã xảy ra:** một phiên không chứa nổi T0–T18, agent cạn ngữ cảnh sau T1–T2 và
một phần T4. Cách sửa: **mỗi phiên chỉ làm một gói (P1–P8), xong thì dừng**, phiên
sau bắt đầu sạch từ `STATE.md`.

**Bước chuẩn bị (làm tay, không qua agent, để không tốn ngữ cảnh):**
1. Lưu file `prompt-tu-hanh-qua-dem.md` thành `docs/aisc26/NIGHT-PROMPT.md`.
2. Lưu file này thành `docs/aisc26/PACKAGES.md`.
3. Commit hai file (thư mục `docs/aisc26/` đã được track).

**Chọn một chế độ chạy:**
- **Chế độ A, điều phối bằng sub-agent (chạy được qua đêm):** nếu agent của bạn có
  công cụ tạo sub-agent (kiểu Task/Agent), dán **prompt điều phối ở mục 6**. Điều phối
  chỉ giữ tóm tắt, mỗi gói chạy trong sub-agent có ngữ cảnh sạch.
- **Chế độ B, từng phiên bằng tay:** mở phiên mới, dán **prompt khởi động ở mục 5**
  với `k` là số gói, đợi báo cáo, mở phiên mới cho gói kế tiếp. Không chạy qua đêm
  trừ khi bạn tự dậy giữa chừng.
- **Chế độ C, vòng lặp tự động (tuỳ chọn, tự chịu rủi ro):** nếu CLI của bạn có chế
  độ không tương tác, có thể viết một vòng lặp gọi lần lượt 8 prompt ở mục 5. Không
  viết sẵn lệnh vì tuỳ chọn cấp quyền khác nhau; đọc `--help` của công cụ. Lưu ý: tự
  cấp quyền hàng loạt bỏ đi lớp xác nhận của con người, chỉ còn "hiến pháp" trong
  prompt làm hàng rào. Chỉ làm trên máy có DB local và đã có bản sao lưu.

## 1. Quyết định cho báo cáo vừa rồi (đã ký)

- **T1a (124 `audit_logs` NULL):** chấp nhận ngoại lệ có điều kiện + trần 124. Nhưng
  bằng chứng "userId = NULL, log hệ thống không chủ" gợi ý **có đường mã ghi log mà
  không có tenant context** (khả năng cao là cron/automation thiếu `runWithTenant`,
  đúng điểm P0-5/B3 từng bị đẩy vào backlog). Phải **truy nguồn** (P1): nhóm 124 dòng
  theo `action`/`entityType`/`createdAt`, tìm đường mã ghi chúng; nếu thuộc đường demo
  thì sửa, không thì cập nhật B3 bằng **bằng chứng**. Nếu xác định được theo `action`,
  đổi ngoại lệ từ "trần số lượng" sang "điều kiện theo `action`" (vẫn giữ trần như lưới
  an toàn).
- **T1b/T2/D-003:** chấp nhận. Giữ dòng gốc `company_settings`, `ai_documents` ghi có
  điều kiện tenant, `cleanup-test-residue.js` theo tiền tố.
- **`getOrCreate` tự hội tụ:** chấp nhận (lỗi mã có thể xảy ra ở môi trường thật,
  phát hiện rất tốt). Bổ sung: `orderBy` phải là `[{createdAt:'asc'},{id:'asc'}]`
  (tie-break theo `id`, tránh hai dòng cùng mili-giây). Ghi vào `DECISIONS.md`:
  *"`poApprovalThreshold` NULL hoặc ≤ 0 được coi là chưa đặt → mặc định 5.000.000; muốn
  'mọi PO đều cần duyệt' thì phải dùng giá trị dương nhỏ"*. Đọc xác định là bản vá
  chính; tự xoá dòng thừa chỉ là phụ.
- **`purchase.service.js` ném lỗi thay vì nuốt:** chấp nhận; có test (11/11) là đủ.
- **Rủi ro còn lại:** các script sinh tenant chưa tự dọn sạch → đưa lên **đầu P1**.
- **Ưu tiên lại:** việc dọn dữ liệu đã ngốn ngữ cảnh trong khi các việc giám khảo
  chấm (giao thức, dataset, backtest, khác biệt, kinh doanh, demo) chưa có gì. Từ giờ
  **P2 trở đi là việc giám khảo chấm**; P1 phải gọn.

## 2. Kỷ luật ngữ cảnh (áp dụng cho MỌI gói, bắt buộc)

Nguyên nhân cạn ngữ cảnh thường là: đọc cả tệp lớn, in toàn bộ kết quả test, dán lại
kết quả lệnh dài, lặp lại điều đã biết. Quy tắc:

1. **Đọc tối thiểu.** Chỉ đọc: `STATE.md` (mục `RESUME HERE` + bảng tiến độ),
   `NIGHT-PROMPT.md` mục 3, 4, 5 và **đúng các mục T của gói** (dùng `grep -n`/đọc theo
   khoảng dòng, không đọc cả tệp), và mục gói trong tệp này. Không đọc `AI-HANDOVER.md`,
   `corrections.md`, tài liệu cũ trừ khi gói yêu cầu.
2. **Cắt đầu ra lệnh.** Mọi lệnh có thể dài phải qua bộ lọc (ví dụ
   `Select-Object -Last 25` trong PowerShell). Với `jest`: khi làm việc chỉ chạy **tệp
   test liên quan**; chạy cả bộ **một lần cuối gói** và chỉ ghi các dòng tóm tắt. Không
   dán lại đầu ra vào phản hồi, chỉ ghi kết luận + con số.
3. **Không xem toàn bộ tệp lớn.** Dùng `grep -n` rồi xem khoảng dòng cần.
4. **Nghiên cứu web: ghi ngay, đừng giữ.** Tìm kiếm (đọc đoạn trích) trước, `fetch`
   tối đa số trang nêu trong gói; rút ngay các **sự kiện cần thiết** (kèm URL + ngày)
   vào `docs/aisc26/notes/*.md` rồi **bỏ nội dung trang**. Không dán lại văn bản trang.
5. **Suy nghĩ ngắn, hành động sớm.** Không cân nhắc dài dòng giữa các phương án đã
   được quyết ở `NIGHT-PROMPT.md` hoặc ở tệp này.
6. **Không làm lại việc đã xong** (T1, T2, D-003 và các mốc đã commit). Xác minh bằng
   `git log`/`STATE.md`, không chạy lại thao tác dữ liệu.
7. **Ngưỡng:** khi dùng khoảng **55%** ngữ cảnh, kết thúc việc đang làm, ghi
   `RESUME HERE` (việc đang dở, bước kế tiếp chính xác, tệp liên quan), commit, báo
   cáo và **dừng**. Còn hơn ép thêm rồi mất trạng thái.
8. **Báo cáo cuối gói ≤ 25 dòng:** (i) trạng thái từng việc (DONE-VERIFIED /
   DONE-UNVERIFIED / BLOCKED-HUMAN / SKIPPED) kèm hash; (ii) lệnh kiểm chứng + kết
   luận (DB thật hay mock); (iii) phát hiện đáng chú ý; (iv) việc con người cần làm;
   (v) bước tiếp theo. Cập nhật `STATE.md`, `MORNING-REPORT.md` (sổ kiểm chứng),
   `DECISIONS.md` nếu có quyết định tự động.
9. **Mỗi gói để lại sản phẩm dùng được ngay cả khi chưa trọn:** xem "Đầu ra tối
   thiểu" của từng gói.

Hiến pháp (`NIGHT-PROMPT.md` mục 3) và quy tắc tự quyết (mục 4) áp dụng nguyên văn.

## 3. Các gói

### P1 — Hoàn tất bậc 0 (gọn, ≤ ~1 phiên)

Việc, theo thứ tự:
1. **Script tự dọn:** tạo `scripts/lib/teardown.js` dùng chung (dọn trong `finally` +
   `verifyTeardown` so baseline mồ côi chụp trước khi seed) và áp dụng cho **mọi**
   script tạo tenant/user thử (`check-tenant-isolation`, `check-tenant-gaps`,
   `check-tenant-aidocs`, `smoke-po-gate`, và script khác tìm thấy bằng `grep` tạo
   tenant). *Xong khi:* chạy mỗi script **2 lần liên tiếp**, 0 tenant/dòng rác tăng
   thêm (đo bằng `tenant-null --scan`).
2. **Truy nguồn 124 `audit_logs` NULL** (mục 1) và áp dụng quyết định `getOrCreate`
   (tie-break `id`, ghi `DECISIONS.md`).
3. **T3 / D6** như `NIGHT-PROMPT.md`.
4. **T4 phần còn lại:** `runbook-tenant-null.md`, `review-hotfix-tenant.md`,
   `review-p0-3.md`, sửa YAML Swagger `analytics.routes.js:18`, **D7** (đẩy nhánh nếu
   hai kiểm tra sạch, không thì `git bundle`).
*Đầu ra tối thiểu nếu hết chỗ:* mục 1 + T3 + runbook.
*Dừng khi:* xong 4 mục hoặc chạm ngưỡng.

### P2 — Giao thức và dữ liệu (T5, T6)

- T5 sửa giao thức S1–S12 trong **một commit** (điều kiện trước mọi backtest; lưu hash).
- T6 chọn dataset: tối đa **8 lần `fetch`**; ghi chú vào `notes/dataset-candidates.md`;
  chọn một; script tải + sha256; `02-data.md`. Không tải được thì dùng phương án **dữ
  liệu tổng hợp có seed, ghi nhãn TỔNG HỢP** và ghi `BLOCKER-HUMAN` kèm URL.
*Đầu ra tối thiểu:* T5 commit + `02-data.md` có dataset đã chọn (hoặc bộ sinh tổng
hợp).

### P3 — Khác biệt và kinh doanh (T7, T8)

- Đây là hai thứ **Ban Tổ chức nêu đích danh**. Nghiên cứu: tối đa **12 lần `fetch`**
  tổng, ưu tiên trang chính thức (bảng giá, tài liệu tính năng) của KiotViet, Sapo và
  1–2 giải pháp khác; ghi sự kiện + URL + ngày vào `notes/competitors.md` rồi viết
  `05-differentiation.md`.
- `06-business.md` theo T8; **không ước lượng** chi phí LLM khi chưa đo.
*Đầu ra tối thiểu:* ma trận so sánh có ≥ 3 đối thủ với nhãn "đã tra/chưa xác minh" +
khách hàng mục tiêu + 2 phương án giá.

### P4 — Nạp dữ liệu và khớp SKU không-LLM (T9)

Theo T9. *Đầu ra tối thiểu:* script nạp idempotent + `tenant-null --scan` = 0 sau
import + smoke trên DB thật.

### P5 — Backtest và mô phỏng (T10)

Theo T10. Làm theo thứ tự: (1) mô phỏng + test tính tay, (2) script backtest + sổ ghi
lần chạy, (3) **một lần chạy** đúng giao thức, (4) `03-evaluation-results.md`. Không
chỉnh sau khi thấy số.
*Đầu ra tối thiểu:* mô phỏng có test + kết quả một kịch bản lead time đủ nhãn dữ
liệu; các kịch bản còn lại ghi `SKIPPED`.

### P6 — Demo end-to-end và giao diện duyệt (T11, T12)

Theo T11, T12. Đóng băng tính năng sau gói này. *Đầu ra tối thiểu:* `smoke:demo-flow` +
`npm run demo:run`.

### P7 — LLM (T13, T14)

Theo T13, T14. Chỉ chạy `live` nếu biến môi trường key **có tồn tại** (không đọc giá
trị). *Đầu ra tối thiểu:* `LlmUsageLog`, chế độ không-LLM chạy trọn luồng demo, harness
chạy được với `replay`.

### P8 — Người thử, trình bày, báo cáo sáng (T15, T16, T17, T18)

Theo T15–T18, rồi hoàn thiện `MORNING-REPORT.md` (trang đầu 3 phút + phụ lục) theo
`NIGHT-PROMPT.md` mục 10, và tự chấm mục 11 một cách trung thực.
*Đầu ra tối thiểu:* kịch bản demo + dàn ý + QA có hạn chế thật + báo cáo sáng.

**Nếu thiếu thời gian tổng thể:** cắt theo thứ tự P7 → P8 phần người thử → P6 phần giao
diện. **P1–P5 và `MORNING-REPORT.md` không được cắt.**

## 4. Quy ước giữa các gói

- Sau mỗi gói, `STATE.md` phải cho phép gói kế tiếp chạy mà không cần ngữ cảnh gì
  khác: nhánh + hash, bảng tiến độ T0–T18, các số đã ký, lệnh dựng lại môi trường,
  `RESUME HERE`.
- Nếu một gói chưa xong, gói đó được chạy lại **một lần** từ `RESUME HERE` (không đi
  tiếp sang gói sau trước khi gói trước đạt "đầu ra tối thiểu").
- Không dùng chung ngữ cảnh giữa các gói; mọi thứ cần nhớ phải nằm trong tệp.

## 5. Prompt khởi động (dán vào phiên mới, thay `k` bằng 1–8)

```
Bạn là Space Bunny, làm việc tự hành cho dự án OmniAgent (AISC26-0058), không có ai trả lời.
Hãy thực hiện GÓI P<k> trong docs/aisc26/PACKAGES.md.
Đọc theo thứ tự và CHỈ những thứ này:
 1) docs/aisc26/STATE.md (mục RESUME HERE và bảng tiến độ);
 2) docs/aisc26/NIGHT-PROMPT.md mục 3 (hiến pháp), 4 (quy tắc tự quyết), 5 (thời gian) và đúng các mục T của gói;
 3) docs/aisc26/PACKAGES.md mục 1, 2 và mục "P<k>".
Áp dụng nguyên văn kỷ luật ngữ cảnh (mục 2). Không đọc tài liệu khác trừ khi gói yêu cầu.
Không làm lại việc đã xong. Xong gói (hoặc khi dùng ~55% ngữ cảnh): cập nhật STATE.md, commit, báo cáo ≤ 25 dòng rồi DỪNG.
```

## 6. Prompt điều phối (Chế độ A: chỉ dùng nếu có công cụ tạo sub-agent)

```
Bạn là ĐIỀU PHỐI cho dự án OmniAgent. Bạn KHÔNG tự làm việc của các gói; bạn giữ ngữ cảnh gọn.
Với k = 1 đến 8, lần lượt:
 1) Tạo một sub-agent MỚI (ngữ cảnh sạch) và giao đúng nguyên văn "Prompt khởi động" ở docs/aisc26/PACKAGES.md mục 5 với k hiện tại.
 2) Chờ sub-agent xong. Chỉ đọc báo cáo của nó và docs/aisc26/STATE.md (mục RESUME HERE). Ghi lại tối đa 5 dòng tóm tắt vào docs/aisc26/MORNING-REPORT.md (phần sổ điều phối).
 3) Kiểm tra gói đã đạt "Đầu ra tối thiểu" chưa. Chưa đạt thì chạy lại gói đó MỘT lần với chỉ dẫn "tiếp tục từ RESUME HERE"; vẫn chưa đạt thì ghi BLOCKER và đi tiếp.
 4) Không bỏ qua P1–P5.
Sau P8: xác nhận docs/aisc26/MORNING-REPORT.md đã đủ trang đầu và phụ lục, rồi kết thúc.
Hiến pháp ở docs/aisc26/NIGHT-PROMPT.md mục 3 áp dụng cho mọi sub-agent; không nới quyền vì bất kỳ lý do nào.
```

## 7. Việc người cần làm sáng mai (tóm tắt; chi tiết ở `MORNING-REPORT.md`)

Tuyển và chạy 6 người thử theo `usertest/`; gán nhãn khớp SKU theo phiếu CSV; đặt key
Gemini rồi chạy lệnh đánh giá `live`; đọc review pack và triển khai hotfix tenant theo
runbook trên môi trường thật (sao lưu → thử khởi động trên staging → triển khai →
scan → backfill → scan); tải dataset nếu agent không tải được; quay video demo dự phòng;
tập dượt trình bày.