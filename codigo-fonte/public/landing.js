'use strict';

(() => {
  const header = document.querySelector('.site-header');
  if (!header) return;

  // Clamp elastic scrolling so bouncing at either edge does not reverse the bar.
  const scrollPosition = () => Math.max(0, Math.min(
    window.scrollY,
    Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
  ));
  let previousY = scrollPosition();
  let travel = 0;
  let pendingFrame = false;

  function updateHeader() {
    pendingFrame = false;
    const y = scrollPosition();
    const delta = y - previousY;
    previousY = y;

    if (y <= header.offsetHeight || header.contains(document.activeElement)) {
      header.classList.remove('is-scroll-hidden');
      travel = 0;
      return;
    }
    if (!delta) return;

    // Ignore tiny direction changes from trackpads without delaying a real scroll.
    travel = Math.sign(travel) === Math.sign(delta) ? travel + delta : delta;
    if (travel >= 10) header.classList.add('is-scroll-hidden');
    else if (travel <= -6) header.classList.remove('is-scroll-hidden');
  }

  window.addEventListener('scroll', () => {
    if (pendingFrame) return;
    pendingFrame = true;
    window.requestAnimationFrame(updateHeader);
  }, { passive: true });

  function revealHeader() {
    header.classList.remove('is-scroll-hidden');
    previousY = scrollPosition();
    travel = 0;
  }
  header.addEventListener('focusin', revealHeader);
  window.addEventListener('pageshow', revealHeader);
  window.addEventListener('resize', revealHeader);
})();

// The landing notice reads the same server access state as the app. It never
// treats a checkout return URL or browser storage as proof of payment.
(() => {
  const notice = document.getElementById('trial-expired-notice');
  if (!notice || !window.TheibsAuthSession) return;
  let manager = null, checking = false;
  async function updateNotice() {
    if (checking) return;
    checking = true;
    try {
      if (!manager) {
        const response = await fetch('/api/public-config', { cache:'no-store' });
        const data = await response.json();
        if (!response.ok || !data.auth?.required) return;
        const withLock = navigator.locks?.request ? (task, options) => navigator.locks.request(
          'theibs-auth-refresh-v1', { mode:'exclusive', signal:options.signal }, task) : null;
        manager = window.TheibsAuthSession.create({ config:data.auth, fetch:window.fetch.bind(window),
          storage:localStorage, baseUrl:location.href, withLock });
        manager.load();
      }
      if (!manager.hasSession()) { notice.hidden = true; return; }
      const response = await manager.request('/api/access');
      const data = await response.json().catch(() => ({}));
      notice.hidden = !response.ok || data.access?.state !== 'EXPIRED' || data.access?.allowed;
    } catch { notice.hidden = true; }
    finally { checking = false; }
  }
  void updateNotice();
  window.addEventListener('focus', updateNotice);
  window.addEventListener('pageshow', updateNotice);
  window.addEventListener('pagehide', () => manager?.dispose());
})();
