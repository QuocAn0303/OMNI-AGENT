# PROMPT — Sinh bộ dữ liệu demo THẬT từ danh mục EMART

> File này là prompt để dán vào **phiên làm việc mới**. Lý do tách riêng: xem
> "Vì sao nên chạy ở phiên mới" ở cuối.
>
> Dùng cho bài AISC'26 — hồ sơ AISC26-0058, nhánh `round2/p0-hardening`.

---

## BỐI CẢNH BẮT BUỘC — đọc trước khi làm

```bash
git clone -b round2/p0-hardening https://github.com/QuocAn0303/OMNI-AGENT.git
cd OMNI-AGENT
npm install
```

Đọc, theo thứ tự này. Không bỏ qua — mỗi file chứa quyết định đã trả giá:

| File | Vì sao phải đọc |
|---|---|
| `docs/aisc26/00-index.md` | Bản đồ dự án. §3.2 liệt kê **11 lỗi thật** đã tìm và sửa — đừng làm lại |
| `AGENTS.md` | Quy ước backend, kiểu Prisma, quy tắc audit, multi-tenant |
| `docs/aisc26/DEMO-GUIDE.md` | Lệnh nào kiểm chứng cái gì |
| `docs/aisc26/slides/DEMO-UI-slides.md` | Kịch bản trình bày — dữ liệu mới phải phục vụ nó |

---

## MỤC TIÊU

Thay bộ dữ liệu demo hiện tại (**UCI Online Retail II** — giao dịch thật của một
cửa hàng quà tặng ở Anh, tên sản phẩm tiếng Anh, đơn vị GBP) bằng **danh mục
siêu thị Việt Nam thật**: tên sản phẩm tiếng Việt có dấu, mã vạch EAN-13 thật,
giá bằng ₫, nhiều ngành hàng.

Lý do, nói thẳng: bài toán khớp mã hàng trên tên tiếng Anh không thuyết phục với
khán giả Việt. Tên như `WOODEN HEART CHRISTMAS SCANDINAVIAN` là đồ trang trí
nhập khẩu; cửa hàng bán lẻ ở TP.HCM bán `Sữa tươi Vinamilk Homogenized 1L`.

---

## NGUỒN DỮ LIỆU

**EMART — https://emartmall.com.vn/**

Đã khảo sát trước, các kết quả này **đã kiểm chứng**, không cần kiểm lại:

| Mục | Kết quả |
|---|---|
| `robots.txt` | `User-agent: *` / `Disallow:` — **cho phép** |
| Kiểu trang | **render sẵn ở server**, không phải SPA. HTML chứa luôn tên và giá |
| Mã sản phẩm | EAN-13 trong đường dẫn ảnh: `/image/cache/catalog/products/8935049510864/...` |
| Giá | Có trong HTML, đơn vị ₫ — ví dụ `106.000₫` |
| Gợi ý | Có `/module/pavautosearch/autocomplete` |

### Luật thu thập — không phải tùy chọn

1. **Tốc độ:** nghỉ tối thiểu **800ms** giữa hai request. Chậm hơn cũng được.
2. **Giới hạn:** **tối đa 2 giây** mỗi request; đặt `User-Agent` nhận diện
   (`Mozilla/5.0 (compatible; aisc26-research)`).
3. **Chỉ trang công khai.** Không đăng nhập, không bypass, không gọi API nội bộ
   nếu endpoint đó không công khai.
4. **Không tải ảnh.** Chỉ cần tên, mã, giá, thuộc tính.
5. **Dừng ngay** nếu gặp 429/403 liên tiếp. Ghi log lý do, đừng đổi kiểu thử lại.
6. **Ghi nguồn.** Mỗi bản ghi lưu `sourceUrl` và `scrapedAt`. Nếu không ghi được
   nguồn thì bản ghi đó không được dùng.

> `robots.txt` cho phép là **tín hiệu tích cực, không phải giấy phép**. Đây là
> bài thi học thuật, dùng danh mục làm **dữ liệu đầu vào** để đo thuật toán khớp
> mã — không phát hành lại, không cạnh tranh. Nếu bất kỳ lúc nào thấy điều khoản
> dịch vụ cấm, **dừng lại và báo người dùng**, đừng tự quyết.

---

## DỮ LIỆU CẦN THU — theo ngành hàng, càng rộng càng tốt

Đi qua **tất cả** nhóm danh mục lớn. Mục tiêu **≥ 8.000 sản phẩm**, kèm
phân bố ngành hàng phải **đa dạng**, không dồn một chỗ.

