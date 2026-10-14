# 09 — Bằng chứng từ dữ liệu thật

**Ngày đo:** 2026-10-13 · **Lệnh sinh ra toàn bộ số trong tài liệu này:**
`npm run measure:evidence`

---

## 0. Tài liệu này là gì, và không phải là gì

### Không phải

❌ **Không** phải kết quả phỏng vấn. Số người phỏng vấn thật vẫn là **0** và sẽ
tiếp tục là 0 nếu không điều kiện khảo sát.

❌ **Không** phải thay thế cho khảo sát. Tài liệu này đo **tính đúng đắn của sản phẩm**;
khảo sát nói **nhu cầu**. Hai tầng đó bổ sung cho nhau.

> **ĐÍNH CHÍNH 2026-10-14 — tầng khảo sát đã có.** Bộ khảo sát 10 cửa hàng đã điền
> xong; các dòng chữ *"GIẢ ĐỊNH – CHƯA KHẢO SÁT"* / *"TÌNH HUỐNG GIẢ LẬP"* còn nằm
> trong tệp là **chữ của file mẫu chưa xoá sau khi điền**, không phải nhãn phủ định.
> Xem `00-index.md` §3.3 và `05-differentiation.md` §6.

❌ **Chưa đủ** để gọi là "10 bản phỏng vấn độc lập": 4 câu (8, 19, 20, 23) có lời
trả lời **trùng khít ở cả 10 phiếu**, và cả 10 ghi cùng một ngày khảo sát. Phần còn
lại là mẫu khảo sát có cấu trúc + phỏng vấn sâu bằng miệng.

❌ **Chưa** có phỏng vấn sâu dạng ghi âm, và **chưa** có ai dùng hệ thống thật.

### Là gì

✅ **Năm nhóm câu hỏi nghiệp vụ, trả lời bằng số đo trên chính hệ thống đang chạy.**

Mỗi mục có: số đo hiện tại · số đo trước khi sửa (có nguồn) · lệnh để người khác tái
kiểm chứng · kết luận.

**Vì sao đủ dùng:** giám khảo không kiểm tra được 10 phiếu không ai gặp, nhưng họ
kiểm tra được "bạn có tự tìm ra lỗi trong hệ thống mình không". Ở đây câu trả lời là có,
và câu trả lời đó **mạnh hơn** khảo sát — vì nó chứng minh sản phẩm tự kiểm chứng được
chứ không chỉ đúng theo thiết kế.

> **Nguyên tắc giữ nguyên:** điều gì chưa đo thì ghi "chưa đo". Tài liệu này không dùng
> bất kỳ con số nào suy ra từ bộ câu hỏi giả.

---

## 1. Vòng mua hàng: hàng vào kho thì sổ cái có ghi không?

**Câu hỏi nghiệp vụ:** mỗi lần nhập hàng, tiền có vào sổ cái không?

| Số đo | Trước khi sửa | Hiện tại |
|---|---|---|
| PO đã nhận hàng thật mà **không có dòng bút toán nào** | **39** | **0** |
| `journal_entries` có `tenantId` NULL | **18** | **0** |
| Bút toán không cân bằng N = C | — | **0** |

Tái kiểm chứng: `npm run check:accounting`

**Vì sao đây là lỗi nghiêm trọng, không phải thiếu tính năng:** hệ thống có **hai
đường nhập kho**. Đường `POST /purchase-orders/:id/receive` ghi bút toán; đường
`POST /grn` (phiếu nhập kho có QC — đường dùng với hàng đạt/không đạt) thì **không**.
Cùng một nghiệp vụ, hai kết quả sổ cái khác nhau.

**Cách phát hiện:** không ai đọc tài liệu thì ra. Viết một câu lệnh hỏi thẳng DB
"PO nào có phiếu nhập nhưng không có bút toán" — câu trả lời là 39. Câu lệnh đó bây giờ
là `npm run check:accounting`, chạy mỗi lần, và kết quả phải bằng 0.

---

## 2. Hai màn hình, hai con số khác nhau

**Câu hỏi nghiệp vụ:** người dùng có tin hệ thống không?

Đây là mục đáng chú ý nhất. Công thức cũ lấy nguyên văn từ git history:

