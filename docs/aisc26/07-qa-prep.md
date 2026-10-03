# 07 — Chuẩn bị vấn đáp (16 câu)

**Ngày:** 2026-10-03 · **Bám theo:** T17

## Cách dùng

- Trả lời **ngắn, thẳng, có số**. Nếu không có số: **"chúng tôi chưa có dữ liệu"** — đó
  là câu trả lời chấp nhận được, đừng bịa.
- Nếu bị hỏi về thứ chưa xác minh, gõ `chưa xác minh` thay vì `có/không`.
- **Cấm nói "ROP tốt hơn".** Nếu giám khảo dẫn lại câu đó, đáp lại bằng mục 2 rồi nói
  rõ vì sao ta **không** kết luận.
- **Cấm** nói "chính xác hơn KiotViet/Sapo".

---

## 1. "Sao không dùng công thức ROP? Nó có sẵn ở đâu cả."

> Có, và chúng tôi **đang** dùng: `ROP = nhu cầu/ngày × thời gian nhập + tồn kho an toàn`,
> `đặt = ROP − vị thế tồn kho` (có làm tròn theo bao bị của nhà cung cấp). Nó nằm ở
> `src/modules/replenishment/replenishment.calc.js`, hàm thuần, không đọc mạng.
>
> Câu hỏi đúng hơn là **ROP với tham số nào**. Tồn kho an toàn chỉ có nghĩa khi gắn với
> một mức phục vụ chọn trước; chính vì vậy thí nghiệm 1 của chúng tôi **không** kết luận
> được, vì chỉ số chính ban đầu không ràng buộc mức phục vụ. Chi tiết ở `01-llm-role.md`
> và `03-evaluation-protocol.md`.

## 2. "Số đo thế nào? Ai bảo đó là số đúng?"

> Không có "số đúng". Có **giao thức đo**, commit **trước** lần chạy đầu:
> chia dữ liệu theo thời gian 3 cửa sổ, tối thiểu 3 lead time, 2 cách xử lý ngày hết
> hàng, bootstrap theo SKU 1.000 lần, 2 baseline dự báo, và một chỉ số chính **được viết
> ra trước** kèm đánh đổi của nó.
>
> Và tôi nói ngay phần xấu: chỉ số chính đó **không có sàn dịch vụ**, nên nó thưởng cho việc
> bán ít — bán ít hơn 9,5%, mất bán nhiều hơn 31,5%, tỉ lệ lấp đủ yêu cầu 69,51% so với
> 76,81%. Vì vậy tôi **không** nói ROP tốt hơn. Cách sửa đúng là tiền-đăng ký một hàm mục
> tiêu có ràng buộc rồi chạy lại như một thí nghiệm mới — và đó là thí nghiệm 2, có nhãn
> **post-hoc**.

## 3. "Khác KiotViet/Sapo ở chỗ nào?"

> Ở **đúng một luồng**: cảnh báo sắp hết hàng → tính số lượng → **người duyệt** → tạo đơn
> nhập. Ở luồng đó:
> 1. **Cổng duyệt bắt buộc**: không duyệt thì đơn nhập không tồn tại. Bằng chứng:
>    `smoke:po-gate` 24/24 trên DB thật.
> 2. **Kiểm tra lại lúc duyệt**: số liệu tính lại từ DB, lệch thì chặn kèm bảng khác biệt.
> 3. **Đo được sai số** bằng backtest công khai.
>
> Tôi **không** nói chính xác hơn họ — chưa đo được. Và tôi nói thẳng: ở POS, kênh sàn,
> hóa đơn điện tử, số khách và độ tin cậy thương hiệu, **họ thắng**. Nguồn + ngày ở
> `notes/competitors.md`; `❌` trong bảng nghĩa là *không tìm thấy trong nguồn tôi đã đọc*.

## 4. "Dữ liệu của các bạn có thật không?"

