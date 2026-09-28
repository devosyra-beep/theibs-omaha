'use strict';

// Fallback only: enumerate the complete compatible product before sampling it.
// Picking each opponent from its remaining range in sequence would change the
// joint weights. A partial enumeration must NEVER become a sampling population.
const MAX_NODES = 100000;
const MAX_JOINTS = 50000;

function enumerateJointRanges(ranges, baseBlocked, limits = {}) {
  const maxNodes = limits.maxNodes ?? MAX_NODES, maxJoints = limits.maxJoints ?? MAX_JOINTS;
  const blocked = Uint8Array.from(baseBlocked), selected = [], entries = [];
  let nodes = 0, exceeded = false, maximumLogWeight = -Infinity;
  function visit(depth, logWeight) {
    if (depth === ranges.length) {
      if (entries.length >= maxJoints) { exceeded = true; return; }
      entries.push({ hands: selected.slice(), logWeight });
      maximumLogWeight = Math.max(maximumLogWeight, logWeight);
      return;
    }
    for (const item of ranges[depth].valid) {
      if (++nodes > maxNodes) { exceeded = true; return; }
      if (item.hand.some(id => blocked[id])) continue;
      for (const id of item.hand) blocked[id] = 1;
      selected.push(item.hand);
      visit(depth + 1, logWeight + Math.log(item.weight));
      selected.pop();
      for (const id of item.hand) blocked[id] = 0;
      if (exceeded) return;
    }
  }
  visit(0, 0);
  if (exceeded) {
    const error = Error('Orçamento de amostragem conjunta esgotado; a compatibilidade dos ranges não foi determinada. Simplifique os ranges ou amplie o estudo.');
    error.code = 'JOINT_SAMPLING_BUDGET_EXCEEDED';
    error.samplerDiagnostics = { enumerationComplete: false, enumerationNodes: nodes, compatibleJointsFound: entries.length };
    throw error;
  }
  if (!entries.length) {
    const error = Error('Ranges incompatíveis entre si: enumeração completa não encontrou combinação conjunta legal.');
    error.code = 'INCOMPATIBLE_RANGES';
    error.samplerDiagnostics = { enumerationComplete: true, enumerationNodes: nodes, compatibleJoints: 0 };
    throw error;
  }
  // Log weights retain legal rare combinations even when their raw joint
  // product underflows. Reject remaining unrepresentable relative mass rather
  // than silently deleting it from the declared distribution.
  let totalWeight = 0;
  for (const entry of entries) {
    entry.weight = Math.exp(entry.logWeight - maximumLogWeight);
    if (entry.weight === 0) throw Error('Pesos conjuntos excedem a precisão numérica; reescale ou simplifique os ranges.');
    totalWeight += entry.weight;
    entry.cumulative = totalWeight;
  }
  return { entries, totalWeight, nodes };
}

function sampleJoint(table, rng) {
  const target = rng.next() * table.totalWeight;
  let low = 0, high = table.entries.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (target < table.entries[mid].cumulative) high = mid;
    else low = mid + 1;
  }
  return table.entries[low].hands;
}

module.exports = { enumerateJointRanges, sampleJoint };