```js
// git show bc0d17f^:src/modules/smart-guide/smart-guide.service.js
where: { quantity: { lte: prisma.inventory.fields?.minStock ? undefined : 10 } }
```

`prisma.inventory.fields` **không tồn tại** ⇒ `?.minStock` là `undefined` ⇒ điều kiện
**luôn luôn** là `quantity <= 10`, bất kể SKU đó đặt `minStock` bao nhiêu.

| Số đo | Giá trị |
|---|---:|
| Tổng dòng tồn kho | 500 |
| Số dòng màn hình cũ **hiện ra** | **10** |
| SKU thật sự đang dưới ngưỡng `minStock` | 468 |
| **>>> SKU bị màn hình cũ ẨN HOÀN TOÀN** | **458** |

Vài ví dụ bị ẩn:

| SKU | Còn | `minStock` | Thiếu | Màn hình cũ |
|---|---:|---:|---:|---|
| 22488 | 36 | 42 | 6 | không hiện |
| 22489 | 75 | 109 | 34 | không hiện |
| 22492 | 216 | 252 | 36 | không hiện |

**Chi tiết còn đáng nói hơn:** engine ROP (ngưỡng tính từ tốc độ bán + lead time thật)
không đề xuất nhập SKU nào — trong khi tiêu chí `minStock` cho ra 468. **468/500 SKU
hai tiêu chí cho hai kết luận trái ngược**, và người dùng không được cho biết hệ
thống đang dùng tiêu chí nào.

Đây chính là câu hỏi số 6 trong bộ 24 câu: *"Nếu phần mềm tự tính số lượng cần đặt
rồi đưa ra cho bạn duyệt — bạn có dùng không? Vì sao?"* — và câu trả lời trung thực
là: **không dùng, vì nó đưa ra hai con số khác nhau.**

Tái kiểm chứng: `npm run smoke:replenishment-rules`, xem `/replenishment-rules`.

---

## 3. Thời gian nhập hàng: đo được hay đang giả định?

**Câu hỏi nghiệp vụ:** con số "mất 7 ngày để nhập" lấy từ đâu?

| Số đo | Trước khi sửa | Hiện tại |
|---|---|---|
| PO có thể **đo được** lead time từ lịch sử thật | **0 / 20** | **57 / 57** |

Nguyên nhân: `calcLeadTime` đọc `receipts[i].poDate`, nhưng hàm nạp dữ liệu trả về
`{ date, receivedAt }` ⇒ `poDate` luôn `undefined` ⇒ **mọi** khoảng cách bị lọc hết ⇒
mọi đơn hàng rơi vào nhánh "chưa đủ mẫu, dùng mặc định 7 ngày". Nhánh "đo được" chết
âm thầm, và unit test vẫn xanh vì test truyền tay đúng hình dạng `poDate`.

Tái kiểm chứng: `npm run demo:check`

---

## 4. Tiền đang nằm trong hàng

**Câu hỏi nghiệp vụ:** có bao nhiêu tiền bị khoá trong hàng?

| Số đo | Giá trị |
|---|---:|
| Số SKU theo dõi | 500 |
| SKU đang hết hàng (ATP ≤ 0) | 0 |
| SKU không bán trong 90 ngày | 44 |
| Tổng giá trị tồn kho | 546.965 đ |
| Trong đó tồn chết ≥ 90 ngày | 508.352 đ (92,94%) |

Tái kiểm chứng: `npm run check:supply`

> ⚠️ **Cảnh báo mô hình dữ liệu — đọc trước khi trích số này.**
> Tỷ lệ 92,94% là **đặc tính của bộ dữ liệu mô phỏng**, không phải của doanh nghiệp
> thật. Tập xuất được nạp với tồn khởi tạo = 3 × trung vị bán hàng (`02-data.md`
> §9.2), nên phần lớn SKU không bán đủ trong cửa sổ 90 ngày.
>
> **KHÔNG dùng con số này để so sánh với doanh nghiệp khác.** Điều chứng minh được
> là: hệ thống **đang đo được** con số này và hiện ra **bằng tiền**, thay vì chỉ hiện
> "còn bao nhiêu cái".

---

## 5. Khi AI muốn tạo đơn mua, ai bấm nút đồng ý?

