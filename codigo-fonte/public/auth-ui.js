'use strict';

(() => {
  const STORAGE_KEY = 'theibs.auth.session.v1';
  const nativeFetch = window.fetch.bind(window);
  let manager = null, resolveReady, resolveConfig, readyResolved = false;
  window.theibsAuthReady = new Promise(resolve => { resolveReady = resolve; });
  const configReady = new Promise(resolve => { resolveConfig = resolve; });
  // Advisory cancellation only. The server remains the authority for access.
  window.theibsVoiceSessionContext = () => manager?.context() || { epoch: 0, required: true, expired: true };
  window.theibsAuth = { async ensureSession() {
    await configReady;
    if (!manager) throw new Error('A configuração de acesso está indisponível. Recarregue a página.');
    return manager.ensureSession();
  } };
  function releaseApp() { if (!readyResolved) { readyResolved = true; resolveReady(); } }
  function requestUrl(input) { try { return new URL(typeof input === 'string' ? input : input.url, location.href); } catch { return null; } }
  window.fetch = async (input, init = {}) => {
    const url = requestUrl(input);
    const protectedApi = url?.origin === location.origin && url.pathname.startsWith('/api/') &&
      !['/api/public-config', '/api/status', '/api/billing/webhook'].includes(url.pathname);
    if (!protectedApi) return nativeFetch(input, init);
    await window.theibsAuthReady;
    if (!manager) throw new Error('A configuração de acesso está indisponível. Recarregue a página.');
    return manager.request(input, init);
  };
  window.addEventListener('storage', event => { if (event.key === STORAGE_KEY || event.key === null) manager?.handleStorage(); });
  const resume = () => manager?.ensureSession().catch(() => {});
  window.addEventListener('focus', resume);
  window.addEventListener('pageshow', resume);
  document.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'visible') resume(); });

  function sessionFromHash() {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (!hash.has('access_token') && !hash.has('error') && !hash.has('error_description')) return undefined;
    history.replaceState({}, document.title, location.pathname + location.search);
    if (hash.has('error') || hash.has('error_description')) throw new Error('Não foi possível entrar. Tente novamente.');
    return { access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token'),
      expires_at: Date.now() + Number(hash.get('expires_in') || 3600) * 1000 };
  }

  window.addEventListener('DOMContentLoaded', async () => {
    const screen = document.getElementById('login-screen'), app = document.getElementById('app-shell');
    const status = document.getElementById('auth-status'), heading = document.getElementById('auth-heading');
    const open = document.getElementById('open-auth'), google = document.getElementById('auth-google');
    const close = document.getElementById('auth-close'), subscribe = document.getElementById('auth-subscribe');
    const refresh = document.getElementById('auth-refresh'), signout = document.getElementById('auth-signout');
    const headerSignout = document.getElementById('header-signout');
    let config, access = null, authFailure = null, signingOut = false;
    const loggedIn = () => manager?.hasSession() || false;
    function show() {
      screen.hidden = false; app.hidden = true; app.setAttribute('inert', ''); document.body.style.overflow = 'hidden';
      const target = loggedIn() ? (access?.allowed ? close : (subscribe.hidden ? refresh : subscribe)) : google;
      if (!target.hidden) target.focus();
    }
    function hide() {
      if (config?.required && (!access?.allowed || manager.context().expired)) return;
      screen.hidden = true; app.hidden = false; app.removeAttribute('inert'); document.body.style.overflow = ''; open.focus();
    }
    function render() {
      const signedIn = loggedIn();
      google.hidden = signedIn || !config.providers?.google; google.disabled = !config.providers?.google;
      close.hidden = !signedIn || !access?.allowed; signout.hidden = !signedIn; headerSignout.hidden = false;
      headerSignout.title = config.required ? 'Sign out of this device' : 'Leave the QA session';
      refresh.hidden = !signedIn || access?.allowed;
      subscribe.hidden = !signedIn || !config.billingEnabled || ['LIFETIME', 'ACTIVE'].includes(access?.state);
      heading.textContent = signedIn ? 'Account & access' : 'Sign in to your account';
      if (authFailure) status.textContent = authFailure;
      else if (!config.required) status.textContent = 'QA session: authentication is disabled in this environment.';
      else if (!signedIn && !config.providers?.google) status.textContent = 'Google sign-in is not configured yet.';
      else if (!signedIn) status.textContent = 'Sign in with Google to continue.';
      else if (access?.state === 'TRIAL') status.textContent = `${access.user?.email || ''} · ${access.daysRemaining} free day(s) remaining.`;
      else if (access?.state === 'LIFETIME') status.textContent = `${access.user?.email || ''} · lifetime access.`;
      else if (access?.state === 'ACTIVE') status.textContent = `${access.user?.email || ''} · permanent access enabled.`;
      else status.textContent = access?.reason || 'Confirm your access to continue.';
      open.title = access?.state === 'TRIAL' ? `Free trial: ${access.daysRemaining} day(s)` : 'Account & access';
    }
    function onSessionChange(event) {
      // A refresh of this same login does not cancel speech or current work.
      if (event.reason === 'TOKEN_REFRESHED') return;
      document.dispatchEvent(new CustomEvent('theibs:voice-session-changed', { detail: { reason: event.reason } }));
      if (event.invalid) {
        access = null;
        authFailure = event.reason === 'SIGNED_OUT' ? 'Signing out…' : event.reason === 'AUTH_SESSION_CHANGED' ?
          'A sessão mudou. Recarregue e entre novamente antes de continuar.' :
          'Sua sessão expirou ou não pôde ser renovada. Entre novamente para continuar.';
        render(); show();
      }
    }
    function assertCurrent(before) {
      const after = manager.context();
      if (before.epoch !== after.epoch || after.expired) throw new Error('A sessão mudou. Entre novamente antes de continuar.');
    }
    async function readAccess() {
      if (!loggedIn()) return null;
      await manager.ensureSession();
      const before = manager.context(), response = await manager.request('/api/access');
      const data = await response.json().catch(() => ({}));
      assertCurrent(before);
      if (!response.ok) throw new Error('Access unavailable. Try again.');
      return data.access;
    }
    async function checkAndRender() {
      const result = await readAccess();
      access = result; authFailure = null; render();
      if (access?.allowed) { hide(); releaseApp(); } else show();
    }
    open.addEventListener('click', () => { render(); show(); });
    close.addEventListener('click', hide);
    google.addEventListener('click', () => location.assign(`${config.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(`${location.origin}/app`)}`));
    refresh.addEventListener('click', async () => {
      refresh.disabled = true; status.textContent = 'Checking access…';
      try { await checkAndRender(); } catch (error) { status.textContent = error.message; }
      finally { refresh.disabled = false; }
    });
    subscribe.addEventListener('click', async () => {
      subscribe.disabled = true; status.textContent = 'Opening secure checkout…';
      try {
        await manager.ensureSession(); const before = manager.context();
        const response = await manager.request('/api/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await response.json().catch(() => ({})); assertCurrent(before);
        if (!response.ok || !data.checkout?.url) throw new Error('Payment unavailable. Try again.');
        location.assign(data.checkout.url);
      } catch (error) { status.textContent = error.message; subscribe.disabled = false; }
    });
    async function signOut() {
      if (signingOut) return; signingOut = true; access = null;
      signout.disabled = true; headerSignout.disabled = true;
      const pending = manager?.signOut(); show(); status.textContent = 'Signing out…';
      try { await pending; } finally { location.replace(config?.required ? '/app?login=1' : '/'); }
    }
    signout.addEventListener('click', signOut); headerSignout.addEventListener('click', signOut);
    try {
      const response = await nativeFetch('/api/public-config'), payload = await response.json();
      if (!response.ok || !payload.auth) throw new Error('Access configuration unavailable.');
      config = payload.auth;
      if (!window.TheibsAuthSession) throw new Error('Recarregue a página para atualizar o acesso.');
      // A browser lock serializes rotation across tabs. The controller still
      // has a bounded provider timeout and coalesces callers within this tab.
      const withLock = window.navigator?.locks?.request ? (task, options) => window.navigator.locks.request(
        'theibs-auth-refresh-v1', { mode: 'exclusive', signal: options.signal }, task) : null;
      manager = window.TheibsAuthSession.create({ config, fetch: nativeFetch, storage: localStorage, baseUrl: location.href, onChange: onSessionChange, withLock });
      resolveConfig(); manager.load(sessionFromHash());
      if (!config.required) { access = { allowed: true, state: 'LOCAL' }; render(); open.hidden = true; hide(); releaseApp(); return; }
      open.hidden = false; await checkAndRender();
      if (new URLSearchParams(location.search).get('login') === '1' && access?.allowed) show();
      if (new URLSearchParams(location.search).get('billing') === 'success' && !access?.allowed) status.textContent = 'Payment complete. Click “Refresh access” after confirmation.';
    } catch (error) {
      resolveConfig(); config ||= { required: true, providers: {}, billingEnabled: false };
      render(); status.textContent = error.message; show();
    }
  });
})();
