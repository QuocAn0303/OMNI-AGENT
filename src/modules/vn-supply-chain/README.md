# Chuỗi cung ứng Việt Nam — Phần 1

Module CommonJS độc lập, dùng Express/Zod/Jest sẵn có. Không tự mount router, sửa Prisma, ghi dữ liệu ERP, gọi hãng vận chuyển hoặc thay đổi tệp lõi. Tất cả dữ liệu là **mô phỏng**, không chứa dữ liệu khách hàng/tenant thực.

## Sử dụng

Từ thư mục gốc repository:

```powershell
node src/modules/vn-supply-chain/vnSeedData.js
npm test -- --runTestsByPath src/modules/vn-supply-chain/tests/vnSeedData.test.js src/modules/vn-supply-chain/tests/routes.test.js
```

CLI lưu snapshot tại `data/generated/vn-seed.json` trong module (được gitignore). Chạy lại cùng tham số giữ nguyên nội dung và báo `changed: false`. Thay seed hoặc ngày bắt đầu thay thế toàn bộ snapshot kịch bản, không append. Snapshot có ID xác định, ghi file tạm + fsync + rename và khóa ghi độc quyền. Khi tiến trình chết để lại `.vn-seed.lock`, chỉ gỡ khóa sau khi xác minh không còn tiến trình seed đang chạy. Không có migration hay bản ghi nào được nạp vào PostgreSQL ở Phần 1.

```js
const {
  buildVnSeedData, generateTwoMonthOperationsLog,
  seedVnSupplyChain, auditInventory, quoteShipping,
} = require('./src/modules/vn-supply-chain');

const dataset = buildVnSeedData(); // Không có tác dụng phụ, bao gồm catalog/operations/audit.
const log = generateTwoMonthOperationsLog({ startDate: '2026-11-01', seed: 42 });
const result = seedVnSupplyChain({ seed: 42 }); // Snapshot lưu bền sau khi restart.
const audit = auditInventory(dataset.catalog, dataset.operations);
```

Tham số chỉ gồm `startDate` (ngày ISO hợp lệ), `days` (chỉ chấp nhận 60) và `seed` (số nguyên uint32, bao gồm 0). Ngày mặc định cố định để kết quả không đổi theo thời điểm chạy. Hai tháng lịch 11–12 có 61 ngày; yêu cầu **60 ngày** được áp dụng từ **01/11/2026 đến 30/12/2026**, tức **8 tuần + 4 ngày**, có cả sale 11/11 và 12/12. Chọn ngày bắt đầu khác có thể không bao gồm hai sale này.

## Cấu trúc

- `data/catalog.js`: 2 hub; 4 zone mỗi kho; 2 dãy/zone × 2 kệ/dãy × 3 ô/kệ = 96 bin; 5 SKU; 6 NCC; 4 3PL.
- `data/snapshot.repository.js`: lưu snapshot nguyên tử, idempotent.
- `services/validation.js`: schema Zod cho bộ sinh, quote và query API.
- `services/operations.service.js`: PRNG theo seed, mua hàng, nhập/xuất, hoàn/QC, COD, chốt ngày.
- `services/inventory-audit.service.js`: kiểm tra độc lập chứng từ, tham chiếu và cân bằng.
- `services/logistics.service.js`: tính phí VNĐ nguyên theo tuyến, trọng lượng thực/quy đổi, bậc khối lượng, km và COD.
- `routes/vn-supply-chain.routes.js`: router tùy chọn, dùng auth/role và response helper của hệ thống.
- `vnSeedData.js`: API công khai và CLI seed.
- `tests/`: unit test và HTTP test bằng Express thật, auth được thay thế bằng middleware kiểm thử.

## Mô hình dữ liệu và giả định vận hành

`catalog` chứa `warehouses, bins, products, suppliers, carriers, channels, currency`. Kho HCM phục vụ miền Nam/Trung; kho HN phục vụ miền Bắc. Bình Dương được ghi là khu vực Bình Dương, TP.HCM. Mọi tên NCC là dữ liệu giả lập; mức giá NCC dự phòng cao hơn chính 6%, 7% hoặc 8%.

`operations` chứa:

| Bảng | Nội dung |
| --- | --- |
| metadata | Khoảng ngày, seed, đơn vị VNĐ, tỷ lệ COD, số tuần |
| initialInventory | 10 số dư khởi đầu theo hub/SKU và bin bán được |
| dailyLogs | 60 tổng hợp ngày, sale, số đơn, tồn kho, COD đối soát |
| demand | 2.400 nhóm đơn theo ngày × 2 hub × 5 SKU × 4 kênh |
| inventory | 600 số dư ngày theo hub/SKU |
| purchaseOrders | PO chính/dự phòng, MOQ, giá, lý do đặt, ngày hẹn/thực nhận, hạn thanh toán |
| goodsReceipts | GRN nối PO, lượng nhận/đạt QC, bin Q và bin cất hàng |
| returns | RTS nối nhóm đơn, ngày về zone R, QC tại Q, đạt/không đạt và bin cất hàng |
| codSettlements | COD thành công, lịch T+3/T+5, số tiền và trạng thái chốt kỳ |

Mỗi nhóm đơn đại diện cho **các đơn một sản phẩm, mỗi đơn một đơn vị**; `orderCount = fulfilledQuantity`. `actualDemand = fulfilledQuantity + stockoutQuantity`; nhu cầu không được đáp ứng là mất bán, không tự chuyển thành backlog. Nhóm đơn có thể gồm cả giao thành công và RTS; trạng thái `COMPLETED` cho biết vận chuyển nhóm đã kết thúc, không có nghĩa tất cả đều thành công. POS nhận tại quầy, trả trước và không gán 3PL.