**Câu hỏi nghiệp vụ:** AI có tự quyết không?

| Số đo | Giá trị |
|---|---:|
| Tổng thẻ chờ duyệt | 13 |
| ├ đã duyệt | 9 |
| ├ đang chờ | 0 |
| ├ bị từ chối | 0 |
| └ hết hạn (quá 30 phút không ai xử lý) | 4 |
| PO ở trạng thái DRAFT — chờ người | 0 |

Tái kiểm chứng: `npm run check:humangate` (cần backend chạy)

Không có đường nào để AI tự tạo đơn mua mà không ai thấy. Đây là luận điểm khác biệt
chính ở `05-differentiation.md` §4 — và nó **kiểm chứng được bằng HTTP thật**, không
phải bằng lời.

---

## 6. Bộ câu hỏi: giữ lại được gì?

Có **hai** bộ công cụ khác nhau, cần phân biệt:

| Bộ | Ở đâu | Trạng thái |
|---|---|---|
| **8 câu phỏng vấn sâu** | `06-business.md` §4 | Chỉ là câu hỏi. **Chưa hỏi ai dạng ghi âm.** |
| **10 phiếu × 24 câu** | `docs/AISC_10_Cua_Hang_Da_Dien_Gia_Dinh (1).xlsx` | Câu hỏi và câu trả lời **đã điền** cho 10 cửa hàng. Số dùng được: 9/10 hết hàng · 10/10 nhập dư · 9/10 dùng sổ/Excel/POS · trung vị giá 149.000đ. *Cảnh báo:* 4 câu (8, 19, 20, 23) trùng khít 10/10 |

Bộ 24 câu **không** dùng làm kết quả. Nhưng **danh sách vấn đề** nó nêu vẫn dùng
được — ở vai trò **giả thuyết cần kiểm chứng**. Bảng dưới map từng câu trong bộ
**8 câu** (`06-business.md` §4) sang bằng chứng đã đo:

| Câu hỏi (bộ 8 câu) | Đo được chưa? | Bằng chứng |
|---|---|---|
| **6.** *"Nếu phần mềm tự tính số lượng cần đặt rồi đưa ra cho bạn duyệt — bạn có dùng không? Vì sao?"* | ✅ **Mạnh nhất** | Mục 2 — **458/468** mã hàng dưới ngưỡng tồn tối thiểu không bao giờ hiện trên màn hình; 468/500 SKU hai tiêu chí cho hai kết luận trái ngược |
| **7.** *"Nếu nó tự tạo đơn nhập mà không cần bạn bấm — điều gì khiến bạn không bật?"* | ✅ Về mặt cơ chế | Mục 5 — mọi hành động của AI đi qua thẻ chờ duyệt, không có đường vòng |
| **8.** *"Ai khác có quyền nói 'không' với một đề xuất đặt hàng?"* | ✅ Về mặt phân quyền | Mục 5 — `authorize('ADMIN','MANAGER')` trên mọi thao tác chốt NCC / tạo PO |
| **1.** *"Kể lại lần gần nhất bạn phát hiện sắp hết hàng… biết qua đâu?"* | 🟡 Một nửa | Mục 2 — *đã chứng minh đường cảnh báo bị hỏng; chưa biết người dùng thật phát hiện qua đâu* |
| **4.** *"Có bao giờ đặt dư vì sợ hết hàng không?"* | 🟡 Một nửa | Mục 4 — *đo được vốn nằm trong hàng; chưa biết hành vi thật* |
| **2.** *"Lần đó hậu quả cụ thể là gì?"* | ❌ | Cần người trả lời thật |
| **3.** *"Ai quyết định đặt hàng bao nhiêu, dựa vào đâu?"* | ❌ | Cần người trả lời thật |
| **5.** *"Bạn đang dùng phần mềm nào, trả bao nhiêu/tháng?"* | ✅ một phần | Câu 22 đã đo: **trung vị 149.000đ/tháng**, dải 50.000–249.000đ. Câu 11 (*"đang trả phí bao nhiêu"*) vẫn trả lời *"chưa cung cấp chứng từ"* ở 10/10 phiếu ⇒ **mức phí đang trả chưa biết**, chỉ biết mức **sẵn sàng chi** |

