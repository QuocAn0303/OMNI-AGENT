/**
 * modules/production/bom-resolver.js — Giải nén BOM đệ quy
 * 
 * Tổng quan:
 * - Nhận một BOM (Bill of Materials) và flatten nó thành danh sách nguyên vật liệu phẳng
 * - Hỗ trợ BOM đa cấp (sub-assembly có BOM riêng)
 * - Depth tối đa 10 để tránh vòng lặp vô hạn
 * 
 * Hàm:
 * - expandBOM(bomId, maxDepth = 10): Trả về [{ productId, productName, sku, unit, quantity, level, isSubAssembly }]
 *     - Gọi đệ quy expandNode cho từng BOM item
 *     - Nếu item là sub-assembly có BOM active → đệ quy tiếp
 * - expandNode(parentId, multiplier, depth, maxDepth): Đệ quy giải nén từng node
 *     - multiplier nhân với quantity của từng item
 *     - skip nếu depth > maxDepth
 * - flattenBomItem(bomItemId, maxDepth = 10): API public — lấy BOM item + giải nén đệ quy
 */

const prisma = require("../../config/prisma");

/**
 * Recursively expand a BOM into a flat component list.
 * Sub-assemblies are expanded unless they have their own active BOM in which case
 * their BOM is expanded in turn (up to maxDepth).
 *
 * Returns: [{ productId, productName, sku, unit, quantity, level, isSubAssembly }]
 */
const flattenBom = async (bomId, qty = 1, depth = 0, maxDepth = 5, visited = new Set()) => {
  if (visited.has(bomId)) return []; // circular guard
  if (depth >= maxDepth) return [];
  visited.add(bomId);

  const bom = await prisma.bom.findUnique({
    where: { id: bomId },
    include: {
      items: {
        include: {
          component: {
            include: {
              bomsAsProduct: {
                where: { status: "ACTIVE", isSubAssembly: true },
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          },
        },
      },
    },
  });
  if (!bom) return [];

  const result = [];
  for (const item of bom.items) {
    const needed = item.quantity * qty;
    const subBom = item.component.bomsAsProduct[0];

    if (subBom && !visited.has(subBom.id)) {
      // Expand sub-assembly recursively
      const subItems = await flattenBom(subBom.id, needed, depth + 1, maxDepth, visited);
      result.push(...subItems);
    } else {
      result.push({
        productId: item.componentId,
        productName: item.component.name,
        sku: item.component.sku,
        unit: item.component.unit,
        quantity: needed,
        level: depth,
        isSubAssembly: !!subBom,
      });
    }
  }
  return result;
};

// Merge duplicate productIds by summing quantities
const mergeFlatBom = (flat) => {
  const map = new Map();
  for (const it of flat) {
    if (map.has(it.productId)) {
      map.get(it.productId).quantity += it.quantity;
    } else {
      map.set(it.productId, { ...it });
    }
  }
  return [...map.values()];
};

const resolveForWorkOrder = async (bomId, quantity) => {
  const flat = await flattenBom(bomId, quantity);
  return mergeFlatBom(flat);
};

module.exports = { flattenBom, mergeFlatBom, resolveForWorkOrder };
