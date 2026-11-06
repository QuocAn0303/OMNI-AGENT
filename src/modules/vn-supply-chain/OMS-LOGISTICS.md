# Phần 3 — OMS/TMS và xử lý hoàn COD

## Phạm vi

`oms-logistics.service.js` xuất `createOmsLogisticsService`, `OUTBOUND_STATES`, `INBOUND_STATES`, `simulateSupplierDelay14Days`, `simulateDemandSurge50Percent`, `auditScenario`. Tracker outbound/inbound nằm trong cùng service để đồng bộ với WMS.

Mỗi OMS sở hữu một WMS riêng và không công khai quyền ghi WMS. State, cache chống lặp và lịch sử ở bộ nhớ từng instance; chưa lưu bền, chưa khóa liên tiến trình, chưa tích hợp hãng vận chuyển/thanh toán thật. Không sửa lõi ERP, không tự mount router. Tạo một instance trên mỗi tenant/phạm vi kho, giữ nguyên instance qua các request.

Thay đổi WMS Phần 2:
- `transaction(callback)` bao nhiều lệnh đồng bộ: rollback cả state, movement log và cache requestId khi một lệnh thất bại.
- Hàng hoàn được giữ `quarantineQty` tại Q **hoặc R**; in-transit vẫn chỉ ghi tại Q. OMS Phần 3 dùng R, Phần 2 mặc định Q vẫn hoạt động.
- Không thay công thức ATP; R không được bán trước QC/putaway.

## Đơn bán đa kênh

```js
const { createOmsLogisticsService } = require('./oms-logistics.service');
let time = '2026-11-01T09:00:00+07:00';
const oms = createOmsLogisticsService({
  clock: () => time,
  initialInventory: [
    { warehouseId: 'WH-HN', sku: 'VN-B-001', binId: 'HN-A-01-R1-B01', quantity: 20 },
    { warehouseId: 'WH-HCM', sku: 'VN-B-001', binId: 'HCM-A-01-R1-B01', quantity: 20 },
  ],
  hubCapacity: {
    'WH-HN': { unitsPerHour: 100, queuedUnits: 0 },
    'WH-HCM': { unitsPerHour: 100, queuedUnits: 0 },
  },
});
oms.createOutboundOrder({
  requestId: 'create-1', orderId: 'O1', channel: 'Shopee',
  region: 'MIEN_BAC', destinationCity: 'Hà Nội', paymentMethod: 'COD',
  dispatchDeadlineAt: '2026-11-02T09:00:00+07:00',
  items: [{ sku: 'VN-B-001', quantity: 3 }],
});
const routed = oms.routeOrderToOptimalHub({ requestId: 'route-1', orderId: 'O1' });
const fulfillmentId = routed.fulfillments[0].fulfillmentId;
oms.pickFulfillment({ requestId: 'pick-1', fulfillmentId });
oms.packFulfillment({
  requestId: 'pack-1', fulfillmentId, carrierId: 'GHN', lane: 'INTRACITY',
  measuredWeightGram: 1290, measuredVolumeCm3: 3600,
});
oms.shipFulfillment({ requestId: 'ship-1', fulfillmentId });
oms.recordDeliveryAttempt({
  requestId: 'delivery-event-1', fulfillmentId, attemptNumber: 1, outcome: 'DELIVERED',
});
```

Mọi lệnh cần requestId; lặp cùng payload trả kết quả cũ, khác payload bị từ chối. Thời gian sự kiện lấy từ clock, không nhận timestamp tùy ý từ callback; lớp HTTP tương lai cần xác thực webhook. Mã vận đơn kế thừa WMS là mã mô phỏng.

Đề bài gọi “7 trạng thái” nhưng liệt kê **8 tên** gồm nhánh hoàn; module giữ đầy đủ cả 8: NEW_ORDER → ROUTED_TO_WAREHOUSE → PICKING → PACKED → IN_TRANSIT_3PL → DELIVERED hoặc DELIVERY_FAILED_RTS → RETURNED_TO_WAREHOUSE.

PICKING là mốc OMS sau khi WMS hoàn tất phiếu nhặt. Mỗi kiện của đơn tách có trạng thái, vận đơn, lịch sử và tiền riêng. Đơn cha chỉ DELIVERED khi mọi kiện giao thành công. Khi các kiện đều kết thúc và có kiện hoàn, đơn cha RETURNED_TO_WAREHOUSE; đọc trạng thái từng kiện để biết phần nào đã giao. Yêu cầu hoàn của khách giữ DELIVERED đến khi hàng thực về.