> **Không, và tôi không trình bày như thật.** Đó là **UCI Online Retail II — CC BY 4.0**,
> 500 SKU, 25 tháng, 3 cửa sổ kiểm định. Tệp gốc **không có** tồn kho, **không có**
> lead time quan sát được, **không có** kênh bán, **không có** giá vốn ⇒ **mọi chỉ số tồn
> kho là MÔ PHỎNG**, và giá vốn là giả định (trung vị giá niêm yết). Giá tính bằng sterling
> của tệp, không quy đổi.
>
> Còn dữ liệu trong hệ thống thì là dữ liệu **demo** của một tenant mô phỏng, tên có chữ
> "MÔ PHỎNG", tự dọn sau mỗi lần chạy. Chúng tôi **không có khách hàng thật nào**.

## 5. "Marketplace đã tích hợp thật chưa?"

> **Chưa.** Luồng lấy đơn từ **tệp xuất mô phỏng** đúng định dạng sàn (có
> `notes/marketplace-format.md` ghi nguồn và giới hạn). Có adapter cho Shopee/TikTok trong
> mã, nhưng **không có tích hợp thời gian thực chạy thật**. Vì vậy tôi **không** dùng chữ
> "đa kênh". Tệp xuất là **định dạng giả định theo họ đặc tả**, không phải bản xuất thật từ
> sàn.

## 6. "Chi phí LLM là bao nhiêu?"

> **Chưa đo — tôi không có con số.** Vì sao:
> - Số lượng đặt do **công thức** quyết định; AI chỉ làm khớp tên hàng và diễn giải/soạn tin.
> - AI **mặc định tắt** (`LLM_DISABLED=1` thì chắc chắn tắng); luồng demo chạy trọn ở
>   chế độ không-LLM — đây là bằng chứng chạy được, không phải lời hứa.
> - Có bảng `LlmUsageLog` ghi token/latency mỗi lần gọi, nhưng **chưa chạy `live`** nên
>   chưa có số nào để báo.
>
> Con số "~$0,02/khách/tháng" mà một đối thủ công bố là **số của họ**, không phải của tôi.

## 7. "Agent sai thì ai chịu trách nhiệm?"

> **Người duyệt**, vì người duyệt là người giữ quyền quyết định. Cụ thể trong mã:
> - AI **không** tính bất kỳ con số nào của quyết định đặt hàng — luật này có test: chạy với
>   AI giả trả về số sai, output cuối vẫn phải là số của công thức.
> - Không có quyền duyệt ⇒ **không có** đơn nhập.
> - Lúc duyệt, số liệu **tính lại từ DB**; lệch quá ngưỡng ⇒ chặn.
> - Thiếu giá vốn ⇒ `409`, không cho tạo PO giá 0.
> - Ai duyệt, lúc nào, ghi chú gì: `AuditLog` + `decidedById/decidedAt/decisionNote`.
> - Có **tuổi đề xuất** trên màn hình để đề quá lâu là thấy.
>
> Phần còn lại tôi thừa nhận: hiến pháp có **cho phép tự duyệt** (SME thường chỉ có một
> chủ shop là ADMIN, chặn cứng sẽ làm tính năng vô dụng). Khi đó audit ghi lại là biện pháp
> chính, không phải bước duyệt của người thứ hai.

## 8. "Cách ly đa tenant thế nào? Rò dữ liệu thì sao?"

> Ba lớp:
> 1. `tenantId` tự động được chèn vào **mọi** truy vấn scoped bằng Prisma extension, dựa
>    trên `AsyncLocalStorage` do middleware gắn từ token; đọc/ghi **lồng nhau** cũng giữ
>    tenant (đây là lỗi đã phát hiện và vá — hotfix `hotfix/tenant-nested-write`).
> 2. Mọi model có `tenantId` phải nằm trong `TENANT_SCOPED_MODELS`; kiểm thử sẽ **fail** nếu
>    quên.
> 3. Kiểm chứng trên **DB thật**: `check:tenant` = 11/11 + 4/4 + 4/4, `check-tenant-aidocs`
>    12/12 (ghi tài liệu của tenant khác bị chặn), và quét mồ côi/trùng bằng
>    `tenant:null -- --scan`.
>
> **Đã biết và nói thẳng:** 134/139 bảng scoped **chưa có** khóa ngoại tới `tenants` ở tầng
> DB — cách ly của ta là ở tầng truy vấn, không phải ràng buộc CSDL. Với dữ liệu thật, tôi
> sẽ khuyến nghị thêm khóa ngoại.