Tỷ lệ COD mục tiêu **65% tổng đơn được xuất**, Prepaid 35%. Phân bổ COD lên đơn online, POS luôn trả trước. Số đơn COD được làm tròn **một lần trên toàn kỳ**: sai số tối đa 0,5 đơn so với 65%, vì số đơn phải là số nguyên. Từng ngày/kênh không bắt buộc đạt chính xác 65%. `metadata.realizedCodRate` báo tỷ lệ thực tế.

Push dựa vào cầu nền; Push-Pull kết hợp cầu nền với tín hiệu 3 ngày gần nhất và tỷ trọng kênh biến động; Pull mùa vụ dùng tín hiệu cầu thực tế. Hai ngày Mega Sale nhân cầu lần lượt theo nhóm A/B/mùa vụ: 2 / 3,5 / 8. PO chính đầu tiên mỗi hub/SKU bị trễ 3 ngày để tạo tình huống ứng cứu. PO dự phòng dựa vào tồn thấp và giao trễ hoặc tăng cầu. EOQ là chính sách đầu vào, không tự suy ra từ chi phí đặt hàng chưa được cung cấp. Mỗi PO là một SKU, số lượng theo bội MOQ. Net 30 tính từ ngày PO; GRN nhận đủ một lần, QC nhập mới hoàn tất trong ngày.

Với hàng hoàn, ngày về kho cách ngày giao thất bại 3 ngày; QC mất thêm 1 ngày. Hàng chưa QC/không đạt QC không được bán. Tồn theo bin của hàng Q/R không phải một sổ tồn vật lý hoàn chỉnh; module ghi các vị trí xử lý trên chứng từ và cân bằng **tồn khả dụng** theo hub/SKU:

```text
Tồn đầu + Nhập GRN đạt QC + Nhập hoàn đạt QC − Xuất bán = Tồn cuối
```

Xuất bán được trừ khi bàn giao vận chuyển, không chờ thu tiền. Audit đối chiếu nguồn GRN, phiếu hoàn và các nhóm đơn; kiểm tra cả tồn đầu ngày kế tiếp và cân bằng toàn kỳ. Đơn hoàn phát sinh gần cuối kỳ có các trường `planned*` để biểu diễn lịch tương lai; số `acceptedQuantity` chỉ được ghi nhận khi QC nằm trong kỳ. PO chưa nhận, hàng đi đường và COD chưa đến hạn được giữ trạng thái mở; không tạo GRN hay tăng tồn ngoài kỳ.

SLA được tính từ ngày xuất, Ahamove 2H giao cùng ngày. Các hãng còn lại dùng SLA nguyên ngày. Đối soát COD tính theo **ngày lịch sau giao thành công**, chưa tính ngày lễ/cuối tuần, phí sàn, VAT, hoàn tiền trả trước, công nợ kế toán hay đối soát ngân hàng. COD chỉ tính tiền hàng của đơn thành công; phí giao được ghi riêng. Tỷ lệ thất bại mục tiêu online 6%, tăng 12% ngày sale; tần suất thực tế theo seed/số đơn nguyên. `plannedRtsRate` là kết quả dự kiến cuối cùng của nhóm, `realizedRtsRate` chỉ ghi nhận khi ngày giao nằm trong kỳ.

## API tùy chọn

Việc mount cần được thực hiện ở bước tích hợp do Phần 1 không sửa lõi:

```js
const { createRouter } = require('./modules/vn-supply-chain');
app.use('/api/vn-supply-chain', createRouter());
```

Router dùng `authenticate → authorize(ADMIN, MANAGER, WAREHOUSE, ACCOUNTANT)`. Không có endpoint ghi snapshot hoặc ghi dữ liệu kinh doanh. Dữ liệu demo dùng chung, không đọc tenant; khi mở rộng sang dữ liệu thật cần repository có tenant scope.

- `GET /catalog`: danh mục.
- `GET /operations?date=2026-11-11&warehouseId=WH-HCM&sku=VN-A-001&channel=Shopee&page=1&limit=100`: nhóm đơn, tối đa 200 dòng/trang.
- `GET /audit`: kết quả cân bằng.
- `POST /shipping-quote`: quote mô phỏng, body JSON theo schema/Swagger trong router.

API lấy kịch bản mặc định trong bộ nhớ riêng của router; không đọc snapshot tùy chỉnh từ CLI. Các bảng PO/GRN/hoàn/tồn đầy đủ nằm trong API JS và snapshot JSON.

## 3PL và nguồn tham khảo

Các biểu phí, SLA và COD T+3/T+5 là **giả định cấu hình phục vụ mô phỏng theo đề bài**, không phải báo giá, hợp đồng hoặc lịch đối soát hiện hành của hãng. Nguồn chính thức dùng tham khảo loại hình dịch vụ:

- GHN: https://ghn.vn/pages/dich-vu-giao-hang
- GHTK giao hàng một phần: https://ghtk.vn/blog/giao-hang-1-phan/
- Viettel Post: https://viettelpost.com.vn/
- Ahamove: https://ahamove.com/policy

Ahamove chỉ nhận quote nội thành cùng TP.HCM/Hà Nội, tối đa 15 km theo giả định. GHTK có capability giao một phần trong danh mục; bộ đơn một đơn vị không mô phỏng giao một phần. VTP có biểu phí liên miền; mô phỏng bán hàng vẫn tuân thủ vùng phục vụ của từng hub.
