'use strict';

(() => {
  const STORAGE_KEY = 'theibs.auth.session.v1';
  const nativeFetch = window.fetch.bind(window);
  let session = null;
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
    const local = document.getElementById('auth-local');
    const localDivider = document.getElementById('auth-local-divider');
    const google = document.getElementById('auth-google');
    const apple = document.getElementById('auth-apple');
    const subscribe = document.getElementById('auth-subscribe');
    const refresh = document.getElementById('auth-refresh');
    const signout = document.getElementById('auth-signout');
    let config;
    let access = null;

    function show() {
      screen.hidden = false;
      app.setAttribute('inert', '');
      document.body.style.overflow = 'hidden';
      const target = session ? (access?.allowed ? local : (subscribe.hidden ? refresh : subscribe)) : (google.hidden ? apple : google);
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
      const redirectTo = `${location.origin}${location.pathname}`;
      return `${config.supabaseUrl}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${encodeURIComponent(redirectTo)}`;
    }
    function render() {
      const loggedIn = Boolean(session?.access_token);
      google.hidden = loggedIn || !config.providers.google;
      apple.hidden = loggedIn || !config.providers.apple;
      google.disabled = !config.providers.google; apple.disabled = !config.providers.apple;
      local.hidden = config.required && (!access?.allowed || !loggedIn);
      localDivider.hidden = config.required;
      signout.hidden = !loggedIn;
      refresh.hidden = !loggedIn || access?.allowed;
      subscribe.hidden = !loggedIn || !config.billingEnabled || ['LIFETIME', 'ACTIVE'].includes(access?.state);
      heading.textContent = loggedIn ? 'Conta e acesso' : 'Entrar com sua conta';
      if (!config.required) status.textContent = 'Modo local: seus dados ficam neste dispositivo.';
      else if (!loggedIn) status.textContent = 'Entre para continuar.';
      else if (access?.state === 'TRIAL') status.textContent = `${access.user?.email || ''} · ${access.daysRemaining} dia(s) grátis restante(s).`;
      else if (access?.state === 'LIFETIME') status.textContent = `${access.user?.email || ''} · acesso vitalício.`;
      else if (access?.state === 'ACTIVE') status.textContent = `${access.user?.email || ''} · acesso permanente liberado.`;
      else status.textContent = access?.reason || 'Confirme seu acesso para continuar.';
      local.textContent = config.required ? 'Voltar ao THEIBS' : 'Continuar neste dispositivo';
      open.title = access?.state === 'TRIAL' ? `Teste grátis: ${access.daysRemaining} dia(s)` : 'Conta e acesso';
    }
    async function readAccess() {
      await refreshSession(config);
      if (!session) return null;
      const response = await nativeFetch('/api/access', { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (response.status === 401) { saveSession(null); return null; }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.reason || 'Acesso indisponível.');
      return data.access;
    }
    async function checkAndRender() {
      access = await readAccess();
      render();
      if (access?.allowed) { hide(); releaseApp(); }
      else show();
    }

    open.addEventListener('click', () => { render(); show(); });
    local.addEventListener('click', () => { hide(); if (!config.required) releaseApp(); });
    google.addEventListener('click', () => location.assign(providerUrl('google')));
    apple.addEventListener('click', () => location.assign(providerUrl('apple')));
    refresh.addEventListener('click', async () => {
      refresh.disabled = true; status.textContent = 'Confirmando pagamento…';
      try { await checkAndRender(); } catch (error) { status.textContent = error.message; }
      finally { refresh.disabled = false; }
    });
    subscribe.addEventListener('click', async () => {
      subscribe.disabled = true; status.textContent = 'Abrindo pagamento seguro…';
      try {
        const response = await nativeFetch('/api/billing/checkout', { method: 'POST', headers: {
          Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: '{}' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.checkout?.url) throw new Error(data.reason || 'Pagamento indisponível.');
        location.assign(data.checkout.url);
      } catch (error) { status.textContent = error.message; subscribe.disabled = false; }
    });
    signout.addEventListener('click', async () => {
      if (session?.access_token && config?.supabaseUrl) nativeFetch(`${config.supabaseUrl}/auth/v1/logout`, {
        method: 'POST', headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${session.access_token}` }
      }).catch(() => {});
      saveSession(null); access = null; render(); show();
    });

    try {
      const response = await nativeFetch('/api/public-config');
      const payload = await response.json();
      if (!response.ok || !payload.auth) throw new Error(payload.reason || 'Configuração de acesso indisponível.');
      config = payload.auth;
      if (!config.required) {
        access = { allowed: true, state: 'LOCAL' }; render();
        if (new URLSearchParams(location.search).get('login') === '1') show(); else hide();
        releaseApp(); return;
      }
      saveSession(sessionFromHash() || loadSession());
      await checkAndRender();
      if (new URLSearchParams(location.search).get('billing') === 'success' && !access?.allowed) {
        status.textContent = 'Pagamento concluído. Clique em “Atualizar acesso” após a confirmação.';
      }
    } catch (error) {
      config ||= { required: true, providers: {}, billingEnabled: false };
      status.textContent = error.message; render(); show();
    }
  });
})();
