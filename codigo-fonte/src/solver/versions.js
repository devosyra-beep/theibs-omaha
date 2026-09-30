'use strict';

// Shared, side-effect-free identity for worker checkpoints and cached results.
// Bump when the adaptive refinement/certificate contract becomes incompatible.
// V2 invalidates pre-snapshot queue results and the old validation notice;
// solver mathematics and numerical qualification are unchanged.
module.exports = { ADAPTIVE_VERSION: 'THEIBS_HU_ADAPTIVE_V2' };