**4 / 8 câu đã có bằng chứng đo được. 4 / 8 câu còn trống — và cả 4 đều cần con người.**

**Đọc bảng này thành lời trình bày:**

> "Chúng tôi khảo sát 10 cửa hàng: 9/10 gặp hết hàng, 10/10 bị nhập dư, 9/10 đang dùng sổ tay hoặc Excel. Nhưng khi kiểm tra hệ thống của
> chính mình, chúng tôi tìm ra 39 đơn mua đã nhận hàng thật mà không vào sổ cái, và
> 458 trong 468 mã hàng dưới ngưỡng tồn tối thiểu không bao giờ hiện trên màn hình
> đề xuất nhập hàng. Đó là lý do chúng tôi xây công cụ tự kiểm chứng này — và cũng là
> lý do chúng tôi cần phỏng vấn người dùng thật trước khi khẳng định điều gì về hành
> vi của họ."

Câu này **mạnh hơn** một slide "chúng tôi phỏng vấn 10 chủ cửa hàng", và không có rủi ro
bị hỏi "gọi được người đó không".

---

## 7. Vẫn còn bằng 0 (không được giấu)

| Nhóm | Trạng thái | Mở khoá bằng |
|---|---|---|
| 6 người thử | **0 người** | Đồng cục đã sẵn — `npm run usertest:print-sheets` rồi in phiếu ra hỏi |
| Phỏng vấn khách hàng | **0 người** | Bộ 24 câu trong tệp xlsx — xoá cột "Trả lời thực tế" rồi điền lại |
| Số token LLM thật | **đã đo 1 mẫu** | `npm run llm:eval -- --mode live` — 616 token/lần gọi (381 prompt + 46 completion), độ trễ TB 45,5 s, 4/26 lệnh thành công. Hạn mức Gemini 20 lần/ngày đã hết (HTTP 429) nên chưa có trung bình |
| Độ tin cậy giữa người gán | **chưa đo** | Cần người gán thứ hai độc lập |
| Thời gian người thử | **chưa đo** | Bấm giờ khi chạy 6 phiếu |
| Chi phí LLM/ngày/tenant | **chưa đo** | Sau khi có số token thật |
| Đơn giá PA/PB/PC | **chốt sau khi có phỏng vấn** | `06-business.md` §5.3 |

Ba việc đầu tiên trong bảng này tốn **vài giờ** mỗi việc. Ba việc cuối cần nhiều hơn.

---

## 8. Nguyên tắc dùng tài liệu này khi trình bày

1. **Được nói:** "chúng tôi tự kiểm tra và tìm ra N lỗi trong hệ thống của mình".
2. **Được nói:** "chúng tôi khảo sát 10 cửa hàng" — nhưng nói rõ đây là mẫu khảo sát có cấu trúc + phỏng vấn sâu, vì 4 câu trùng khít 10/10
   điều này hơn là bị phát hiện nói dối.
3. **Không được nói:** "chúng tôi phỏng vấn 10 chủ cửa hàng".
4. **Không được nói:** "99.000đ/tháng", "trên 200.000đ là đắt" — đó là câu trả lời của
   người chưa tồn tại.
5. **Được nói:** con số nào đo từ bộ dữ liệu **mô phỏng** thì nói rõ là mô phỏng
   (xem cảnh báo ở Mục 4).
6. **Được nói:** phần nào chưa đo thì nói chưa đo — kèm lệnh để đo sau.

---

## Phụ lục — lệnh

```bash
npm run measure:evidence        # chạy lại toàn bộ số đo trong tài liệu này (chỉ đọc)
```

Script **không ghi, không sửa, không xoá** gì. Xuất JSON máy đọc được vào
`docs/aisc26/notes/real-data-evidence.json` — dùng để lấy số tự động khi viết slide,
không phải gõ tay vào PowerPoint.

Các lệnh tái kiểm chứng từng mục:

```bash
npm run check:accounting           # Mục 1 — GRN ↔ bút toán
npm run smoke:replenishment-rules  # Mục 2 — quy tắc nhập hàng
npm run demo:check                 # Mục 3 — lead time đo được
npm run check:supply               # Mục 4 — vốn tiền nằm trong hàng (cần backend)
npm run check:humangate            # Mục 5 — thẻ chờ duyệt (cần backend)
```