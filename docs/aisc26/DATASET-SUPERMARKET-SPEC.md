# ĐẶC TẢ — Bộ dữ liệu "chuỗi siêu thị dùng Aduu ERP"

> Bàn giao cho phiên làm việc mới. Thay cho `PROMPT-REAL-DATA.md` (bản đó là
> thu thập danh mục; bản này là **dữ liệu vận hành nội bộ**).
>
> Mã hồ sơ AISC26-0058 · nhánh `round2/p0-hardening`

---

## 1. BỐI CẢNH

Kịch bản trình bày: **một chuỗi siêu thị dùng Aduu ERP** để quản lý toàn bộ
vòng đời hàng hóa — từ nhà sản xuất đến kho trung tâm, đến cửa hàng, đến quầy
thu ngân, đến khách hàng thân thiết.

Dữ liệu phải **tiếng Việt**, đủ rộng để mọi màn hình trong hệ thống đều có
nội dung thật, và **phải nhìn ra một doanh nghiệp thật** chứ không ra dữ liệu
mẫu.

---

## 2. HIỆN TRẠNG ĐO ĐƯỢC — đọc trước khi làm

Đã đếm trên DB thật, tenant `omni-demo-mo-phong`:

| Bảng | Hiện có | Một chuỗi siêu thị cần |
|---|---:|---:|
| `product` | 500 | 3.000 – 5.000 |
| `category` | **1** | 10 nhóm + 60–80 nhóm con |
| `vendor` | **1** | 40 – 80 |
| `warehouse` | **1** | 1 kho trung tâm + 8–12 cửa hàng |
| `purchaseOrder` | 58 | 800 – 1.200 |
| `goodsReceiptNote` | 57 | khớp số PO đã nhận |
| `journalEntry` | 72 | mỗi GRN + mỗi bán hàng đều phải có |
| `order` | 1.431 | 20.000 – 40.000 |
| `orderItem` | 2.858 | 50.000 – 120.000 |
| **`invoice`** | **0** | 20.000+ |
| **`payment`** | **0** | 20.000+ |
| **`stockTransfer`** | **0** | 300 – 800 |
| **`cycleCount`** | **0** | 30 – 60 |
| `customer` | 974 | 5.000 – 8.000 |
| **`loyaltyTransaction`** | **0** | 10.000+ |
| `inventoryTransaction` | 515 | phải khớp mọi biến động tồn |

Tên sản phẩm hiện tại là tiếng Anh, kiểu đồ trang trí nhập khẩu
(`WOODEN HEART CHRISTMAS SCANDINAVIAN`). Phải thay bằng hàng FMCG Việt Nam.

---

## 3. HAI THAY ĐỔI SCHEMA — LÀM TRƯỚC, KHÔNG LÀM ĐƯỢC THÌ DỪNG

### 3.1 `Product.barcode` — thiếu thật, không chỉ thiếu dữ liệu

Đã kiểm `prisma/schema.prisma`: trường `barcode` **chỉ tồn tại trên
`ProductVariant` (dòng 3816)**, không có trên `Product`.

Siêu thị quét mã vạch ở POS. Không có cột này thì **không mô phỏng được cách
bán hàng thật**, và bài toán khớp mã mất chân trụng.

```prisma
model Product {
  // …
  barcode String?  @unique   // EAN-13 / UPC; null = hàng không mã vạch
  // …
  @@index([tenantId, barcode])
}
```

`@unique` — mã vạch phải duy nhất, nếu không thì POS không quét được.

### 3.2 `Category.parentId` — cây ngành hàng

`Category` hiện phẳng (9 trường, không có quan hệ cha con). `Warehouse` đã có
`WarehouseTree`, `Account` đã có `AccountTree` — theo đúng khuôn đó:

```prisma
model Category {
  // …
  parentId String?
  parent   Category?  @relation("CategoryTree", fields: [parentId], references: [id], onDelete: Restrict)
  children Category[] @relation("CategoryTree")
  // …
  @@index([tenantId, parentId])
}
```