## 9. "Sao không dùng fuzzy matching để khớp SKU?"

> Có dùng, và đó là **mặc định**: trigram Dice + Levenshtein chuẩn hoá + cosine TF-IDF,
> ngưỡng `AUTO_ACCEPT 0,86`, `REVIEW 0,62` (15 unit test).
>
> Nhưng fuzzy **không phân giải được ca lộn xộn** — biến thể tên, viết tắt, đổi tên theo
> đợt. Nên ở **ca mơ hồ** (điểm trong `[0,62; 0,86)`) mới gọi AI, và AI phải trả về mã nằm
> trong danh sách ứng viên, có `confidence`; dưới 0,85 thì chuyển **người xác nhận**. LLM bị
> bịa mã ngoài danh sách thì coi như không khớp.
>
> **Giới hạn phải nói:** ứng viên cho AI là **top-K theo điểm fuzzy**, nên khi đáp án nằm
> ngoài top-5 thì AI **không** dùng được. Và **độ đúng thì chưa đo**: bộ nhãn tay 120 cặp
> đã sinh (`npm run llm:labels`) nhưng **đang để trống**. Script tự in `BLOCKER-HUMAN` và
> **từ chối** ra số nếu chưa có nhãn.

## 10. "Trạng thái lơ lửng của A′ là gì? Có phải lỗi không?"

> Là trường hợp **đã duyệt nhưng chưa tạo được đơn nhập**: gate ở `APPROVED` còn `resultRef`
> vẫn NULL (đơn nhập chết giữa chừng, ví dụ thiếu giá vốn, hoặc chạy lại hệ thống).
> Vì không bọc được transaction xuyên suốt (bằng chứng ở `00b-gate-design.md` §3), phải
> để lại trạng thái phụ này.
>
> Xử lý: người dùng bấm **thử lại** (`POST /human-gates/:id/retry-execution`), có ghi
> nhật ký. Hôm nay tôi thêm **một** đường đọc, **chỉ đọc**:
> `GET /api/agent/human-gates/by-status?status=APPROVED&pendingResult=1` — vì
> `/human-gates` cố tình chỉ trả `PENDING`, nên trạng thái này **không đọc được** qua API và
> không có cách nào biết nó đang tồn tại. Có test cho: 3 điều kiện lọc phải khớp cùng lúc,
> 400 khi sai tham số, 500 khi DB lỗi (không trả danh sách rỗng giả), và cách ly tenant.

## 11. "Cách đo thời gian thao tác thế nào?"

> **Chưa đo — bộ công cụ đã sẵn, chưa có ai thử.** Thiết kế: mỗi người thử làm **hai**
> điều kiện trên **hai bộ SKU tương đương** (chia xen kẽ theo phân phối `orderQty`, trùng
> mã SKU = 0 để không đo nhầm trí nhớ), thứ tự **counterbalance AB/BA**, bấm giờ theo
> giây, chữ đọc cho người thử **dùng nguyên văn**, đồng ý tham gia ẩn danh.
>
> Số lượng người thử chọn được chấm bằng **cùng bộ mô phỏng** với backtest
> (`scripts/backtest/lib/simulate.js`), trên một kịch bản cố định 14 ngày, và **có nhìn
> trước** — tôi ghi rõ điều đó.
>
> **Dưới 5 người thử: chỉ báo trung vị + khoảng min–max.** Không phần trăm, không p-value,
> **không nói "có ý nghĩa thống kê"**. Script cố tình không có đường tính kiểm định.

