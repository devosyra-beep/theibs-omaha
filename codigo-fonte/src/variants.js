'use strict';
/** Single source of truth for supported Omaha High variants. */
const VARIANTS = Object.freeze({ PLO4_HIGH: 4, PLO5_HIGH: 5, PLO6_HIGH: 6 });
function holeCount(variant = 'PLO5_HIGH') {
  if (!Object.hasOwn(VARIANTS, variant)) throw new Error(`Variante não suportada: ${variant}.`);
  return VARIANTS[variant];
}
function variantForCount(count) {
  const variant = `PLO${Number(count)}_HIGH`;
  holeCount(variant);
  return variant;
}
module.exports = { VARIANTS, holeCount, variantForCount };
