'use strict';
// Unknown is not zero. Keep the same contract at HTTP and engine boundaries.
function isMissing(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}
function optionalNumber(value, label = 'value', { nonNegative = false } = {}) {
  if (isMissing(value)) return null;
  if (!['number', 'string'].includes(typeof value)) throw Error(`${label} deve ser um número finito.`);
  const number = Number(value);
  if (!Number.isFinite(number) || (nonNegative && number < 0)) throw Error(`${label} deve ser um número ${nonNegative ? 'maior ou igual a zero' : 'finito'}.`);
  return number;
}
module.exports = { isMissing, optionalNumber };
