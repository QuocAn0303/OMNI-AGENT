'use strict';

const { stripDiacritics } = require('../../utils/vietnamese');
const { levRatio, diceSet, trigrams } = require('../import/sku-matcher');

const normalizeName = (text) => stripDiacritics(text).toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const compact = (text) => normalizeName(text).replace(/ /g, '');

/** Match partial names and typos without changing the import matcher's thresholds. */
const nameScore = (query, name) => {
  const words = normalizeName(name).split(' ');
  const wanted = normalizeName(query).split(' ');
  // Numbers distinguish variants (Loại 1/2, 160/180 g); never correct them.
  const numbers = normalizeName(query).match(/\d+/g) || [];
  const actualNumbers = normalizeName(name).match(/\d+/g) || [];
  if (numbers.some((number) => !actualNumbers.includes(number))) return 0;
  const q = compact(query);
  // Token coverage allows omitted descriptors, e.g. "đường Biên Hòa" for
  // "Đường trắng Biên Hòa", while preserving the number check above.
  const tokenScores = wanted.map((word) => Math.max(...words.map((candidate) => levRatio(word, candidate))));
  let score = tokenScores.reduce((sum, value) => sum + value, 0) / wanted.length;
  // Sliding windows also handle a short brand/product name inside a longer title.
  for (let size = Math.max(1, wanted.length - 1); size <= Math.min(words.length, wanted.length + 3); size += 1) {
    for (let start = 0; start + size <= words.length; start += 1) {
      const candidate = words.slice(start, start + size).join('');
      const edit = levRatio(q, candidate);
      const dice = diceSet(trigrams(q), trigrams(candidate));
      score = Math.max(score, 0.8 * edit + 0.2 * dice);
    }
  }
  // A user may add a descriptor absent from the stored title ("cà phê" before
  // "Legend Trung Nguyên"). Strong shared brand terms can offer choices, but
  // must not produce an automatic match by dropping the unmatched words.
  const evidence = wanted.filter((word, index) => word.length >= 3 && tokenScores[index] >= 0.65);
  if (evidence.length >= 2 && evidence.length >= wanted.length / 2 && evidence.join('').length >= 8) {
    score = Math.max(score, 0.65);
  }
  return score;
};

const matchProductNames = (query, products) => {
  const q = normalizeName(query).slice(0, 160);
  if (!q) return { status: 'ALL', candidates: [] };
  const exactSku = products.find((product) => compact(product.sku) === compact(q));
  if (exactSku) return { status: 'MATCH', product: exactSku, candidates: [exactSku] };
  // A mistyped SKU must not silently select the adjacent code.
  if (/^[a-z]{0,6}\d{3,}[a-z0-9]*$/i.test(compact(q))) return { status: 'NONE', candidates: [] };
  const scored = products.map((product) => ({ product, score: nameScore(q, product.name) }))
    .filter(({ score }) => score >= 0.65)
    .sort((a, b) => b.score - a.score || a.product.sku.localeCompare(b.product.sku));
  if (!scored.length) return { status: 'NONE', candidates: [] };
  const candidates = scored.slice(0, 5).map(({ product }) => product);
  const top = scored[0];
  const margin = scored[1] ? top.score - scored[1].score : 1;
  if (q.length >= 4 && top.score >= 0.82 && margin >= 0.06) {
    return { status: 'MATCH', product: top.product, candidates };
  }
  return { status: 'REVIEW', candidates };
};

module.exports = { normalizeName, matchProductNames };
