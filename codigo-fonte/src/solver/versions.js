'use strict';

// Shared, side-effect-free identity for worker checkpoints and cached results.
// Bump when the adaptive refinement/certificate contract becomes incompatible.
// V5 invalidates the former execution/compilation and cost-budget contract.
// CFR, game hashes, certificates and qualification are unchanged.
module.exports = { ADAPTIVE_VERSION: 'THEIBS_HU_ADAPTIVE_V5' };
