'use strict';
// Post-hoc descriptive audit. Never changes or replaces the preregistered raw
// score. Expected native aborts are identified symmetrically by same-capture
// abort-request -> error(aborted), while outcome/timeout/uniqueness stay gates.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { aggregate } = require('./voice-quality-statistics.cjs');
const native = card => card.slice(0, -1) + ({ s: 'E', h: 'C', d: 'O', c: 'P' })[card.at(-1)];
function classify(row) {
  const events = row.events || [], errorEvents = events.filter(e => e.kind === 'error');
  const expectedAborts = errorEvents.filter(e => e.error === 'aborted' && events.some(prior => prior.kind === 'abort-request' && prior.id === e.id && prior.at <= e.at));
  const unexpectedErrors = errorEvents.filter(e => !expectedAborts.includes(e));
  const functionalExact = Boolean(row.exactOutcome && row.unique && !row.noFinalReceived && !row.timeout && !row.startFailure && !unexpectedErrors.length && !row.pageErrors?.length && !row.error);
  let outcome;
  if (row.case.kind === 'reject') outcome = row.appliedCount > 0 ? 'UNEXPECTED_APPLICATION' : row.noFinalReceived ? 'REJECTION_NOT_EXERCISED_NO_FINAL' : functionalExact ? 'EXPECTED_REJECTION_OR_CLARIFICATION' : 'REJECTION_UNVERIFIED';
  else if (row.case.kind === 'action') outcome = row.exactOutcome ? row.unique ? 'EXPECTED_LEDGER_EXACT' : 'DUPLICATE_OR_UNEXPECTED_MUTATION' : row.appliedCount > 0 ? 'WRONG_LEDGER_ACTION' : 'NO_LEDGER_ACTION';
  else {
    const expected = Array(row.case.variant + 5).fill(null);
    row.case.expected.cards.forEach((card, index) => { expected[row.case.expected.target + index] = native(card); });
    const actual = row.finalSnapshot?.slots || [];
    const unexpected = actual.some((card, index) => card !== null && card !== expected[index]);
    if (row.exactOutcome) outcome = row.unique ? 'EXPECTED_CARD_DESTINATIONS_EXACT' : 'DUPLICATE_OR_UNEXPECTED_MUTATION';
    else if (!row.appliedCount) outcome = row.noFinalReceived ? 'NO_FINAL_NO_APPLICATION' : 'FINAL_REJECTED_NO_APPLICATION';
    else if (unexpected) {
      const available = expected.filter(Boolean);
      const allRecognizedCardsExpected = actual.filter(Boolean).every(card => {
        const index = available.indexOf(card); if (index < 0) return false; available.splice(index, 1); return true;
      });
      outcome = allRecognizedCardsExpected ? 'WRONG_DESTINATION' : 'WRONG_CARD_OR_EXTRA_CARD';
    } else outcome = row.appliedCount > 0 ? 'INCOMPLETE_WITH_CORRECT_APPLICATIONS' : row.noFinalReceived ? 'NO_FINAL_NO_APPLICATION' : 'FINAL_REJECTED_NO_APPLICATION';
  }
  return { order: row.order, label: row.label, id: row.case.id, kind: row.case.kind, locale: row.case.locale, rawStatus: row.status, rawExact: row.exact === true, functionalExact, outcome, expectedAbortEvents: expectedAborts.length, unexpectedErrors: unexpectedErrors.map(e => ({ id: e.id, error: e.error, at: e.at })), timeout: Boolean(row.timeout), finalMessage: row.finalMessage, finalTranscripts: events.filter(e => e.kind === 'result' && e.newFinalIndices?.length).flatMap(e => e.newFinalIndices.map(index => e.parts[index]?.text)), voiceSegmentsOverlappingGap: row.voiceSegmentsOverlappingGap || [], exactOutcome: row.exactOutcome, unique: row.unique, appliedCount: row.appliedCount, successfulCommandCommits: row.successfulCommandCommits };
}
function audit(report) {
  const rows = report.rows.map(classify), mapped = report.rows.map((row, index) => ({ ...row, exact: rows[index].functionalExact }));
  const result = { status: 'POSTHOC_DESCRIPTIVE_SCORING_AUDIT_NOT_REPLACEMENT', rawStatus: report.status, correction: 'An intentional same-recognizer abort-request followed by aborted was counted as capture failure by the strict raw collector, including valid ledger commits. This audit keeps raw scores and applies the same explicit cancellation interpretation to both versions. Partial correct sequences are separated from wrong cards and wrong destinations. No source, audio, outcomes, raw evidence, trial count or timeout gate is changed.', rows, summaries: {} };
  const filters = {
    allPositive: r => r.case.kind !== 'reject',
    cards: r => !['action', 'reject'].includes(r.case.kind),
    actions: r => r.case.kind === 'action',
    rejections: r => r.case.kind === 'reject',
    cleanSingle: r => r.case.id.includes('single') && !Number.isFinite(r.case.noiseSnrDb),
    batchSequence: r => r.case.id.includes('sequence-batch'),
    fastSequence: r => r.case.id.includes('sequence-fast'),
    noise: r => Number.isFinite(r.case.noiseSnrDb),
    destination: r => r.case.id.includes('destination'),
    correction: r => r.case.kind === 'correction'
  };
  for (const label of ['baseline', 'candidate']) {
    result.summaries[label] = {};
    for (const locale of ['all', 'pt-BR', 'en-US']) for (const [group, include] of Object.entries(filters)) {
      const filter = r => r.label === label && (locale === 'all' || r.case.locale === locale) && include(r);
      result.summaries[label][`${locale}/${group}`] = { strict: aggregate(report.rows.filter(filter)), functional: aggregate(mapped.filter(filter)) };
    }
  }
  return result;
}
if (require.main === module) {
  const root = path.resolve(__dirname, '../../validacao/voice-quality-2026-09-28'), input = path.resolve(process.argv[2] || path.join(root, 'native-final/native-quality.json')), output = path.resolve(process.argv[3] || path.join(root, 'native-audit'));
  if (fs.existsSync(output) && fs.readdirSync(output).length) throw Error('Preserve prior audit; choose new output directory.');
  const raw = fs.readFileSync(input), source = JSON.parse(raw), result = audit(source), sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  if (source.status !== 'COMPLETE_ALL_TRIALS_RETAINED') throw Error('Audit only after all frozen trials finish.');
  result.at = new Date().toISOString(); result.rawPath = input; result.rawSha256 = sha(raw); result.auditScriptSha256 = sha(fs.readFileSync(__filename));
  fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ path: path.join(output, 'audit.json'), rows: result.rows.length, classifications: result.rows.reduce((counts, row) => { counts[`${row.label}/${row.outcome}`] = (counts[`${row.label}/${row.outcome}`] || 0) + 1; return counts; }, {}) }, null, 2));
}
module.exports = { classify, audit };
