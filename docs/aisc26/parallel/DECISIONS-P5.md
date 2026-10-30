# DECISIONS-P5 — quyết định tự quyết của gói P5 (T10)

Theo `NIGHT-PROMPT.md` mục 4 (quy tắc tự quyết): không có ai trả lời, không dừng,
không hỏi. Mỗi mục ghi **bối cảnh → phương án đã cân nhắc → lựa chọn → lý do →
cách đảo ngược**.

Phần lớn quyết định của gói này **có bản sao nguyên văn** trong
`docs/aisc26/03-evaluation-protocol.md` §13.1 (vì sao phải sửa giao thức trước khi
chạy). Ở đây chỉ ghi phần **quy trình** và những quyết định không thuộc giao thức.

---

## D-P5-00 — Bối cảnh và trạng thái đầu phiên

- **Bối cảnh:** `STATE.md` ghi "RESUME HERE: GÓI P2".Nhưng `git log` cho thấy P2
  (`4a9fac0`) và P3 (`977a40b`) đã được merge vào `round2/p0-hardening`; `STATE.md`
  **chưa cập nhật** (vì phiên song song bị cấm sửa file đó — đúng quy tắc của
  `PACKAGES.md` chế độ song song). Lệnh trực tiếp là làm GÓI P5.
- **Lựa chọn:** làm P5, ghi trạng thái vào `docs/aisc26/parallel/STATE-P5.md`.
- **Phát hiện cần báo:** **không có `STATE-P4.md`** và không có tệp nào của T9
  (script nạp dữ liệu vào ERP, bộ khớp SKU không-LLM) trong `scripts/`. Tức là
  **P4 chưa chạy**. Theo `PACKAGES.md` §4 thì lẽ ra không được sang P5. Lý do vẫn
  làm P5: backtest của T10 **không phụ thuộc** T9 ( nó đọc thẳng
  `data/dataset/daily_sku.csv`, không cần ERP), và lệnh của người là P5.
- **Cách đảo ngược:** chạy P4 sau; không có gì trong P5 cần gỡ.

## D-P5-01 — Việc sửa `replenishment.calc.js` (thêm bảng z)

- **Bối cảnh:** lưới tinh chỉnh S12 (`0.80, 0.85, 0.90, 0.95`) nhưng
  `Z_BY_SERVICE_LEVEL` chỉ có `0.90, 0.95, 0.975, 0.99`. `calcSafetyStock` ném lỗi
  với mức không có trong bảng.
- **Phương án đã cân nhắc:** (a) thêm `0.80/0.85` vào bảng của sản phẩm;
  (b) để backtest tự tra bảng z riêng.
- **Lựa chọn:** (a).
- **Lý do:** hai bảng z cho cùng một khái niệm là loại lỗi mà `01-llm-role.md`
  cấm (mã tính và mã đánh giá phải là một). Thay đổi **cộng thêm** — không mức nào
  đang tồn tại bị đổi, không hàm nào đổi chữ ký. Có test khoá lại 4 mức của lưới.
- **Cách đảo ngược:** xoá 2 dòng trong `Z_BY_SERVICE_LEVEL`.

## D-P5-02 — `crostonDemandPerDay` nhận `alpha` nhưng không dùng

- **Bối cảnh:** `crostonDemandPerDay(qtySeries, alpha = 0.1)` **bỏ qua** `alpha` và
  tự suy `a = 1/(k+1)`. Nên lưới `alpha ∈ {0.1,0.2,0.3}` của S12 không dùng được.
- **Phương án đã cân nhắc:** (a) sửa hàm để tôn trọng `alpha`; (b) viết Croston
  alpha tường minh riêng trong `scripts/backtest/lib/demand.js`.
- **Lựa chọn:** **(b)**.
- **Lý do:** sửa (a) sẽ **đổi hành vi sản phẩm đang chạy** (`calcDemand` gọi hàm này
  không truyền `alpha`, nên sau khi sửa mọi lần gọi sẽ dùng `alpha = 0.1` cố định
  thay vì tự suy). Đó là thay đổi chức năng ngoài danh sách việc của T10, giao thức
  §3 của `NIGHT-PROMPT.md` cấm. Ghi vào backlog thay vì sửa.
- **Cách đảo ngược:** xoá `crostonExplicit`; phải sửa `replenishment.calc.js` trước.

## D-P5-03 — Ba lần chạy lặp lại trước lần chạy giao thức

- **Bối cảnh:** cần biết script có chạy được không, nhưng S11 cấm giấu lần chạy.
- **Lựa chọn:** chạy kiểm thúc với tham số **khác** (lead time 7, nhánh A) và ghi
  vào sổ với ghi chú rõ "không phải lần chạy giao thức"; thêm cờ `--log=false` chỉ
  dùng để kiểm tra lắp rap mà **không** ghi.
- **Lý do:** giữ đúng tinh thần S11 — không có con số nào bị xoá khỏi sổ. Một lần
  chạy có tham số khác là một **cấu hình khác**, không phải một lần chạy lại để
  chọn đẹp.
- **Cách đảo ngược:** không cần; dòng đã ghi thì giữ nguyên.

## D-P5-04 — Sửa `03-evaluation-protocol.md` (thêm §13.1) trước lần chạy

- **Bối cảnh:** giao thức để ngỏ 11 điểm mà script buộc phải chọn. Chỉnh giao thức
  **sau khi thấy số** là vi phạm; **trước** khi thấy số thì hợp pháp và là điều
  §10 đòi hỏi để trả lời "bạn có chỉnh cho đẹp không?".
- **Lựa chọn:** ghi D-P5-01…D-P5-11 vào §13.1 và **commit trước**, rồi mới chạy.
- **Lý do:** điểm mạnh nhất khi giám khảo hỏi là có *mốc commit* + *diff*. Nếu im
  lặng chọn 11 điểm trong mã thì đó là chỉnh ngầm.
- **Cách đảo ngược:** `git revert` commit đó; nhưng khi đã có `run_id` thì phải báo
  cả hai kết quả.

## D-P5-05 — Vị trí ghi trạng thái

- **Bối cảnh:** phiên song song (P4) đang dùng chung thư mục và có thể đang ghi
  `STATE.md`. Lệnh cấm sửa `STATE.md`/`DECISIONS.md`/`MORNING-REPORT.md`.
- **Lựa chọn:** `docs/aisc26/parallel/STATE-P5.md` + `DECISIONS-P5.md`.
- **Cách đảo ngược:** gộp vào `STATE.md` khi phiên song song đã xong.

## D-P5-06 — Không thêm cây trong `src/` cho backtest

- **Bối cảnh:** có thể đặt mô phỏng vào `src/modules/` để "tái dùng được".
- **Lựa chọn:** đặt ở `scripts/backtest/`.
- **Lý do:** backtest là **công cụ đo**, không phải tính năng. `NIGHT-PROMPT.md` §3
  cấm chức năng mới ngoài danh sách và cấm refactor rộng; đưa nó vào `src/` làm
  tăng bề mặt mã sản phẩm mà không ai dùng. Phần **công thức** thì vẫn lấy từ
  `src/modules/replenishment/replenishment.calc.js` (`calcSafetyStock`, `calcRop`)
  để không có hai nguồn số.
- **Cách đảo ngược:** di chuyển tệp; không có phụ thuộc ngược lại.