## 12. "Vì sao chỉ 6 người thử?"

> Vì **hiện pháp** cho một bài đo thao tác có đối chứng, và vì người thử là người thật mà
> tôi **không được phép liên hệ** (quy tắc dự án) — 6 người là thứ đội tự làm được trong
> ngắn hạn.
>
> Tôi **không** coi 6 là đủ để kết luận. Nó đủ để: phát hiện đường đi bị người dùng
> bỏ qua, đo thời gian, và xem có ai dùng cột đề xuất không. Không đủ để nói "cải thiện
> X%" — và tôi sẽ không nói.

## 13. "Paywall của các bạn có thật không?"

> **Hiện chưa đáng tin — tôi đo được và nói thẳng.** Ba sự thật:
> - Có **30** module key được gate.
> - `requireModule`/`checkFeature` **fail-open** khi chưa có `req.user`, và **18/92** file
>   route đặt `requireModule` **trước** `authenticate` ⇒ các module đó thực tế **không bị
>   chặn theo gói**.
> - `ai` và `replenishment` **không được gate ở bất kỳ đâu**, dù `allowedModules` của gói
>   Business có khoá `"ai"`.
>
> ⇒ Luồng demo **mở cho mọi gói, kể cả Free**. Không được nói "AI chỉ ở gói Business".
> Sửa 18 file + gate hai module là **việc đầu tiên** trước khi bán bất kỳ gói nào.

## 14. "Bao lâu để triển khai cho một cửa hàng? Mất bao nhiêu tiền?"

> Giá niêm yết trong mã: **free 0 · pro 499.000đ · business 1.499.000đ/tháng**. Đó là
> **mức niêm yết**, chưa phải giá bán được — chưa có phỏng vấn nào để biết khách chịu bao
> nhiêu.
>
> Triển khai: nạp danh mục + lịch sử bán. Việc này **chưa giải quyết trọn vẹn** — import
> Excel sản phẩm/KH/NCC có, nhưng nhập **lịch sử đơn hàng** chưa có (mục F4 trong
> `00-scope.md`). Không có số "mấy giờ" vì chưa đo trên cửa hàng thật.

## 15. "Chỉ số sai số đo thế nào thì gọi là tốt? Ai đặt ngưỡng?"

> Chưa có con số "đạt/không đạt" và tôi **không** bịa ra. Cái đo được là: độ chênh giữa số
> hệ thống đề xuất và số người dùng chọn, trên một kịch bản cố định, cùng bộ mô phỏng.
> Ngưỡng nghiệm thu phải chốt **cùng khách hàng**, theo dữ liệu của họ — với 3 cửa hàng
> thì không có ngưỡng chung.

## 16. "Nếu tôi muốn thử thì làm gì? Rủi ro của tôi là gì?"

> Rủi ro thật, theo thứ tự:
> 1. **Chưa có dữ liệu người dùng và chưa phỏng vấn ai** — bạn đang mua một giả định.
> 2. **Chi phí AI chưa đo**; hiện để AI tắt thì chi phí bằng 0 nhưng bạn mất phần diễn
>    giải/khớp SKU.
> 3. **Phạm vi hẹp**: một luồng, không POS, không sàn, không HĐĐT. Nếu cửa hàng bạn cần
>    POS thì chúng tôi không phải lựa chọn của bạn.
> 4. **Paywall chưa đáng tin** (mục 13) — nếu mua gói, hãy hỏi lại sau khi đã vá.
>
> Cách bắt đầu rẻ nhất: chạy thử trên dữ liệu mô phỏng sẵn có, không cần dữ liệu của bạn;
> sau đó cho tôi xem 20 SKU thật của bạn, tôi chạy kịch bản `usertest/` và trả về bảng
> so sánh — không cần cài gì.