| Nhóm | Vì sao cần |
|---|---|
| Sữa & đồ uống | Tên ngắn, nhiều biến thể thể tích (1L / 1,5L / hộp) |
| Gạo & thực phẩm khô | Có khối lượng, xuất xứ → dễ sinh biến thể "cắt bớt" |
| Mì & gia vị | Nhiều nhãn, tên phức tạp, có "hương vị" |
| Đồ gia dụng | Nhiều thuộc tính kỹ thuật (W, L, H, công suất) |
| Chăm sóc cá nhân | Tên có thương hiệu + dung tích + loại da |
| Đồ uống có cồn | Khối lượng, năm, loại rượu |
| Đồ ăn nhanh & đông lạnh | Ngày hết hạn, điều kiện bảo quản |
| Mỹ phẩm | Tên dài, nhiều từ tiếng Anh xen tiếng Việt |
| Đồ điện gia dụng | Model máy (mã nhà sản xuất), công suất |

### Trường cần lấy — mỗi sản phẩm

| Trường | Bắt buộc | Ghi chú |
|---|:-:|---|
| `name` | ✅ | Tên đầy đủ có dấu |
| `ean13` | ✅ | Từ đường dẫn ảnh. **Bỏ dòng nào không có mã** — mã là thứ làm bài toán khớp trở nên thật |
| `brand` | ✅ | Tách riêng khỏi tên nếu được |
| `categoryPath` | ✅ | Đường dẫn danh mục đầy đủ |
| `priceVnd` | ✅ | Số nguyên ₫ |
| `unit` | ✅ | Cái/chai/hộp/bao/kg/g/ml/L |
| `weightG` / `volumeMl` | ⭕ | Nếu trích được từ tên hoặc thuộc tính |
| `origin` | ⭕ | Xuất xứ nếu có |
| `sourceUrl` | ✅ | Bắt buộc |
| `scrapedAt` | ✅ | Bắt buộc |

---

## PHẦN KHÓ NHẤT — DỰNG "BIẾN THỂ TÊN TRÊN SÀN"

Đây mới là phần quyết định bài toán có đáng hay không. Danh mục sạch thì hệ thống
khớp 100%, chẳng chứng minh gì.

**Không được sao chép tên danh mục rồi dán lại.** Phải sinh ra những cái tên
mà chủ shop thật sự viết ra, theo các khuôn bên dưới. Số trong ngoặc là **tỉ lệ
mong muốn trong tập kiểm định**:

| Khuôn | Tỉ lệ | Ví dụ |
|---|---:|---|
| Viết tắt không dấu | 22 % | `SUA TUOI VINAMILK HOMOGENIZED 1L` ← `Sữa tươi Vinamilk Homogenized 1L` |
| Viết tắt có dấu | 10 % | `Sữa Tươi Vinamilk Hmzd 1L` |
| Sai chính tả / dấu | 12 % | `Sữa tươi Vinamilc Homogenzied 1L`, `BAG 125g Swirly Marbels` |
| Cắt bớt (mất thông tin) | 18 % | `Gạo Lứt Tám Xanh` ← `Gạo lứt tám xanh hương Sen Việt 5kg` |
| Bỏ thương hiệu | 8 % | `Mì tôm Chính Vị` |
| Gộp thuộc tính vào tên | 8 % | `Nước rửa bát Sunlight 750ml hương chanh` |
| Chữ in hoa không nhất quán | 8 % | `SỮA TƯƠI vinamilk HOMOGENIZED` |
| Có khuyến mãi | 6 % | `Sữa tươi Vinamilk Homogenized 1L - SALE`, `... - HÀNG MỚI` |
| Giữ nguyên | 8 % | dùng làm đối chứng |

**Luật bất di bất dịch:** mỗi biến thể phải **suy ra được** từ một tên danh mục
thật. **Không tự bịa tên không tồn tại.** Nếu tên danh mục không có thông tin nào
để cắt thì không sinh biến thể kiểu "cắt bớt".

---

## NHÃN ĐÁNH GIÁ — phần không được làm bằng code

Khớp mã hàng chỉ có nghĩa khi có **nhãn đúng do người gán**, và nhãn đúng đã
từng hỏng nặng. Ghi nhớ:

> Lần đo trước: trong 8 ca bị đánh dấu sai, **7 ca là người gán nhầm, không
> phải hệ thống sai** — cả hai đều là so khớp *không hợp lý* như người gán.

Vì vậy:

1. **Không được tự điền nhãn và gọi đó là nhãn chuẩn.** Nếu bạn sinh cả tên biến
   thể lẫn nhãn đúng bằng cùng một đoạn code, thì kết quả đo **không chứng minh
   được gì** — nó chỉ chứng minh code đúng với chính nó.
2. Viết ra **tệp nhãn trắng** để người thật gán: `scripts/llm/label-second.js`
   có sẵn cơ chế xuất bản mù.
3. Ghi rõ trong báo cáo: **n chưa có nhãn người gán thứ hai ⇒ Cohen κ = null.**
   Đừng điền hộ.

---

## CỔNG KIỂM — chạy tuần tự, không song song

Chạy **một lệnh một**, đợi xong mới chạy tiếp. PostgreSQL dừng giữa chừng sẽ làm
hỏng dữ liệu.