Định tuyến nhận vùng rõ ràng từ đầu vào: MIEN_BAC/BAC_TRUNG_BO ưu tiên HN, MIEN_NAM/NAM_TRUNG_BO ưu tiên HCM. Chưa suy vùng tự động từ địa chỉ. Dùng ATP **thực tế** và sức chứa xử lý trước hạn: unitsPerHour × số giờ còn lại − queuedUnits. Thử toàn đơn ở kho ưu tiên, rồi kho còn lại, rồi chia theo SKU/số lượng. Không đủ hàng/công suất thì từ chối nguyên tử, không giữ chỗ dở dang.

QueuedUnits tăng lúc giữ chỗ và giảm khi bàn giao. Chỉ số định tuyến này là ước lượng công suất đến hạn bàn giao sàn, không phải tối ưu cự ly hay cam kết giao cuối. `dispatchSlaMet` đo giờ xuất thực tế; `deliverySlaMet` đo giờ giao so với SLA của hãng.

## Reverse Logistics COD

`recordDeliveryAttempt` nhận attemptNumber liên tiếp 1–3, outcome FAILED hoặc DELIVERED. Sau 1–2 lần thất bại vẫn đang giao; lần 3 tạo ReturnOrder. Áp dụng chính sách mô phỏng 3 lần cho GHN/GHTK và mặc định cho các hãng còn lại. Callback trùng/out-of-order không thể tăng lần giao hoặc tiền lần nữa.

Khách trả hàng sau giao thành công dùng:
```js
oms.requestCustomerReturn({ requestId: 'customer-return-1', fulfillmentId, reason: 'Khách yêu cầu đổi trả' });
```

Phần này hoàn **toàn bộ một kiện**, mỗi kiện chỉ có một phiếu hoàn; chưa hỗ trợ hoàn một phần hoặc tự sinh đơn đổi mới. ReturnOrder gắn vận đơn gốc. Phí chiều về mô phỏng: GHN/GHTK = 50% quote chiều đi, VTP/Ahamove = 100%; đây không phải biểu phí hợp đồng hiện hành.

```js
oms.processReturnedPackage({
  requestId: 'return-qc-1', returnId: 'RTS-' + fulfillmentId,
  grades: [{ sku: 'VN-B-001', aQty: 1, bQty: 1, cQty: 1 }],
  repackCostPerUnit: 5000,
});
```

- Nhận cả kiện vào R và ghi movement trước QC.
- Tổng A+B+C phải bằng từng dòng hàng hoàn, không được thiếu/trùng SKU.
- A lên lại bin A/B. B ghi chi phí tân trang rồi lên lại bin A/B trong cùng giao dịch.
- C vẫn ở R, đánh dấu chờ thanh lý/hủy; ghi writeOffCost theo giá vốn. Đây là hao hụt kinh tế, **không xóa số lượng vật lý trước khi tiêu hủy**.
- `totalReverseCost = returnFreightCost + repackCost + writeOffCost`, đơn vị VNĐ.
- COD thất bại không ghi tiền thu. COD giao thành công ghi collectedAmount và lịch đối soát T+3/T+5. Prepaid đã thu lúc phân bổ kiện.
- Trả hàng đã thanh toán ghi refundLiability riêng. Đây là **nghĩa vụ hoàn tiền**, không khẳng định đã hoàn ngân hàng; lịch COD là khoản chờ đối soát, chưa có thao tác chuyển tiền thật.

## PO từ nhà cung cấp

`createInboundPo({requestId, poId, supplierId, warehouseId, promisedAt, items})` khởi tạo PO. Sau đó gọi `advanceInboundPo({requestId, poId, status, qcResults?})` theo đúng thứ tự:

PO_CREATED → SUPPLIER_PRODUCTION → IN_TRANSIT_INBOUND → ARRIVED_AT_DOCK → QC_COMPLETED → PUTAWAY_DONE.

IN_TRANSIT tạo chuyến WMS; ARRIVED nhận GRN vào Q; QC_COMPLETED yêu cầu đủ `[{sku, passQty, defectQty}]`; PUTAWAY chỉ lên kệ lượng đạt. Lượng lỗi vẫn Q kèm biên bản WMS. Mỗi PO tracker hiện nhận một GRN đầy đủ; WMS vẫn hỗ trợ nhận từng phần khi dùng độc lập.

`getInboundPo(poId)` trả delayDays = ceil(max(0, giờ thực đến − giờ hẹn)/24h). Chưa tới kho thì so thời điểm hiện tại với hẹn; sau tới kho độ trễ được cố định theo arrivedAt. Đây là ngày trễ làm tròn lên, không phải số ngày làm việc.

## Bộ giải hai tình huống

```js
const { simulateSupplierDelay14Days, simulateDemandSurge50Percent } = require('./oms-logistics.service');
const delay = simulateSupplierDelay14Days();
const surge = simulateDemandSurge50Percent();
console.table(delay.comparison);
console.table(surge.comparison);
```

