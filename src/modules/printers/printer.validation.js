const z = require('zod');

const createPrinter = z.object({
  name: z.string().min(1, 'Tên máy in không được để trống'),
  stationId: z.string().min(1).optional(),
  connectionType: z.enum(['BLUETOOTH', 'USB', 'NETWORK', 'WIFI']).default('BLUETOOTH'),
  macAddress: z.string().min(1).optional(),
  ipAddress: z.string().min(1).optional(),
  paperWidth: z.number().int().min(40).max(120).default(58),
  isActive: z.boolean().optional(),
});

const updatePrinter = createPrinter.partial();

module.exports = { createPrinter, updatePrinter };
