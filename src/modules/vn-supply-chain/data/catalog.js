'use strict';

// All suppliers and commercial terms are fictional simulation fixtures.
const currency = 'VNĐ';
const channels = ['Shopee', 'TikTok Shop', 'Website', 'POS'];

function createCatalog() {
  const warehouses = [
    { id: 'WH-HCM', prefix: 'HCM', name: 'Trung tâm Vận hành TP.HCM', city: 'TP.HCM', regions: ['Miền Nam', 'Miền Trung'], demandShare: 0.6 },
    { id: 'WH-HN', prefix: 'HN', name: 'Trung tâm Vận hành Hà Nội', city: 'Hà Nội', regions: ['Miền Bắc'], demandShare: 0.4 },
  ];
  const zoneNames = { A: 'Hàng bán chạy', B: 'Hàng tiêu chuẩn', Q: 'Quarantine chờ kiểm định QC', R: 'Hàng hoàn trả' };
  const bins = [];
  for (const warehouse of warehouses) {
    warehouse.zones = Object.entries(zoneNames).map(([code, name]) => ({
      id: `${warehouse.prefix}-${code}`, code, name, aisles: ['01', '02'].map(aisle => ({
        id: `${warehouse.prefix}-${code}-${aisle}`, racks: [1, 2].map(rack => ({
          id: `${warehouse.prefix}-${code}-${aisle}-R${rack}`, bins: ['01', '02', '03'].map(bin => {
            const location = { id: `${warehouse.prefix}-${code}-${aisle}-R${rack}-B${bin}`, warehouseId: warehouse.id,
              zone: code, aisle, rack: `R${rack}`, bin: `B${bin}`, sellable: ['A', 'B'].includes(code) };
            bins.push(location);
            return location;
          }),
        })),
      })),
    }));
  }
  const products = [
    { sku: 'VN-A-001', name: 'Nước giặt túi 2 lít', group: 'A', strategy: 'PUSH', unitCost: 55000, sellingPrice: 89000, weightGram: 2100, volumeCm3: 2800, eoq: 1200, moq: 300, holdingCostPerDay: 20, stockoutPenaltyPerUnit: 34000, baseDailyDemand: 80 },
    { sku: 'VN-A-002', name: 'Khăn giấy gia đình 10 gói', group: 'A', strategy: 'PUSH', unitCost: 30000, sellingPrice: 49000, weightGram: 700, volumeCm3: 6000, eoq: 1000, moq: 300, holdingCostPerDay: 15, stockoutPenaltyPerUnit: 19000, baseDailyDemand: 65 },
    { sku: 'VN-B-001', name: 'Bình giữ nhiệt inox 500 ml', group: 'B', strategy: 'PUSH_PULL', unitCost: 85000, sellingPrice: 149000, weightGram: 380, volumeCm3: 1200, eoq: 600, moq: 200, holdingCostPerDay: 25, stockoutPenaltyPerUnit: 64000, baseDailyDemand: 40 },
    { sku: 'VN-B-002', name: 'Túi vải canvas có khóa kéo', group: 'B', strategy: 'PUSH_PULL', unitCost: 45000, sellingPrice: 79000, weightGram: 220, volumeCm3: 800, eoq: 600, moq: 200, holdingCostPerDay: 12, stockoutPenaltyPerUnit: 34000, baseDailyDemand: 35 },
    { sku: 'VN-S-001', name: 'Hộp quà chăm sóc cá nhân mùa lễ hội', group: 'SEASONAL', strategy: 'PULL', unitCost: 150000, sellingPrice: 259000, weightGram: 950, volumeCm3: 4500, eoq: 500, moq: 100, holdingCostPerDay: 40, stockoutPenaltyPerUnit: 109000, baseDailyDemand: 20 },
  ].map(product => ({ ...product, currency, isPhysical: true, isCore: true }));
  const supplierGroups = [
    ['A', 'Nhà máy Gia dụng Đồng Nai', 'Đồng Nai', 'Xưởng Gia dụng TP.HCM', 'TP.HCM', 12, 4, 300, 50, 7],
    ['B', 'Nhà máy Tiện ích Bình Dương', 'Khu vực Bình Dương, TP.HCM', 'Xưởng Tiện ích Hưng Yên', 'Hưng Yên', 10, 3, 200, 40, 6],
    ['SEASONAL', 'Nhà máy Quà tặng Đồng Nai', 'Đồng Nai', 'Xưởng Quà tặng Hưng Yên', 'Hưng Yên', 14, 5, 100, 20, 8],
  ];
  const suppliers = supplierGroups.flatMap(([group, primary, pLocation, backup, bLocation, pLead, bLead, pMoq, bMoq, premium]) =>
    ['PRIMARY', 'BACKUP'].map(role => {
      const isPrimary = role === 'PRIMARY';
      return { id: `SUP-${group}-${role}`, group, role, name: isPrimary ? primary : backup,
        location: isPrimary ? pLocation : bLocation, country: 'Việt Nam', isSimulated: true,
        leadTimeDays: isPrimary ? pLead : bLead, moq: isPrimary ? pMoq : bMoq,
        paymentTerms: isPrimary ? 'Net 30' : 'Prepaid', paymentDueDays: isPrimary ? 30 : 0,
        premiumPercent: isPrimary ? 0 : premium, currency,
        offers: products.filter(p => p.group === group).map(p => ({ sku: p.sku,
          unitCost: Math.round(p.unitCost * (isPrimary ? 100 : 100 + premium) / 100) })),
      };
    }));
  const carriers = [
    { id: 'GHN', name: 'Giao Hàng Nhanh', strengths: ['Đơn sàn TMĐT', 'Livestream'], codSettlementDays: 3, supportsPartialDelivery: false,
      baseFees: { INTRACITY: 22000, REGIONAL: 30000, INTERREGIONAL: 38000 }, slaHours: { INTRACITY: 24, REGIONAL: 48, INTERREGIONAL: 72 }, sourceUrl: 'https://ghn.vn/pages/dich-vu-giao-hang' },
    { id: 'GHTK', name: 'Giao Hàng Tiết Kiệm', strengths: ['Liên tỉnh', 'Giao hàng một phần'], codSettlementDays: 3, supportsPartialDelivery: true,
      baseFees: { INTRACITY: 20000, REGIONAL: 28000, INTERREGIONAL: 35000 }, slaHours: { INTRACITY: 24, REGIONAL: 72, INTERREGIONAL: 96 }, sourceUrl: 'https://ghtk.vn/blog/giao-hang-1-phan/' },
    { id: 'VTP', name: 'Viettel Post', strengths: ['Tuyến huyện/xã', 'Lô lớn liên miền Nam – Bắc'], codSettlementDays: 5, supportsPartialDelivery: false,
      baseFees: { INTRACITY: 24000, REGIONAL: 32000, INTERREGIONAL: 42000 }, slaHours: { INTRACITY: 48, REGIONAL: 72, INTERREGIONAL: 120 }, sourceUrl: 'https://viettelpost.com.vn/' },
    { id: 'AHAMOVE_2H', name: 'Ahamove 2 giờ', strengths: ['Hỏa tốc nội thành TP.HCM', 'Hỏa tốc nội thành Hà Nội'], cities: ['TP.HCM', 'Hà Nội'], codSettlementDays: 3, supportsPartialDelivery: false,
      baseFees: { INTRACITY: 25000 }, slaHours: { INTRACITY: 2 }, sourceUrl: 'https://ahamove.com/policy' },
  ].map(c => ({ ...c, currency, isSimulatedTariff: true, codCycle: `T+${c.codSettlementDays}`,
    settlementBasis: 'CALENDAR_DAYS_AFTER_DELIVERY', includedWeightGram: 500, extraWeightStepGram: 500,
    extraWeightFee: 5000, volumetricDivisorCm3PerKg: 5000, codFeeBasisPoints: 0,
    includedDistanceKm: c.id === 'AHAMOVE_2H' ? 4 : null, extraKmFee: c.id === 'AHAMOVE_2H' ? 5000 : 0,
    maxDistanceKm: c.id === 'AHAMOVE_2H' ? 15 : null,
  }));
  return { currency, channels, warehouses, bins, products, suppliers, carriers };
}

module.exports = { createCatalog };