Các hàm thuần, không thay đổi OMS/WMS đang chạy. Trả before/after, comparison, responsePlan, feasible và unresolvedShortage. “Trước” là tình huống đã bị tác động nhưng **chưa ứng phó**, “Sau” dùng cùng cầu với phương án ứng phó.

### A — NCC chính trễ 14 ngày

Mặc định SKU VN-A-001, 28 ngày, PO hẹn ngày 3 dời sang ngày 17. HCM có 80 đơn vị, cầu 40/ngày; HN có 800, cầu 20/ngày. Tính stockoutDay bằng mô phỏng từng ngày.

Điều chuyển chỉ lấy phần donor còn dư sau khi bảo vệ cầu cả kỳ + 2 ngày an toàn; xuất ngày 1 và đến sau lead điều chuyển (mặc định 1 ngày). Lượng bắc cầu đủ đến trước ngày backup về, trong giới hạn nguồn. PO khẩn về ngày 4, làm tròn MOQ và dùng giá dự phòng từ danh mục. Lead 4 ngày là **thỏa thuận giả định của kịch bản**, kể cả SKU có lead dự phòng mặc định khác. Không tự nhận hàng sớm hơn lead.

Có thể đổi opening, dailyDemand, targetWarehouseId, primaryArrivalDay, primaryQuantity, transferLeadDays và days. Số lượng PO được làm tròn MOQ. Nếu thiếu ngay trước khi bất kỳ nguồn nào về hoặc donor không đủ, vẫn báo thiếu và feasible=false.

### B — +50% cầu trong 14 ngày

Mô phỏng 28 ngày: 14 ngày đầu cầu tăng 1,5 (làm tròn lên số nguyên), 14 ngày sau trở về nền. Nền HCM/HN là 60/40 đơn vị/ngày; tồn đầu 360/240.

Tăng safety stock từ 2 ngày cầu nền lên 3 ngày cầu đỉnh, dùng trong lượng đặt. Backup về ngày 4 bắc cầu đến primary (lead theo danh mục); primary bổ sung phần nhu cầu cả kỳ và tồn an toàn còn thiếu. Đều theo MOQ/giá VNĐ.

Chuyển tỷ lệ Đẩy/Kéo từ 70/30 sang 40/60; tỷ trọng Shopee/TikTok/Website/POS từ 40/30/20/10 sang 45/35/12/8, có thể truyền channelDemandShares. Sổ từng ngày ghi số phân bổ từng kênh và pushQty/pullQty, dùng làm ngân sách cấp hàng; chưa mô phỏng đơn từng kênh riêng lẻ.

Tăng ca chỉ 14 ngày đỉnh, có trần maxOvertimeMultiplier (mặc định 1,6). Công suất chọn theo cầu đỉnh và mục tiêu 95%, không vượt trần. Test trần 1 cho thấy không đạt SLA; không tự ép chỉ số thành 95%.

SLA trong mô phỏng là **số đơn một đơn vị có hàng và đủ công suất đóng gói/bàn giao đúng ngày / tổng nhu cầu**, không phải tỷ lệ giao thành công của 3PL. Kiểm tra riêng 14 ngày đỉnh bằng peakSlaRate; bảng comparison báo cả 28 ngày.

### Cân bằng và giới hạn mô phỏng

- GRN được QC/lên kệ đầu ngày nhận, giả định đạt 100%; không cộng trước ngày hàng tới.
- Mỗi dòng: tồn đầu + GRN + điều chuyển vào − điều chuyển ra − xuất = tồn cuối.
- Toàn hệ thống: tổng tồn đầu + GRN bên ngoài − xuất = tổng tồn cuối + hàng còn trên xe.
- Thiếu hàng/công suất là mất bán của ngày, không tự giấu vào backlog; unfulfilled gồm cả thiếu hàng và thiếu năng lực.
- Audit đối chiếu PO–GRN, chứng từ điều chuyển, từng ngày và chỉ số SLA. Nguồn cung giả định đủ lượng MOQ được đặt, chưa giới hạn tiền mặt/sản xuất hoặc tính chi phí tăng ca.
- `feasible` chỉ đúng khi phương án thực sự đáp ứng các tiêu chí đo được.

## Kiểm thử và báo cáo

```powershell
npm test -- --runTestsByPath src/modules/vn-supply-chain/tests/oms-logistics.service.test.js src/modules/vn-supply-chain/tests/wms.service.test.js src/modules/vn-supply-chain/tests/vnSeedData.test.js src/modules/vn-supply-chain/tests/routes.test.js
node src/modules/vn-supply-chain/runEmergencyScenarios.js
```

CLI tạo `data/generated/emergency-scenarios.json` và `emergency-scenarios.md` (đã được gitignore bởi Phần 1). Chạy lại ghi cùng dữ liệu xác định, không thêm bản ghi trùng.
