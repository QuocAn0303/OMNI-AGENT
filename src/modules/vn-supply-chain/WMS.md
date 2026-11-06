# Phần 2 — WMS 5 trạng thái và bổ sung hàng

## Khởi tạo và phạm vi

```js
const { createWmsService, calculateEOQ, calculateROP } = require('./wms.service');
const { evaluateSupplyChainSignals } = require('./scoringAdapter');

const wms = createWmsService({
  // Đọc dòng tồn đầu tương ứng từ operations.initialInventory của Phần 1.
  initialInventory: [
    { warehouseId: 'WH-HCM', sku: 'VN-B-001', binId: 'HCM-A-01-R1-B01', quantity: 10 },
  ],
  clock: () => new Date(), // Có thể thay clock khi chạy mô phỏng.
});
```

Mỗi instance có state riêng, dành cho một tenant/phạm vi vận hành; không tạo singleton dùng chung khách hàng. Đây là động cơ đồng bộ **trong một tiến trình Node.js**. Mọi lệnh sao chép state, kiểm tra bất biến rồi commit nguyên tử; lỗi không để lại cập nhật dở dang. Không có bước await giữa kiểm tra ATP và giữ chỗ.

State và lịch sử được giữ trong bộ nhớ, **chưa lưu bền hoặc khóa xuyên nhiều tiến trình**. Khi triển khai nhiều worker cần repository transaction/locking theo tenant ở tầng tích hợp; không dùng các instance độc lập cho cùng một tồn kho. Không tự mount route, ghi PostgreSQL hoặc sửa các tệp lõi/Phần 1.

Mọi lệnh thay đổi cần `requestId` duy nhất. Lặp đúng lệnh trả lại kết quả cũ, không lặp biến động; dùng cùng ID cho nội dung khác bị từ chối. Cache chống lặp có vòng đời cùng instance. `getSnapshot()` trả bản sao gồm inventory, shipments, receipts, orders, defectReports, alerts, inventoryMovementLog và workflowEvents.

## Trạng thái và lịch sử

Mỗi dòng `warehouseId × sku × binId` có `onHandQty, reservedQty, quarantineQty, inTransitQty, atpQty`.

- `ATP = onHandQty - reservedQty`. Hàng Q/R và hàng đi đường không được bán.
- On-hand là số lượng sổ kho được trừ ở bước bàn giao; hàng đã nhặt/đóng gói vẫn được gắn với bin nguồn và reserved đến khi xuất. Mô hình chưa có bin staging riêng.
- Mỗi thay đổi số lượng tạo `InventoryMovementLog` với trước/sau, delta, thời điểm, requestId và loại lệnh. ATP được tính lại; tất cả số dư là số nguyên không âm.
- Mọi bước nghiệp vụ, kể cả QC/đóng gói không đổi số lượng, có `workflowEvents`.
- Reserved phải khớp tổng phân bổ đơn; in-transit phải khớp lượng chưa nhận trên chuyến hàng; quarantine phải khớp GRN chưa lên kệ/chưa trả lỗi.
- Clock không được quay ngược giữa các lệnh. Timestamp được lưu ISO UTC; hiển thị Việt Nam dùng Asia/Ho_Chi_Minh.

## Luồng 5 bước

### 1. Nhập kho và QC

Đăng ký chuyến hàng **đã xuất phát** bằng `registerInboundShipment`:

```js
wms.registerInboundShipment({
  requestId: 'dispatch-PO1', shipmentId: 'S1', sourceId: 'PO1', sourceType: 'PO',
  supplierId: 'SUP-B-PRIMARY', warehouseId: 'WH-HCM', quarantineBinId: 'HCM-Q-01-R1-B01',
  items: [{ sku: 'VN-B-001', quantity: 10 }],
  expectedArrivalAt: '2026-11-10T09:00:00+07:00',
  expectedAvailableAt: '2026-11-11T09:00:00+07:00',
});
wms.receiveInboundGoods({
  requestId: 'receive-S1', shipmentId: 'S1', receiptId: 'GRN1',
  items: [{ sku: 'VN-B-001', quantity: 10, passQty: 8, defectQty: 2 }],
});
```

Ngày dự kiến phải từ thời điểm clock trở đi. `expectedAvailableAt` là lúc dự kiến hoàn tất QC/lên kệ, không phải ngày xe đến. Bỏ cả passQty/defectQty để nhận hàng chờ QC; sau đó gọi:

```js
wms.inspectInboundGoods({
  requestId: 'qc-GRN1', receiptId: 'GRN1',
  results: [{ sku: 'VN-B-001', passQty: 8, defectQty: 2 }],
});
```

Chỉ dùng cách QC tách riêng nếu chưa QC khi nhận. Mỗi dòng QC phải phân loại đủ lượng chờ; cho phép nhiều GRN nhận từng phần của một chuyến. Hàng lỗi vẫn ở Q, kèm biên bản trả NCC; `returnDefectiveGoods({requestId, receiptId, sku, quantity})` ghi nhận hàng thực tế trả đi.

Với `sourceType: 'TRANSFER'`, thay supplierId bằng `sourceWarehouseId`; đăng ký chuyến tự trừ **ATP** nguồn và tăng in-transit đích. Không điều chuyển hàng đã giữ chỗ. Nhận tại đích theo cùng luồng QC/lên kệ.

Hàng hoàn khách dùng `receiveReturnedGoods({requestId, receiptId, orderId, receivingBinId, quarantineBinId, items})`: chỉ nhận từ đơn đã xuất, không vượt lượng đã xuất trừ các lần hoàn trước. Ghi nhận điểm tiếp nhận zone R, chuyển vào Q chờ QC. Hàng hoàn lỗi giữ Q chờ quyết định xử lý; không tự trả NCC.

### 2. Lưu kho

```js
wms.putawayToBin({
  requestId: 'put-GRN1', receiptId: 'GRN1', sku: 'VN-B-001',
  binId: 'HCM-A-01-R1-B01', quantity: 8,
});
```

Chỉ chuyển hàng đạt QC chưa putaway vào bin A/B cùng kho. Có thể chia sang nhiều ô; chưa triển khai giới hạn sức chứa từng bin.

### 3. Nhặt hàng và Pick-Short

```js
const order = {
  orderId: 'O1', warehouseId: 'WH-HCM', channel: 'Shopee',
  items: [{ sku: 'VN-B-001', quantity: 2 }],
};
wms.reserveOrder({ requestId: 'reserve-O1', ...order }); // Tùy chọn giữ chỗ trước.
wms.pickOrderItems({
  requestId: 'pick-O1', ...order,
  // Tùy chọn: tổng tồn thực tế trong phạm vi bin, gồm hàng đã giữ/nhặt chưa xuất.
  // binCounts: [{ sku: 'VN-B-001', binId: 'HCM-A-01-R1-B01', actualOnHandQty: 1 }],
});
```

Pick tự giữ chỗ nếu chưa reserve. Phiếu nhặt sắp theo bin ID chuẩn chứa zone/dãy/kệ/ô. `pickWave({requestId, orders: [...]})` gom nhiều đơn và sắp đường nhặt theo kho → bin → SKU → đơn; đây là thứ tự dãy kệ, không phải tối ưu tọa độ vật lý.

Pick-Short ghi giảm tồn thực tế và cảnh báo. Đơn RESERVED bị ảnh hưởng được giải phóng toàn bộ phân bổ để không bị giữ chỗ dở dang; đơn đang nhặt được phân bổ lại từ các bin còn ATP. Không đủ hàng thì trả trạng thái `AWAITING_STOCK`, giữ lại cảnh báo và số đếm đúng. Các đơn khác bị ảnh hưởng cần được lên lịch nhặt lại. Không tự lấy hàng đã PICKED/PACKED của đơn khác: kiểm đếm mâu thuẫn với lượng đó bị từ chối nguyên tử.

`cancelOrder({requestId, orderId})` giải phóng đơn chưa nhặt. Đơn đã nhặt cần quy trình unpick riêng, chưa có trong phần này.

### 4. Đóng gói

```js
wms.packOrder({
  requestId: 'pack-O1', orderId: 'O1', carrierId: 'GHN', lane: 'INTRACITY',
  destinationCity: 'TP.HCM', distanceKm: 5,
  measuredWeightGram: 910, measuredVolumeCm3: 2500,
});
```

Ví dụ cân 2 bình 380g + thùng S 150g = 910g. Dung sai cân là max(50g, 5% trọng lượng hàng + vỏ thùng). Thùng S/M/L có dung tích 8.000/27.000/64.000 cm³, tải 3/10/25 kg. Chọn thùng nhỏ nhất đủ thể tích và tải; thể tích đo không nhỏ hơn tổng hàng. Chưa mô phỏng xếp hình 3D.

