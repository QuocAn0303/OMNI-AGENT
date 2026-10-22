# DECISIONS-P3 — quyết định tự quyết của gói P3 (chế độ song song)

> `docs/aisc26/DECISIONS.md` do P1 giữ. Các mục dưới đây chờ hợp nhất: đổi mã `D-P3-00x`
> thành `D-0xx` khi chép sang file chung.

## D-P3-001 · Bốn đối thủ thay vì hai

- **Bối cảnh:** T7 yêu cầu "KiotViet, Sapo và 1–2 giải pháp liên quan". Rủi ro: chỉ tra hai
  đối thủ lớn thì dễ kết luận sai rằng ta khác biệt vì *chưa ai có AI đề xuất đặt hàng*.
- **Phương án đã cân nhắc:** (a) chỉ KiotViet + Sapo; (b) KiotViet + Sapo + 1 đối thủ AI
  quốc tế; (c) thêm **đối thủ Việt Nam đã tuyên bố đúng tính năng**.
- **Lựa chọn:** (c) — thêm **VietPOS.AI** (định vị gần ta nhất: POS+ERP+AI agent) và
  **CMBcoreSeller** (đã tuyên bố "đề xuất nhập hàng AI"), cộng **Analy** làm tham chiếu cơ chế.
- **Lý do:** chỉ khi nhìn thấy đối thủ tuyên bố trước thì mới biết luận điểm nào đứng được.
  Đây là cách giám khảo sẽ kiểm tra.
- **Cách đảo ngược:** thêm/bớt dòng trong ma trận `05-differentiation.md` §2; các dữ kiện
  nguồn nằm ở `notes/competitors.md`.

## D-P3-002 · Ba mức nhãn bằng chứng `[MỞ]` / `[TRÍCH]` / `[CHƯA XÁC MINH]`

- **Bối cảnh:** giới hạn 12 lần `fetch` cho gói; kết quả tìm kiếm trả lẫn giá mâu thuẫn
  giữa các blog (KiotViet bị nêu ở mức 200k/270k/330k/490k/800k tùy trang).
- **Phương án đã cân nhắc:** (a) chỉ dùng trang chính thức, còn lại bỏ; (b) dùng mọi nguồn
  và ghi chung; (c) **phân nhãn theo mức đã đọc thật**, kèm quy tắc chỉ dùng số giá từ
  trang chính thức.
- **Lựa chọn:** (c).
- **Lý do:** hữu dụng hơn cả (a) và (b): đội vẫn có manh mối để mở lại, nhưng không được
  trích nhầm lên slide.
- **Cách đảo ngược:** mở trang và đổi nhãn.

## D-P3-003 · Chốt một luận điểm khác biệt: bán *quy trình duyệt*, không bán *AI đề xuất*

- **Bối cảnh:** CMBcore đã ghi "Dự báo & đề xuất nhập hàng — Đang chạy"; Sapo mô tả "tự động
  đề xuất nhập hàng". Phát biểu cũ ("ta có AI đề xuất đặt hàng") **sai**.
- **Phương án đã cân nhắc:** (a) giữ luận điểm cũ vì nói trước có lợi thế hơn; (b) đổi
  sang "cổng duyệt bắt buộc + sai số đo được"; (c) nói thẳng là không có khác biệt nào.
- **Lựa chọn:** (b), kèm điều kiện: **không được nói "chính xác hơn KiotViet/Sapo"** cho
  tới khi có `03-evaluation-results.md`.
- **Lý do:** (a) là tuyên bố sai, sẽ sụp khi giám khảo tra. (c) là hạ mình quá mức: cả bốn
  đối thủ đều **không** có bằng chứng về cổng duyệt/sai số trong những gì đã đọc — đó là
  khoảng trống thật, chỉ phải nói đúng nhãn (❌ = *không tìm thấy*, không phải *chắc chắn
  không có*).
