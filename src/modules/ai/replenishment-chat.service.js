'use strict';

const prisma = require('../../config/prisma');
const ApiError = require('../../utils/apiError');
const { runWithTenant, getTenantId } = require('../../config/tenantContext');
const { previewForProduct } = require('../replenishment/replenishment.suggest');
const { normalizeName, matchProductNames } = require('./product-name-match');

const CHOICE_PROMPT = 'Bạn muốn kiểm tra mã SKU nào trong danh sách trên?';
const PAGE_SIZE = 500;
const DISPLAY_LIMIT = 10;

/** Offline recognition of read-only restocking questions; explicit write commands keep their existing route. */
const detectReplenishmentRequest = (text, previousReply = '') => {
  const normalized = normalizeName(text);
  if (previousReply.includes(CHOICE_PROMPT) && /^[a-z0-9-]+$/i.test(String(text).trim())) {
    return { query: String(text).trim() };
  }
  if (/\b(?:tao|duyet|dat hang|gui tin|xoa|huy)\b/.test(normalized)) return null;
  if (!/\b(?:can nhap|nen nhap|sap het|het hang|nhap lai|can mua|bo sung hang)\b/.test(normalized)) return null;
  let query = normalized
    .replace(/\b(?:co can nhap|can nhap|nen nhap|sap het hang|sap het|het hang|nhap lai|can mua|bo sung hang)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const leading = /^(?:(?:toi muon biet|toi muon hoi|cho toi biet|cho minh biet|cho minh|giup minh|kiem tra|xem|hay|toi|minh|cac|nhung|mon hang|mat hang|san pham|hang hoa|mon|hang|nao|gi|trong kho|trong data|trong du lieu)\s*\b)+/;
  const trailing = /\b(?:(?:khong|chua|khong vay|nua|khong nhi|nhi|nhe|vay|a|voi|giup minh|hien tai|hom nay|bao nhieu|co|trong kho)\s*)+$/;
  query = query.replace(leading, '').replace(trailing, '').trim();
  return { query };
};

/** Page through the tenant's active catalog, including older products beyond the first page. */
const loadCatalog = async (tenantId) => {
  const products = [];
  let cursor;
  for (;;) {
    const page = await prisma.product.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, sku: true },
      orderBy: { id: 'asc' }, take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    products.push(...page);
    if (page.length < PAGE_SIZE) return products;
    cursor = page[page.length - 1].id;
  }
};

const formatPreview = (product, preview) => {
  if (!preview) return `• ${product.name} (SKU: ${product.sku}): chưa đủ dữ liệu để kiểm tra nhập hàng.`;
  const { plan } = preview;
  const needsStock = ['NEED_REPLENISHMENT', 'STOCKOUT'].includes(plan.status) && plan.order.orderQty > 0;
  return `• ${product.name} (SKU: ${product.sku}): ${needsStock ? 'CẦN NHẬP' : 'CHƯA CẦN NHẬP'}. `
    + `Tồn khả dụng: ${plan.atp.atp}; đang đặt: ${plan.atp.onOrder}; điểm đặt lại (ROP): ${plan.rop.rop}.`
    + (needsStock ? ` Gợi ý tham khảo: ${plan.order.orderQty} ${preview.product.unit || 'đơn vị'}.` : '');
};

const queryReplenishment = async ({ query = '' } = {}, user = {}) => {
  const tenantId = user.tenantId || getTenantId();
  if (!tenantId) throw new ApiError(403, 'Không xác định được doanh nghiệp để tra cứu nhập hàng');
  const wanted = String(query).trim();
  if (wanted.length > 160) return 'Tên hàng quá dài. Hãy nhập tên sản phẩm hoặc mã SKU ngắn gọn.';
  return runWithTenant(tenantId, async () => {
    const products = await loadCatalog(tenantId);
    const match = matchProductNames(wanted, products);
    if (match.status === 'NONE') return `Không tìm thấy mặt hàng phù hợp với "${wanted}" trong danh mục đang hoạt động của bạn. Hãy nhập thêm tên hoặc mã SKU.`;
    if (match.status === 'REVIEW') {
      return `Tên "${wanted}" gần giống nhiều mặt hàng hoặc chưa đủ rõ:\n`
        + match.candidates.map((product) => `• ${product.name} (SKU: ${product.sku})`).join('\n')
        + `\n${CHOICE_PROMPT}`;
    }
    if (match.status === 'MATCH') {
      const preview = await previewForProduct({ productId: match.product.id });
      return `Đối chiếu với danh mục: ${match.product.name} (SKU: ${match.product.sku}).\n`
        + formatPreview(match.product, preview)
        + '\nSố gợi ý do công thức tính. Bạn quyết định số lượng thực tế tại Duyệt đề xuất nhập.';
    }
    const needed = [];
    let checked = 0;
    let unavailable = 0;
    // Bound DB concurrency and output length; explicitly report the scanned scope.
    for (let index = 0; index < products.length && needed.length < DISPLAY_LIMIT; index += 6) {
      const batch = products.slice(index, index + 6);
      const previews = await Promise.all(batch.map((product) => previewForProduct({ productId: product.id })));
      checked += batch.length;
      previews.forEach((preview, offset) => {
        if (!preview) { unavailable += 1; return; }
        if (['NEED_REPLENISHMENT', 'STOCKOUT'].includes(preview.plan.status) && preview.plan.order.orderQty > 0) {
          needed.push(formatPreview(batch[offset], preview));
        }
      });
    }
    const scope = `Đã kiểm tra ${checked}/${products.length} sản phẩm đang hoạt động${unavailable ? `; ${unavailable} sản phẩm chưa đủ dữ liệu` : ''}.`;
    return scope + '\n' + (needed.length
      ? needed.slice(0, DISPLAY_LIMIT).join('\n') + '\nĐây là gợi ý tham khảo; bạn tự quyết định số lượng nhập.'
      : 'Chưa tìm thấy sản phẩm cần nhập trong dữ liệu đã kiểm tra.');
  });
};

module.exports = { detectReplenishmentRequest, queryReplenishment, CHOICE_PROMPT };
