/* Optional endpoint timing for single-card speech. This module only asks the
 * caller to finish capture; it never changes ASR finality or applies a card. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./card-voice'));
  else root.TheibsCardVoiceFast = factory(root.TheibsCardVoice);
})(typeof window !== 'undefined' ? window : globalThis, function (voice) {
  'use strict';

  class FastEndpoint {
    constructor({ delayMs = 220, now = () => globalThis.performance?.now?.() ?? Date.now(),
      setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = handle => clearTimeout(handle),
      onReady = () => {} } = {}) {
      if (!Number.isFinite(delayMs) || delayMs < 0) throw new RangeError('delayMs must be finite and nonnegative.');
      if ([now, setTimer, clearTimer, onReady].some(value => typeof value !== 'function')) throw new TypeError('Timer dependencies and onReady must be functions.');
      this.delayMs = delayMs; this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer; this.onReady = onReady;
      this.timer = null; this.generation = 0; this.current = null;
    }
    update({ key, eligible, contextKey } = {}) {
      const enabled = eligible === true, previous = this.current;
      if (previous && Object.is(previous.key, key) && Object.is(previous.contextKey, contextKey) && previous.eligible === enabled) return false;
      this.clear();
      const current = { key, contextKey, eligible: enabled, startedAt: this.now(), fired: false };
      this.current = current;
      if (!enabled) return false;
      const generation = this.generation;
      const ready = () => {
        if (this.generation !== generation || this.current !== current || current.fired) return;
        this.timer = null;
        const stableMs = Math.max(0, this.now() - current.startedAt);
        if (stableMs < this.delayMs) { this.timer = this.setTimer(ready, this.delayMs - stableMs); return; }
        current.fired = true;
        this.onReady({ key: current.key, contextKey: current.contextKey, stableMs });
      };
      this.timer = this.setTimer(ready, this.delayMs);
      return true;
    }
    clear() {
      this.generation++;
      if (this.timer !== null) this.clearTimer(this.timer);
      this.timer = null; this.current = null;
    }
  }

  function candidate(text, locale = 'pt-BR') {
    try {
      const command = voice.parse(text, locale);
      return command.type === 'cards' && command.cards.length === 1 ? command : null;
    } catch { return null; }
  }

  return { FastEndpoint, candidate };
});
