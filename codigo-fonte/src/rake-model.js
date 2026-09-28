'use strict';

// Explicit cost contract. Pots must already exclude uncalled returns. A model
// describes a study hypothesis, never an operator's verified charging rules.
function normalizeRakeSchedule(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.type !== 'PERCENT_CAPPED') throw Error('rakeSchedule.type deve ser PERCENT_CAPPED.');
  const rate = Number(raw.rate), cap = Number(raw.cap);
  if (raw.rate == null || raw.rate === '' || !Number.isFinite(rate) || rate < 0 || rate > 1) throw Error('rakeSchedule.rate deve estar entre zero e um.');
  if (raw.cap == null || raw.cap === '' || !Number.isFinite(cap) || cap < 0 || Math.abs(cap * 100 - Math.round(cap * 100)) > 1e-7) throw Error('rakeSchedule.cap deve ter até duas casas decimais e ser não negativo.');
  if (typeof raw.noFlopNoDrop !== 'boolean') throw Error('Declare rakeSchedule.noFlopNoDrop.');
  if (!['FLOOR_CENT', 'NEAREST_CENT'].includes(raw.rounding)) throw Error('Declare o arredondamento de rakeSchedule.');
  if (!['USER_PROVIDED', 'SYNTHETIC_STUDY'].includes(raw.source)) throw Error('Declare a origem de rakeSchedule.');
  if (raw.version !== '1') throw Error('rakeSchedule.version deve ser 1.');
  return { type:'PERCENT_CAPPED', rate, cap, noFlopNoDrop:raw.noFlopNoDrop, rounding:raw.rounding, source:raw.source, version:'1' };
}

function calculateRake({ pot, boardCount }, raw) {
  const schedule = normalizeRakeSchedule(raw), amount = Number(pot);
  if (!Number.isFinite(amount) || amount < 0 || ![0,3,4,5].includes(boardCount)) throw Error('Informe pote elegível e quantidade válida de cartas abertas para calcular rake.');
  if (schedule.noFlopNoDrop && boardCount === 0) return 0;
  const unrounded = Math.min(amount, schedule.cap, amount * schedule.rate) * 100;
  const cents = schedule.rounding === 'FLOOR_CENT' ? Math.floor(unrounded + 1e-9) : Math.round(unrounded);
  return Math.min(amount, cents / 100);
}

module.exports = { normalizeRakeSchedule, calculateRake };
