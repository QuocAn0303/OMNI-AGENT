const prisma = require('../../config/prisma');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const calculateFifoCost = async (productId, warehouseId, quantity, tx = prisma) => {
  if (!quantity || quantity <= 0) return { costItems: [], totalCost: 0 };

  const [lots, product] = await Promise.all([
    tx.inventoryLot.findMany({
      where: { productId, warehouseId, quantity: { gt: 0 } },
      orderBy: [{ expDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    }),
    tx.product.findUnique({ where: { id: productId }, select: { costPrice: true } }),
  ]);

  const defaultCost = Number(product?.costPrice || 0);
  const costItems = [];
  let remaining = quantity;

  for (const lot of lots) {
    if (remaining <= 0) break;
    const takeQty = Math.min(Number(lot.quantity), remaining);
    const unitCost = Number(lot.unitCost || 0) || defaultCost;
    costItems.push({ lotId: lot.id, quantity: takeQty, unitCost });
    remaining -= takeQty;
  }

  if (remaining > 0 && defaultCost > 0) {
    costItems.push({ lotId: null, quantity: remaining, unitCost: defaultCost });
  }

  const totalCost = round2(costItems.reduce((sum, item) => sum + item.quantity * item.unitCost, 0));
  return { costItems, totalCost };
};

const recordFifoConsumption = async (tx, productId, warehouseId, quantity, options = {}) => {
  const { note, orderId } = options;
  const { costItems, totalCost } = await calculateFifoCost(productId, warehouseId, quantity, tx);
  for (const item of costItems) {
    if (item.lotId) {
      await tx.inventoryLot.update({
        where: { id: item.lotId },
        data: { quantity: { decrement: item.quantity } },
      });
      await tx.lotTransaction.create({
        data: {
          lotId: item.lotId,
          type: 'CONSUME',
          quantity: item.quantity,
          orderId: orderId || null,
          note: note || '',
        },
      });
    }
  }
  return { costItems, totalCost };
};

module.exports = { calculateFifoCost, recordFifoConsumption };