Nhãn `<carrier>-SIM-<UUID>` là **mô phỏng**, duy nhất và không đổi khi replay; không gọi API hãng. Quote dùng cấu hình 3PL Phần 1, có giới hạn Ahamove nội thành. Chưa có tạo PDF/ảnh nhãn hoặc đặt vận đơn thật.

### 5. Xuất kho

`shipOrderOut({requestId, orderId})` chỉ nhận đơn PACKED, trừ on-hand/reserved một lần, chuyển `HANDED_OVER_CARRIER`, ghi `shippedAt` thực tế theo clock và `slaDueAt = shippedAt + SLA`.

## Dự báo ATP, EOQ/ROP và điều phối

```js
wms.projectedAtp({
  warehouseId: 'WH-HCM', sku: 'VN-B-001', daysAhead: 3,
  forecastDaily: [10, 12, 9], // Hoặc dailyDemand: 10, không truyền đồng thời.
});
calculateEOQ({ annualDemand: 10000, orderingCost: 100000,
  holdingCostPerUnitPerYear: 2000, moq: 300 }); // rawEOQ=1000, orderQty=1200.
calculateROP({ dailyDemand: 10, leadTimeDays: 12, safetyStock: 30 }); // 150.
```

`projectedAtpQty = ATP hiện tại + lượng chưa nhận dự kiến sẵn sàng trong kỳ - cầu dự báo`. Forecast là **cầu mới chưa được giữ chỗ**, tránh trừ lại đơn reserved. PO quá hạn không tự giả định sẽ đến; GRN đã nhận không được cộng hai lần. Hàng đang Q không tự tăng projected ATP. Dự báo ATP có thể âm để báo thiếu hụt; ATP thực tế luôn không âm. Không truyền dự báo thì dùng cầu nền SKU × tỷ trọng hub.

EOQ = sqrt(2 × D × S / H): D là đơn vị/năm, S là VNĐ/lần đặt, H là VNĐ/đơn vị/năm. Làm tròn **lên bội MOQ**. ROP = ceil(cầu/ngày × lead time + safety stock).

`planReplenishment({orderingCost: 200000, safetyStockDays: 3, reviewDays: 7, procurementMode: 'PURCHASE'})` trả kế hoạch cho 10 cặp hub/SKU, không tự tạo PO. Có thể đổi mode thành SUBCONTRACT. Chọn NCC dự phòng khi PO chính trễ hoặc ATP dự kiến cuối lead time chính âm; ngược lại dùng chính. Tính vị thế tồn từ ATP + nguồn về đúng hạn trong lead time/review, chọn lượng theo EOQ/ROP và MOQ. Chi phí hoàn toàn bằng VNĐ, H lấy holdingCostPerDay × 365.

## Cổng scoringAdapter

```js
const strategy = (snapshot, defaults) => defaults.map(score => ({
  ...score,
  priorityScore: score.sku === 'VN-B-001' ? 100 : 20,
  reason: 'Ưu tiên SKU chủ lực',
}));
const plans = wms.planReplenishment({}, strategy);
// Hoặc createWmsService({ customStrategyFn: strategy }).
```

`evaluateSupplyChainSignals({signals}, customStrategyFn)` nhận các signal gồm warehouseId, sku, atpQty, inTransitQty, quarantineQty, dailyDemand, leadTimeDays, stockoutPenaltyPerUnit, unitCost. Mặc định chấm 80% nguy cơ thiếu trong lead time + 20% mất bán/giá vốn. Không có cầu thì điểm 0.

Plugin là hàm đồng bộ hoặc module `{evaluate(snapshot, defaults)}`; trả đúng một `{warehouseId, sku, priorityScore, reason}` cho mỗi tín hiệu. Điểm phải hữu hạn 0–100. Thiếu/trùng/sai SKU, Promise hoặc điểm sai bị từ chối; lỗi plugin được báo ra, không âm thầm fallback. Input/defaults là bản sao đóng băng; plugin không được gọi mutation WMS lồng vào trong khi đánh giá. Điểm chỉ đổi thứ tự ưu tiên, không tự thay lượng PO, giá hay MOQ.

## Kiểm thử

Từ thư mục repository:

```powershell
npm test -- --runTestsByPath src/modules/vn-supply-chain/tests/wms.service.test.js src/modules/vn-supply-chain/tests/vnSeedData.test.js src/modules/vn-supply-chain/tests/routes.test.js
```