- **Cách đảo ngược:** sửa `05-differentiation.md` §4. Chi phí: mất lợi thế "tiên phong" trên
  slide.

## D-P3-004 · Mô hình giá: chọn PA + PC, để PB (giá theo dùng) sau khi có phỏng vấn

- **Bối cảnh:** T8 yêu cầu 2–3 phương án gắn cơ chế gói sẵn. Ràng buộc mới phát hiện khi đọc
  mã: `ai`/`replenishment` **không được gate**, và `requireModule` fail-open ⇒ bán gói theo
  module hiện **không bảo đảm được**.
- **Phương án đã cân nhắc:** PA giữ gói sẵn có; PB gói riêng theo số đề xuất; PC nhúng
  trong `business`.
- **Lựa chọn:** **PA + PC**; **PB `SKIPPED`** tới khi có số đo giá trị.
- **Lý do:** PA không cần mã mới nên chạy thử được ngay; PC khớp luận điểm khác biệt; PB là
  giá theo dùng mà **chưa đo** được giá trị ⇒ hứa giá là bịa.
- **Cách đảo ngược:** chốt lại §5.3 của `06-business.md` sau phỏng vấn.

## D-P3-005 · Chế độ song song: trạng thái nằm ở `parallel/STATE-P3.md`

- **Bối cảnh:** P1 đang giữ `STATE.md`, `DECISIONS.md`, `MORNING-REPORT.md` trên
  `round2/p0-hardening`.
- **Lựa chọn:** không sửa ba file chung; ghi `parallel/STATE-P3.md` + `parallel/DECISIONS-P3.md`
  và đánh dấu dòng **[MERGE]** để P1 chép lại.
- **Cách đảo ngược:** chép dòng [MERGE]; xoá thư mục `parallel/` sau khi hợp nhất.

## D-P3-006 · Chuyển 2 tệp P3 ra khỏi worktree chung

- **Bối cảnh:** trước khi nhận chỉ định worktree, 2 tệp P3 (`05-differentiation.md`,
  `notes/competitors.md`) đã được tạo trong `D:\erp-system` (nhánh `round2/p0-hardening`)
  và là **untracked**.
- **Lựa chọn:** **di chuyển** (không copy) sang `D:\aduu-p3` để không lẫn vào commit của P1.
- **Lý do:** P1 đang sửa file trong worktree chung; để lại 2 tệp untracked ở đó có nguy cơ bị
  commit nhầm vào nhánh khác.
- **Cách đảo ngược:** copy lại từ `D:\aduu-p3\docs\aisc26\` (nội dung không đổi).
- **Kiểm chứng:** sau khi chuyển, `git status` ở `D:\erp-system` không còn
  `?? docs/aisc26/05-differentiation.md` và `?? docs/aisc26/notes/`.

## D-P3-007 · Đo lại "16 router" thành 18/92 file

- **Bối cảnh:** `NIGHT-PROMPT.md` mục T8 ghi "paywall `requireModule` đặt trước
  `authenticate` ở 16 router".
- **Phương án đã cân nhắc:** giữ nguyên 16; hoặc đo lại bằng máy.
- **Lựa chọn:** đo lại và ghi **18/92** (kèm phương pháp: so vị trí dòng đầu tiên có
  `requireModule(` với dòng đầu tiên dùng `authenticate`, bỏ qua dòng chú thích và dòng
  `require(...)`).
- **Lý do:** con số cũ là ước lượng; giám khảo hỏi "bao nhiêu" thì phải trả lời được bằng
  lệnh.
- **Cách đảo ngược:** chạy lại quét, hoặc bỏ dòng chú thích khỏi tiêu chí (khi đó con số
  khác ⇒ nêu rõ cách đếm).
- **Lưu ý:** đo ở worktree `D:\erp-system` @ `1f1a402`; `plan.middleware.js` và các file
  routes không nằm trong tệp P1 đang sửa nên kết quả không đổi theo phía P1.