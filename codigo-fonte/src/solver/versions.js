'use strict';

// Shared, side-effect-free identity for worker checkpoints and cached results.
// Bump when the adaptive refinement/certificate contract becomes incompatible.
// V3 identifies fair refinement of the complete declared sizing tree and its
// explicit candidate provenance. CFR and qualification are unchanged.
module.exports = { ADAPTIVE_VERSION: 'THEIBS_HU_ADAPTIVE_V3' };