`onDelete: Restrict` — xoá nhóm cha khi còn nhóm con thì phải chặn, không để mất
hàng mồ côi.

### 3.3 Sau khi đổi schema

```bash
npx prisma migrate dev --name product_barcode_category_tree
npx prisma generate
npm test                              # 4499/4494 — phải không đỏ
npm run check:modules                 # 220 module
```

**Báo cáo kết quả cả hai lệnh.** Nếu `npm test` đỏ thì dừng, không đi tiếp.

---

## 4. CẤU TRÚC DỮ LIỆU

### 4.1 Cây ngành hàng — 10 nhóm

| Nhóm | Nhóm con (ví dụ) | Đặc điểm dữ liệu |
|---|---|---|
| **Thực phẩm tươi sống** | Rau củ · Thịt · Hải sản · Trứng | `trackByLot`, hạn dùng ngắn 3–7 ngày |
| **Sữa & đồ uống** | Sữa tươi · Sữa đậu · Nước · Trà · Cà phê | nhiều biến thể thể tích |
| **Thực phẩm khô & gia vị** | Gạo · Mì · Nước mắm · Dầu ăn · Đường | khối lượng rõ |
| **Đồ ăn nhanh & đông lạnh** | Mì gói · Đồ ăn sẵn · Đông lạnh | `trackByLot`, hạn dùng 30–180 ngày |
| **Bánh kẹo & đồ ngọt** | Socola · Bánh · Kẹo | |
| **Đồ gia dụng** | Giặt tẩy · Vệ sinh nhà cửa · Dụng cụ | công suất, số lượng |
| **Chăm sóc cá nhân** | Dầu gội · Sữa tắm · Chăm sóc da · Vệ sinh miệng | dung tích, loại da |
| **Mẹ & bé** | Sữa công thức · Tã · Bỉm | |
| **Đồ uống có cồn** | Bia · Rượu | khối lượng, năm, ABV |
| **Tạp hóa & đồ ăn vặt** | Hạt · Đồ ăn vặt | |

≥ 60 nhóm con, mỗi nhóm con ≥ 15 sản phẩm.

### 4.2 Sản phẩm — 3.000–5.000

Tên phải **có dấu, viết như siêu thị thật**:

```
Sữa tươi Vinamilk Homogenized 1L
Gạo Lứt Tám Xanh Hương Sen Việt 5kg
Nước rửa bát Sunlight 750ml Hương Chanh
Dầu ăn Neptune Hào Nhẹ 5L
Bột ngọt Ajinomoto 1kg
```

| Trường | Quy tắc |
|---|---|
| `sku` | Mã nội bộ 8 chữ số, **không trùng**, tăng dần |
| `barcode` | EAN-13 hợp lệ — **kiểm chữ số kiểm tra**. ≥ 97 % sản phẩm có mã |
| `name` | Có thương hiệu + tên + thể tích/khối lượng |
| `unit` | `cái` · `chai` · `hộp` · `bao` · `thùng` · `kg` · `g` · `ml` · `l` |
| `price` | Giá bán lẻ theo ngành, có mức rẻ hơn cho ngũ cốc lớn |
| `costPrice` | 62–78 % giá bán — siêu thị biên lợi nhân hàng ~12–18 % |
| `shelfLifeDays` | Bắt buộc với hóa phẩm tươi/đông lạnh |
| `trackByLot` | Bật với nhóm cần hạn dùng |
| `categoryId` | Trỏ đúng nhóm con |

**Kiểm tra EAN-13 bắt buộc.** Mã sai chữ số kiểm tra thì POS từ chối quét —
đó là loại lỗi âm thầm nguy hiểm nhất. Ghi số mã sai ra báo cáo.

### 4.3 Nhà cung cấp — 40–80

| Nhóm | Ví dụ loại | Ghi chú |
|---|---|---|
| Nhà sản xuất | Công ty CP Sữa Việt Nam, CTCP Dầu tư Tân Hồng | có MST, địa chỉ thật dạng |
| Nhà phân phối | Công ty TNHH Phân phối Đông Nam | thường mua nhiều ngành |
| NCC thực phẩm tươi | Hợp tác xã rau sạch Đồng Nai | giao hàng trong ngày |
| NCC nhập khẩu | Công ty TNHH TM SX Thương mại | hàng có nguồn gốc nước ngoài |

