const z = require('zod');

const createStation = z.object({
  name: z.string().min(1, 'Tên station không được để trống'),
  printerId: z.string().min(1).optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

const updateStation = createStation.partial();

module.exports = { createStation, updateStation };
