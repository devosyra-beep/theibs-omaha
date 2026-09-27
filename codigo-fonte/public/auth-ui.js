'use strict';

(() => {
  const STORAGE_KEY = 'theibs.auth.session.v1';
  const nativeFetch = window.fetch.bind(window);
  let session = null;
  let signedOut = false;
  let resolveReady;
  let readyResolved = false;
  window.theibsAuthReady = new Promise(resolve => { resolveReady = resolve; });

  function releaseApp() {
    if (readyResolved) return;
    readyResolved = true;
    resolveReady();
  }

  function requestUrl(input) {
    try { return new URL(typeof input === 'string' ? input : input.url, location.href); } catch { return null; }
  }

  window.fetch = async (input, init = {}) => {
    const url = requestUrl(input);
    const protectedApi = url?.origin === location.origin && url.pathname.startsWith('/api/') &&
      !['/api/public-config', '/api/status', '/api/billing/webhook'].includes(url.pathname);
    if (!protectedApi) return nativeFetch(input, init);
    await window.theibsAuthReady;
    if (signedOut) throw new Error('You have signed out. Sign in again to continue.');
    const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
    if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);
    return nativeFetch(input, { ...init, headers });
  };

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
  }
  function saveSession(value) {
    session = value;
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  }

  function sessionFromHash() {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (hash.get('error_description')) throw new Error(hash.get('error_description'));
    if (!hash.get('access_token')) return null;
    const expiresIn = Number(hash.get('expires_in') || 3600);
    const value = { access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token'),
      expires_at: Date.now() + expiresIn * 1000 };
    history.replaceState({}, document.title, location.pathname + location.search);
    return value;
  }

  async function refreshSession(config) {
    if (!session?.refresh_token || (Number(session.expires_at) - Date.now()) > 60000) return session;
    const response = await nativeFetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: { apikey: config.supabasePublishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) { saveSession(null); return null; }
    saveSession({ access_token: data.access_token, refresh_token: data.refresh_token || session.refresh_token,
      expires_at: Date.now() + Number(data.expires_in || 3600) * 1000 });
    return session;
  }

  window.addEventListener('DOMContentLoaded', async () => {
    const screen = document.getElementById('login-screen');
    const app = document.getElementById('app-shell');
    const status = document.getElementById('auth-status');
    const heading = document.getElementById('auth-heading');
    const open = document.getElementById('open-auth');
    const google = document.getElementById('auth-google');
    const close = document.getElementById('auth-close');
    const subscribe = document.getElementById('auth-subscribe');
    const refresh = document.getElementById('auth-refresh');
    const signout = document.getElementById('auth-signout');
    const headerSignout = document.getElementById('header-signout');
    let config;
    let access = null;

    function show() {
      screen.hidden = false;
      app.setAttribute('inert', '');
      document.body.style.overflow = 'hidden';
      const target = session ? (access?.allowed ? close : (subscribe.hidden ? refresh : subscribe)) : google;
      if (!target.hidden) target.focus();
    }
    function hide() {
      if (config?.required && !access?.allowed) return;
      screen.hidden = true;
      app.removeAttribute('inert');
      document.body.style.overflow = '';
      open.focus();
    }
    function providerUrl(provider) {
      const redirectTo = `${location.origin}/app`;
      return `${config.supabaseUrl}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${encodeURIComponent(redirectTo)}`;
    }
    function render() {
      const loggedIn = Boolean(session?.access_token);
      google.hidden = loggedIn || !config.providers.google;
      google.disabled = !config.providers.google;
      close.hidden = !loggedIn || !access?.allowed;
      signout.hidden = !loggedIn;
      headerSignout.hidden = false;
      headerSignout.title = config.required ? 'Sign out of this device' : 'Leave the local lab';
      refresh.hidden = !loggedIn || access?.allowed;
      subscribe.hidden = !loggedIn || !config.billingEnabled || ['LIFETIME', 'ACTIVE'].includes(access?.state);
      heading.textContent = loggedIn ? 'Account & access' : 'Sign in to your account';
      if (!config.required) status.textContent = 'Local mode: your data stays on this device.';
      else if (!loggedIn && !config.providers.google) status.textContent = 'Google sign-in is not configured yet.';
      else if (!loggedIn) status.textContent = 'Sign in with Google to continue.';
      else if (access?.state === 'TRIAL') status.textContent = `${access.user?.email || ''} · ${access.daysRemaining} free day(s) remaining.`;
      else if (access?.state === 'LIFETIME') status.textContent = `${access.user?.email || ''} · lifetime access.`;
      else if (access?.state === 'ACTIVE') status.textContent = `${access.user?.email || ''} · permanent access enabled.`;
      else status.textContent = access?.reason || 'Confirm your access to continue.';
      open.title = access?.state === 'TRIAL' ? `Free trial: ${access.daysRemaining} day(s)` : 'Account & access';
    }
    async function readAccess() {
      await refreshSession(config);
      if (!session) return null;
      const response = await nativeFetch('/api/access', { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (response.status === 401) { saveSession(null); return null; }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.reason || 'Access unavailable.');
      return data.access;
    }
    async function checkAndRender() {
      access = await readAccess();
      render();
      if (access?.allowed) { hide(); releaseApp(); }
      else show();
    }

    open.addEventListener('click', () => { render(); show(); });
    close.addEventListener('click', hide);
    google.addEventListener('click', () => location.assign(providerUrl('google')));
    refresh.addEventListener('click', async () => {
      refresh.disabled = true; status.textContent = 'Confirming payment…';
      try { await checkAndRender(); } catch (error) { status.textContent = error.message; }
      finally { refresh.disabled = false; }
    });
    subscribe.addEventListener('click', async () => {
      subscribe.disabled = true; status.textContent = 'Opening secure checkout…';
      try {
        const response = await nativeFetch('/api/billing/checkout', { method: 'POST', headers: {
          Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: '{}' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.checkout?.url) throw new Error(data.reason || 'Payment unavailable.');
        location.assign(data.checkout.url);
      } catch (error) { status.textContent = error.message; subscribe.disabled = false; }
    });
    async function signOut() {
      if (signedOut) return;
      signedOut = true;
      const token = session?.access_token;
      saveSession(null); access = null;
      signout.disabled = true; headerSignout.disabled = true;
      app.setAttribute('inert', '');
      status.textContent = 'Signing out…';
      try {
        if (token && config?.supabaseUrl) await nativeFetch(`${config.supabaseUrl}/auth/v1/logout?scope=local`, {
          method: 'POST', headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5000)
        });
      } catch { /* Local credentials are already cleared, including when offline. */ }
      finally {
        saveSession(null);
        location.replace(config?.required ? '/app?login=1' : '/');
      }
    }
    signout.addEventListener('click', signOut);
    headerSignout.addEventListener('click', signOut);

    try {
      const response = await nativeFetch('/api/public-config');
      const payload = await response.json();
      if (!response.ok || !payload.auth) throw new Error(payload.reason || 'Access configuration unavailable.');
      config = payload.auth;
      if (!config.required) {
        access = { allowed: true, state: 'LOCAL' }; render();
        open.hidden = true;
        hide();
        releaseApp(); return;
      }
      open.hidden = false;
      saveSession(sessionFromHash() || loadSession());
      await checkAndRender();
      if (new URLSearchParams(location.search).get('login') === '1' && access?.allowed) show();
      if (new URLSearchParams(location.search).get('billing') === 'success' && !access?.allowed) {
        status.textContent = 'Payment complete. Click “Refresh access” after confirmation.';
      }
    } catch (error) {
      config ||= { required: true, providers: {}, billingEnabled: false };
      status.textContent = error.message; render(); show();
    }
  });
})();