`Vendor` đã có sẵn các trường phân tích cần dùng: `kraljicCategory`,
`supplierGrade`, `otifScore`, `defectRate`, `paymentTerms` — **điền thật, đừng
để null**, vì đó là dữ liệu làm màn hình "Phân loại NCC (Kraljic)" có nội
dung.

### 4.4 Kho & cửa hàng

| Loại | Số lượng | `locationType` |
|---|---:|---|
| Kho trung tâm (DC) | 1 | kho trung tâm |
| Cửa hàng | 8–12 | cửa hàng |

Dùng cây `Warehouse.parentId` sẵn có: DC là cha, cửa hàng là con.

Mỗi cửa hàng có **bảng giá khác nhau** — siêu thị khác nhau giá khác nhau,
đó là dữ liệu làm `Price`/`promotion` có ý nghĩa.

### 4.5 Khách hàng — 5.000–8.000

Đây là phần bạn nói "đương nhiên là có khách hàng", và cũng là phần hiện tại
**thiếu nghiêm trọng nhất**: 974 khách nhưng `loyaltyTransaction = 0`,
`debt = 2`.

| Trường | Quy tắc |
|---|---|
| Tên | Họ + tên Việt phổ biến (Nguyễn, Trần, Lê, Phạm, Hoàng, Huỳnh, Phan, Vũ, Võ, Đặng…) |
| SĐT | `09xx xxx xxx`, **trùng lặp có kiểm soát** — khách mua nhiều lần phải là cùng một người |
| Email | theo mẫu họ + số |
| Địa chỉ | quận/huyện TP.HCM + Hà Nội + Đà Nẵng, có dạng ngõ/hẻm thật |
| Phân khúc | Bán lẻ thường · Thành viên bạc · Vàng · Kim cương — **theo giá trị tích lũy thật** |

**Lỗi thường gặp:** sinh 5.000 khách mà mỗi người mua đúng 1 đơn. Đó là dữ liệu
giả về mặt thống kê. Phải có phân bố như thật:

| Nhóm | Tỉ lệ | Số đơn / khách / năm |
|---|---:|---:|
| Mua 1–2 lần rồi bỏ | 55 % | 1–2 |
| Mua đều, rẻ | 25 % | 6–15 |
| Mua thường xuyên | 15 % | 20–45 |
| Khách lớn / sỉ | 5 % | 60–150 |

Và **mua nhiều hơn ở tháng 12, giảm ở tháng 2** — có mùa vụ. Đồ phẳng là dữ
liệu bịa.

### 4.6 Vòng mua hàng

```
Vendor → PurchaseOrder → GoodsReceiptNote → InventoryLot → InventoryTransaction → JournalEntry
```

- 800–1.200 PO trong 12 tháng
- Mỗi GRN **phải** sinh bút toán: `Nợ 156 + Nợ 1331 = Có 331`
- Hàng có `trackByLot` phải tạo **lot** với ngày hết hạn và số lượng
- `InventoryTransaction` phải khớp: nhập +, bán −, hết hạn −, kiểm kê ±

### 4.7 Vòng bán hàng

```
POS ở cửa hàng → Order → OrderItem → Invoice → Payment
                → InventoryTransaction (−) → JournalEntry
```

- 20.000–40.000 đơn trong 12 tháng
- **Mỗi đơn hằng ngày, mọi ngày trong năm** — không bỏ trừ Chủ nhật
- Giờ cao đỉnh 11h–13h và 17h–19h
- Cuối tuần và cuối tháng nhiều hơn
- Đơn của khách thành viên gắn `customerId`; đơn khách vãng lai thì không

**Hiện tại `invoice = 0` và `payment = 0`** — không có bán hàng nào ra hóa đơn.
Đây là lỗ hổng lớn nhất của bộ dữ liệu hiện tại.

### 4.8 Chuyển kho & kiểm kê

