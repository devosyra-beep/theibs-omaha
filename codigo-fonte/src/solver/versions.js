'use strict';

// Shared, side-effect-free identity for worker checkpoints and cached results.
// Bump when the adaptive refinement/certificate contract becomes incompatible.
// V4 invalidates interrupted snapshots formerly marked as stopped/final.
// Resume metadata changes; CFR, certificates and qualification are unchanged.
module.exports = { ADAPTIVE_VERSION: 'THEIBS_HU_ADAPTIVE_V4' };
