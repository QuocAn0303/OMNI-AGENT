const z = require('zod');

const createArea = z.object({
  name: z.string().min(1, 'Tên khu vực không được để trống'),
  description: z.string().optional(),
});

const updateArea = createArea.partial();

const createTable = z.object({
  code: z.string().min(1, 'Tên bàn không được để trống'),
  areaId: z.string().min(1),
  capacity: z.number().int().min(1).default(4),
  shape: z.enum(['SQUARE', 'ROUND', 'RECTANGLE']).default('SQUARE'),
  posX: z.number().default(0),
  posY: z.number().default(0),
  width: z.number().default(100),
  height: z.number().default(100),
});

const updateTable = createTable.partial();

const openSession = z.object({
  guestCount: z.number().int().min(1).optional(),
});

const mergeTables = z.object({
  toTableId: z.string().min(1, 'Thiếu bàn đích'),
});

const transferTable = mergeTables;

const createReservation = z.object({
  customerName: z.string().min(1, 'Tên khách không được để trống'),
  phone: z.string().min(1, 'Số điện thoại không được để trống'),
  guestCount: z.number().int().min(1).default(2),
  time: z.string().min(1, 'Thiếu thời gian đặt bàn'),
  note: z.string().optional(),
  tableId: z.string().optional(),
});

const updateReservation = createReservation.partial();

const seatReservation = z.object({
  tableId: z.string().min(1, 'Thiếu bàn sắp xếp'),
});

module.exports = { createArea, updateArea, createTable, updateTable, openSession, mergeTables, transferTable, createReservation, updateReservation, seatReservation };