```bash
npm run demo:login -- --apply
npm run check:modules          # 220 module
npm test                       # 4499/4504
npm run check:swagger          # 136/136
npm run check:i18n
npm run check:accounting       # phai khop: GRN = phieu nhap, moi GRN co but toan
npm run check:tenant           # 11/11 + 4/4 + 4/4
npm run demo:check             # 25/25
npm run smoke:demo-flow        # 17/17
npm run smoke:grn-posting      # 16/16
npm run smoke:replenishment-rules
npm run llm:eval -- --mode live
```

**Bắt buộc:** không được báo "xong" khi còn lệnh đỏ. Nếu một lệnh đỏ, ghi lại
lý do và **để nó đỏ** trong báo cáo — đừng sửa con số cho khớp.

---

## 11 LỖI ĐÃ SỬA — đừng làm lại

Đọc `docs/aisc26/00-index.md` §3.2 đầy đủ. Ngắn gọn, ba cái dễ phá nhất:

| Lỗi | Bẫm khi sinh dữ liệu mới |
|---|---|
| PO đã nhận hàng mà không vào sổ cái | Dữ liệu nhiều hơn ⇒ dễ chạm. **Mọi GRN phải sinh bút toán.** |
| Bút toán `tenantId` NULL | Mọi bản ghi mới phải có `tenantId` |
| Sinh mã đơn trùng mỗi đêm | Tiền tố ngày lấy theo UTC còn mốc đếm theo local. Giữa 0h–7h giờ VN mỗi đêm sinh lại mã hôm trước. |
| Hàng rào số từ chối câu trả lời **đúng** | Khối số đưa cho LLM và khối số hàng rào kiểm phải **giống nhau** |
| Sinh mã bút toán `count+1` hỏng khi xoá | Đừng dùng `count+1` |

---

## ĐỊNH NGHĨA XONG

Báo cáo chỉ được ghi "xong" khi **tất cả** đúng:

- [ ] ≥ 8.000 sản phẩm, ≥ 8 ngành hàng, có bảng phân bố
- [ ] ≥ 95 % sản phẩm có EAN-13
- [ ] Mọi bản ghi có `sourceUrl` + `scrapedAt`
- [ ] Tập biến thể đạt tỉ lệ ở bảng, mỗi biến thể **suy ra được** từ tên thật
- [ ] Nhãn: đã xuất bản tệp trắng cho người thật gán; **κ = null** ghi rõ
- [ ] Mọi lệnh kiểm ở "CỔNG KIỂM" đều xanh, hoặc đỏ có lý do được ghi lại
- [ ] `npm test` 4499/4504
- [ ] `docs/aisc26/DEMO-UI.md` cập nhật nếu có màn hình phụ thuộc dữ liệu

---

## CÁCH BÁO CÁO

Báo cáo **dài và có số**, không rút gọn:

1. Bảng số lượng theo ngành hàng
2. Bảng tỉ lệ biến thể **thực tế** (đo được, không phải kế hoạch)
3. Danh sách lệnh kiểm: tên · trạng thái · số khẳng định
4. **Những gì chưa làm được và vì sao** — mục này quan trọng nhất

> Công thức giá trị cho bài thi này không phải "chỉ số đẹp", mà là **"quy trình
> kiểm chứng được chuỗi chỉ số"**. Một báo cáo trung thực ghi rõ
> `κ = null`, `0/6 người thử`, `7/8 nhãn sai` ăn điểm hơn một báo cáo toàn số đẹp.

Không bịa số. Không điền hộ. Không làm tròn để đẹp. Nếu làm được một nửa, nói
làm được một nửa.

---

## VÌ SAO NÊN CHẠY Ở PHIÊN MỚI

Ghi lại để tham khảo, không phải để tránh làm việc:

1. **Ngữ cảnh.** Phiên hiện tại đã dài; sinh hàng nghìn bản ghi rồi kiểm chứng
   trong ngữ cảnh đầy sẽ làm chất lượng giảm — đặc biệt là phần sinh biến thể tên,
   nơi cần nhớ kỹ từng quy tắc.
2. **Chi tiết lộ ra khi làm.** Có nhiều thứ chỉ biết khi bắt tay vào: đường dẫn
   phân trang thật của EMART, trường nào nằm ở đâu, chỗ nào chặn. Phiên mới sẽ
   phải khám phá lại từ đầu — đó là chi phí, nhưng không lãng phí ngữ cảnh đã dùng.
3. **Cần người ở giữa.** Xuất tệp nhãn trắng để người thật gán là việc mất thời
   gian tính bằng giờ, không tính bằng lượt. Chờ được thì nên dùng khoảng thời
   gian đó sang việc khác.

Đọc lại 4 file bối cảnh ở đầu prompt là đủ để bắt đầu — không cần mang theo
lịch sử phiên này.