| Loại | Số lượng | Vì sao cần |
|---|---:|---|
| `stockTransfer` | 300–800 | DC bổ sung cửa hàng — nguyên lý hoạt động của chuỗi |
| `cycleCount` | 30–60 | Kiểm kê định kỳ, phát hiện chênh lệch tồn |

Có `stockTransfer` thì màn hình "Cây vị trí kho" (`smoke:warehouse-tree` 18/18)
mới có ý nghĩa.

### 4.9 Thanh trản & công nợ

- `Payment` tương ứng từng `Invoice`
- `Debt` cho công nợ phải thu: 10–15 % khách mua đủ ngưỡng tính công nợ
- Một phần khách **trễ hạn** — công nợ có biến động mới đáng nhìn

---

## 5. NGUYÊN TẮC KHÔNG ĐƯỢC PHÁM

### 5.1 Số phải khớp nhau

| Quan hệ | Điều kiện |
|---|---|
| GRN ↔ PO | Mỗi GRN có PO cha hợp lệ; mỗi PO đã nhận có ít nhất 1 GRN |
| GRN ↔ Bút toán | **Mọi** GRN có bút toán. Không ngoại lệ |
| OrderItem ↔ Tồn | Mỗi dòng hàng giảm tồn đúng số lượng |
| Loyalty ↔ Order | Tổng điểm = tổng tiền × hệ số, không tự do |
| Tồn | `inventory.quantity` luôn khớp tổng biến động |

Lệnh kiểm đã có sẵn, phải xanh:
```bash
npm run check:accounting     # GRN = phiếu nhập, mỗi GRN có bút toán
npm run smoke:grn-posting   # 16/16
npm run smoke:demo-flow      # 17/17
npm run demo:check           # 25/25
```

### 5.2 Không sinh dữ liệu biến thể ở bước này

Biến thể tên trên sàn là việc của bài đo khớp mã, **làm sau**, không gộp vào
đây. Gộp vào sẽ không phân biệt được dữ liệu nào thật, dữ liệu nào bịa.

### 5.3 Không điền số để cho khớp

Nếu một lệnh kiểm đỏ vì dữ liệu sai → sửa **dữ liệu**, không sửa lệnh kiểm.
Nếu không sửa được dữ liệu thì **ghi lệnh đỏ vào báo cáo**, đừng làm nó xanh
bằng cách nới điều kiện.

---

## 6. THỨ TỰ LÀM

| Bước | Việc | Xong khi |
|---:|---|---|
| 1 | Đổi schema: `Product.barcode`, `Category.parentId` | migrate chạy, `npm test` không đỏ |
| 2 | Cây ngành hàng (10 nhóm + ≥60 nhóm con) | đếm được trong DB |
| 3 | Nhà cung cấp (40–80) | có đủ trường Kraljic, không null |
| 4 | Kho DC + 8–12 cửa hàng (dùng `parentId`) | cây kho đúng |
| 5 | Sản phẩm (3.000–5.000) + barcode hợp lệ | ≥ 97 % có mã, 0 mã sai chữ số kiểm tra |
| 6 | Tồn kho mở đầu | khớp với sản phẩm |
| 7 | Khách hàng (5.000–8.000) + phân khúc | phân bố số đơn đúng bảng |
| 8 | Vòng mua: PO → GRN → lot → bút toán | `check:accounting` xanh |
| 9 | Vòng bán: đơn → hóa đơn → thanh toán | `invoice` và `payment` **không còn 0** |
| 10 | Chuyển kho + kiểm kê | `smoke:warehouse-tree` xanh |
| 11 | Loyalty + công nợ | `loyaltyTransaction` **không còn 0** |
| 12 | Chạy toàn bộ cổng kiểm | xem §7 |

Sau bước 9, `invoice` và `payment` phải khác 0. Đó là mốc để biết đã làm tới
đâu.

---

## 7. CỔNG KIỂM

Chạy **tuần tự**, một lệnh một, đợi xong mới chạy tiếp.

