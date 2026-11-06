'use strict';

const { createCatalog } = require('../data/catalog');
const { quoteSchema } = require('./validation');
const carriers = createCatalog().carriers;

/** Integer VNĐ quote; tariff is a demo assumption, never a live carrier quote. */
function quoteShipping(input) {
  const value = quoteSchema.parse(input);
  const carrier = carriers.find(c => c.id === value.carrierId);
  const billableWeightGram = Math.max(value.weightGram,
    Math.ceil(value.volumeCm3 / carrier.volumetricDivisorCm3PerKg * 1000));
  const weightSteps = Math.ceil(Math.max(0, billableWeightGram - carrier.includedWeightGram) / carrier.extraWeightStepGram);
  const distanceSteps = carrier.includedDistanceKm === null ? 0
    : Math.ceil(Math.max(0, value.distanceKm - carrier.includedDistanceKm));
  const amount = carrier.baseFees[value.lane] + weightSteps * carrier.extraWeightFee
    + distanceSteps * carrier.extraKmFee + Math.ceil(value.codAmount * carrier.codFeeBasisPoints / 10000);
  return { carrierId: carrier.id, currency: 'VNĐ', amount, billableWeightGram,
    slaHours: carrier.slaHours[value.lane], codCycle: carrier.codCycle, isSimulated: true };
}
module.exports = { quoteShipping };
