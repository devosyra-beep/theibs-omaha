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