```bash
npm run demo:login -- --apply
npm run check:modules
npm test
npm run check:swagger
npm run check:i18n
npm run check:accounting
npm run check:tenant
npm run smoke:grn-posting
npm run smoke:replenishment-rules
npm run smoke:rfq
npm run smoke:warehouse-tree
npm run check:supply
npm run demo:check
npm run smoke:demo-flow
```

Bổ sung kiểm riêng cho dữ liệu mới — viết script và in số:

```bash
node scripts/check-supermarket-dataset.js
```

Script này phải in, tối thiểu:

```
san pham               : 3.842
  co barcode           : 3.796 (98,8%)
  barcode SAI chu so   : 0          <-- phai bang 0
nhan hang              : 1.006
  co buoc toan         : 1.006/1.006
  thieu GRN            : 0
don hang               : 31.204
  co hoa don           : 31.204
  co thanh toan        : 31.198        <-- cho phep vai chua thanh toan
  theo thang           : thang 12 cao nhat, thang 2 thap nhat
khach hang             : 6.113
  nhom 1-2 lan         : 55,4%
  nhom 20-45 lan       : 14,8%
  don/khach trung binh : 5,1
```

**Đặc biệt `barcode SAI chu so: 0`** — mã EAN sai chữ số kiểm tra sẽ bị POS
từ chối quét, và đó là loại lỗi âm thầm nguy hiểm nhất.

---

## 8. 11 LỖI ĐÃ SỬA — ĐỪNG LÀM LẠI

Đọc đầy đủ `docs/aisc26/00-index.md` §3.2. Ngắn gọn:

| Lỗi | Rủi ro khi sinh dữ liệu lớn |
|---|---|
| PO nhận hàng không vào sổ cái | **39 PO lọt** trước đây. Dữ liệu càng nhiều càng dễ chạm |
| Bút toán `tenantId` NULL | 18 dòng. Mọi bản ghi mới phải có `tenantId` |
| Sinh mã đơn trùng mỗi đêm | Tiền tố ngày lấy UTC còn mốc đếm lấy local — hỏng 0h–7h giờ VN |
| `count+1` cho mã bút toán | Hỏng khi có lỗ hổng. Đừng dùng |
| Hàng rào số từ chối câu trả lời **đúng** | Khối số đưa cho LLM và khối số hàng rào kiểm phải **giống nhau** |

---

## 9. CÁCH BÁO CÁO

1. Bảng số lượng **thực tế đếm được**, theo từng bước §6
2. Bảng phân bố sản phẩm theo ngành hàng
3. Bảng phân bố khách hàng theo số đơn — **đối chiếu với bảng ở §4.5**
4. Bảng đơn hàng theo tháng — phải thấy mùa vụ
5. Tỉ lệ barcode hợp lệ + số mã sai
6. Kết quả 14 lệnh ở §7 + output của script kiểm dữ liệu
7. **Những gì chưa làm được, và vì sao**

> Công thức giá trị cho bài thi này không phải "số đẹp" mà là **"quy trình kiểm
> chứng được chuỗi số"**. Báo cáo trung thực ghi rõ `κ = null`, `0/6 người thử`,
> `7/8 nhãn sai` ăn điểm hơn báo cáo toàn số đẹp.

---

## 10. VÌ SAO NÊN LÀM Ở PHIÊN MỚI

1. **Ngữ cảnh.** Phiên hiện tại đã dài. Sinh vài chục nghìn bản ghi rồi kiểm
   chứng trong ngữ cảnh đầy sẽ làm chất lượng giảm — nhất là phần phân bố khách
   hàng và mùa vụ, nơi cần nhớ kỹ từng ràng buộc.
2. **Hai thay đổi schema.** Cần migrate + regenerate + sửa mọi chỗ gọi. Việc
   này dễ bị bỏ dở giữa chừng nếu ngữ cảnh cạn.
3. **Chờ được thì làm song song.** Xuất tệp nhãn trắng cho người thật gán mất
   thời gian tính bằng giờ. Nên giao việc đó cho người ngay, còn mình dựng dữ
   liệu.

Đọc 4 file bối cảnh ở đầu là đủ — không cần mang lịch sử phiên trước.
