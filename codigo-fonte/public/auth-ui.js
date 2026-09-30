'use strict';

(() => {
  const STORAGE_KEY = 'theibs.auth.session.v1';
  const CHECKOUT_INTENT_KEY = 'theibs.billing.intent.v1';
  const nativeFetch = window.fetch.bind(window);
  let manager = null, resolveReady, resolveConfig, readyResolved = false;
  window.theibsAuthReady = new Promise(resolve => { resolveReady = resolve; });
  const configReady = new Promise(resolve => { resolveConfig = resolve; });
  // Advisory cancellation only. The server remains the authority for access.
  window.theibsVoiceSessionContext = () => manager?.context() || { epoch: 0, required: true, expired: true };
  window.theibsAuth = { async ensureSession() {
    await configReady;
    if (!manager) throw new Error('Access configuration is unavailable. Reload the page.');
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
    if (!manager) throw new Error('Access configuration is unavailable. Reload the page.');
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
    if (hash.has('error') || hash.has('error_description')) throw new Error('Sign-in failed. Try again.');
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
    const billingDialog = document.getElementById('billing-dialog');
    const billing = id => document.getElementById(`billing-${id}`);
    let config, access = null, authFailure = null, signingOut = false;
    let offer = null, order = null, billingBusy = false, billingOpening = false, billingTrigger = null, billingPoll = null, billingPolls = 0;
    const loggedIn = () => manager?.hasSession() || false;
    const purchased = () => ['LIFETIME', 'ACTIVE'].includes(access?.state) && access?.allowed;
    const priceLabel = value => Number.isSafeInteger(value) && value >= 0
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'BRL' }).format(value / 100) : '—';
    const hasOffer = () => offer && Number.isSafeInteger(offer.priceCents) && offer.priceCents > 0 && offer.currency === 'BRL' && !!offer.accessLabel;
    const allowedMethods = () => hasOffer() ? (Array.isArray(offer.methods) ? offer.methods.filter(method => ['PIX', 'CARD'].includes(method)) : []) : [];
    const pendingOrder = () => ['PENDING', 'CREATING'].includes(order?.status);
    const safeCardUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'abacatepay.com' || url.hostname.endsWith('.abacatepay.com')) && !url.username && !url.password ? url.href : null; } catch { return null; } };
    function billingMessage(message, error = false) { billing('message').textContent = message; billing('message').dataset.error = String(error); }
    function clearBillingPoll() { if (billingPoll) clearTimeout(billingPoll); billingPoll = null; }
    function scheduleBillingPoll() {
      clearBillingPoll();
      if (!(pendingOrder() || (order?.status === 'PAID' && !purchased())) || billingPolls >= 12 || document.hidden) return;
      billingPoll = setTimeout(() => { billingPoll = null; billingPolls++; void refreshBilling(true); }, billingDialog.open ? 15000 : 30000);
    }
    function accessText() {
      if (access?.state === 'LIFETIME' || access?.state === 'ACTIVE') return ['Paid access', 'Your access is active.', 'good'];
      if (access?.state === 'TRIAL') return ['Free trial', `${access.daysRemaining} day(s) remaining in your free trial.`, 'warn'];
      if (access?.state === 'EXPIRED') return ['Trial ended', 'Your free trial has ended. Sign-in remains available while you review payment.', 'warn'];
      return ['Checking', access?.reason || 'Checking your account access…', ''];
    }
    function renderBilling() {
      const [label, detail, tone] = accessText();
      billing('email').textContent = access?.user?.email || 'Your account';
      billing('access-badge').textContent = label; billing('access-badge').dataset.tone = tone;
      billing('access-detail').textContent = detail;
      billing('offer').hidden = purchased() || !hasOffer();
      if (hasOffer()) {
        billing('price').textContent = priceLabel(offer.priceCents);
        billing('term').textContent = `${offer.accessLabel}. ${offer.renewal ? 'Renewal terms apply.' : 'One-time payment. No recurring charges.'}`;
      }
      const methods = allowedMethods(), orderActive = pendingOrder() && !purchased();
      const orderBlocksNew = orderActive || order?.status === 'PAID';
      billing('method-section').hidden = purchased() || orderBlocksNew || !methods.length;
      const methodList = billing('methods'); methodList.replaceChildren();
      if (!billing('method-section').hidden) for (const method of methods) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.method = method;
        const name = document.createElement('strong'), hint = document.createElement('span');
        name.textContent = method === 'PIX' ? 'Pix' : 'Card';
        hint.textContent = method === 'PIX' ? 'QR code or copy and paste in this panel' : 'Secure checkout hosted by AbacatePay';
        button.append(name, hint); button.disabled = billingBusy; methodList.append(button);
      }
      billing('unavailable').hidden = purchased() || methods.length > 0 || orderBlocksNew;
      billing('order').hidden = !order || purchased();
      if (!billing('order').hidden) {
        const labels = { PENDING:'Pending', CREATING:'Preparing', PAID:'Received', EXPIRED:'Expired', CANCELLED:'Cancelled', REFUNDED:'Refunded', DISPUTED:'Disputed', FAILED:'Failed' };
        billing('order-badge').textContent = labels[order.status] || 'Checking';
        billing('order-badge').dataset.tone = order.status === 'PAID' ? 'good' : pendingOrder() ? 'warn' : '';
        billing('order-detail').textContent = order.status === 'PAID'
          ? 'Payment was reported. Access changes only after the server verifies and confirms it.'
          : order.status === 'CREATING' && order.recoveryNeeded
            ? `Payment setup needs manual review. Do not start another payment. Keep order reference ${order.id || 'shown in your account'} until this can be resolved.`
          : pendingOrder() ? 'Your payment is awaiting confirmation. You can close this panel and return later.'
          : 'This payment is no longer active. Select an available method to start a new one.';
        const pix = order.method === 'PIX' && orderActive && typeof order.pix?.brCode === 'string' && order.pix.brCode.length > 0;
        billing('pix').hidden = !pix;
        if (pix) {
          billing('pix-code').value = order.pix.brCode;
          const qr = order.pix.brCodeBase64;
          billing('pix-qr').hidden = typeof qr !== 'string' || !/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(qr);
          if (!billing('pix-qr').hidden) billing('pix-qr').src = qr;
          const expiry = order.expiresAt ? new Date(order.expiresAt) : null;
          billing('pix-expiry').textContent = expiry && Number.isFinite(expiry.getTime()) ? `Expires ${new Intl.DateTimeFormat('en-US', { dateStyle:'medium', timeStyle:'short' }).format(expiry)}.` : '';
        } else billing('pix-qr').removeAttribute('src');
        billing('card-pay').hidden = !(order.method === 'CARD' && orderActive && safeCardUrl(order.url));
      }
      billing('refresh').disabled = billingBusy;
      billing('signout').hidden = !loggedIn();
      scheduleBillingPoll();
    }
    async function billingRequest(path, options) {
      const before = manager.context();
      const response = await manager.request(path, options);
      const data = await response.json().catch(() => ({}));
      assertCurrent(before);
      if (!response.ok) throw new Error(data.reason || 'Payment information is unavailable. Try again.');
      return data;
    }
    async function refreshBilling(silent = false) {
      if (!loggedIn() || billingBusy) return;
      billingBusy = true; renderBilling();
      if (!silent) billingMessage('Checking your account and payment status…');
      try {
        access = await readAccess(); authFailure = null; render();
        if (access?.allowed) { hide(); releaseApp(); } else show();
        if (!purchased()) {
          const [offerData, orderData] = await Promise.all([
            billingRequest('/api/billing/offer'), billingRequest('/api/billing/order')
          ]);
          offer = offerData.offer || null; order = orderData.order || null;
          if (orderData.access) access = orderData.access;
        } else { offer = null; order = null; }
        render();
        if (access?.allowed) { hide(); releaseApp(); } else show();
        if (purchased()) billingMessage('Your paid access is active.');
        else if (pendingOrder()) billingMessage('Payment confirmation is pending. This status refreshes while the panel is open.');
        else if (!allowedMethods().length) billingMessage('Payments are not available yet. Your account remains accessible.');
        else billingMessage('Choose a method only when you are ready to pay.');
      } catch (error) {
        offer = null; order = null;
        billingMessage(error.message || 'Could not refresh payment status. Payment methods are unavailable until this check succeeds.', true);
      }
      finally { billingBusy = false; renderBilling(); }
    }
    function closeBilling() {
      if (billingDialog.open) billingDialog.close();
    }
    async function openBilling(trigger = document.activeElement) {
      if (!loggedIn()) { show(); return; }
      if (billingOpening) return;
      billingOpening = true;
      try {
        // A voice action already sent to the server must finish before the
        // payment modal becomes visible. Opening it then pauses future speech.
        for (let attempt = 0; window.theibsCardVoice?.getStatus?.().committing && attempt < 100; attempt++)
          await new Promise(resolve => setTimeout(resolve, 100));
        if (window.theibsCardVoice?.getStatus?.().committing) {
          const toast = document.getElementById('toast');
          const message = 'Wait for the current voice entry to finish, then open Account.';
          toast.textContent = message; toast.classList.remove('hidden');
          setTimeout(() => { if (toast.textContent === message) toast.classList.add('hidden'); }, 4000);
          return;
        }
        if (!loggedIn()) { show(); return; }
      billingTrigger = trigger instanceof HTMLElement ? trigger : null;
      if (!billingDialog.open) {
        billingDialog.showModal();
        document.dispatchEvent(new Event('theibs:billing-modal-open'));
        billing('close').focus();
      }
      billingMessage('Checking your account and payment status…');
      void refreshBilling();
      } finally { billingOpening = false; }
    }
    function consumeCheckoutIntent() {
      const url = new URL(location.href), explicit = url.searchParams.get('intent') === 'checkout';
      const returned = url.searchParams.has('billing');
      let stored = false;
      try { stored = sessionStorage.getItem(CHECKOUT_INTENT_KEY) === 'checkout'; sessionStorage.removeItem(CHECKOUT_INTENT_KEY); } catch {}
      if (explicit || returned) {
        url.searchParams.delete('intent'); url.searchParams.delete('billing');
        history.replaceState({}, document.title, url.pathname + url.search + url.hash);
      }
      return explicit || returned || stored;
    }
    function show() {
      screen.hidden = false; app.hidden = true; app.setAttribute('inert', ''); document.body.style.overflow = 'hidden';
      const target = loggedIn() ? (access?.allowed ? close : (subscribe.hidden ? refresh : subscribe)) : google;
      if (!billingDialog.open && !target.hidden) target.focus();
    }
    function hide() {
      if (config?.required && (!access?.allowed || manager.context().expired)) return;
      screen.hidden = true; app.hidden = false; app.removeAttribute('inert'); document.body.style.overflow = '';
      if (!billingDialog.open) open.focus();
    }
    function render() {
      const signedIn = loggedIn();
      google.hidden = signedIn || !config.providers?.google; google.disabled = !config.providers?.google;
      close.hidden = !signedIn || !access?.allowed; signout.hidden = !signedIn; headerSignout.hidden = false;
      headerSignout.title = config.required ? 'Sign out of this device' : 'Leave the QA session';
      refresh.hidden = !signedIn || access?.allowed;
      subscribe.hidden = !signedIn || purchased();
      subscribe.textContent = config.billingEnabled ? 'Review payment options' : 'View account & access';
      heading.textContent = access?.state === 'EXPIRED' ? 'Your free trial has ended' : signedIn ? 'Account & access' : 'Sign in to your account';
      if (authFailure) status.textContent = authFailure;
      else if (!config.required) status.textContent = 'QA session: authentication is disabled in this environment.';
      else if (!signedIn && !config.providers?.google) status.textContent = 'Google sign-in is not configured yet.';
      else if (!signedIn) status.textContent = 'Sign in with Google to continue.';
      else if (access?.state === 'TRIAL') status.textContent = `${access.user?.email || ''} · ${access.daysRemaining} free day(s) remaining.`;
      else if (access?.state === 'LIFETIME') status.textContent = `${access.user?.email || ''} · lifetime access.`;
      else if (access?.state === 'ACTIVE') status.textContent = `${access.user?.email || ''} · permanent access enabled.`;
      else status.textContent = access?.reason || 'Confirm your access to continue.';
      open.title = access?.state === 'TRIAL' ? `Free trial: ${access.daysRemaining} day(s)` : 'Account & access';
      if (billingDialog.open) renderBilling();
    }
    function onSessionChange(event) {
      // A refresh of this same login does not cancel speech or current work.
      if (event.reason === 'TOKEN_REFRESHED') return;
      document.dispatchEvent(new CustomEvent('theibs:voice-session-changed', { detail: { reason: event.reason } }));
      if (event.invalid) {
        access = null;
        closeBilling(); offer = null; order = null;
        authFailure = event.reason === 'SIGNED_OUT' ? 'Signing out…' : event.reason === 'AUTH_SESSION_CHANGED' ?
          'Your session changed. Reload and sign in again before continuing.' :
          'Your session expired or could not be renewed. Sign in again to continue.';
        render(); show();
      }
    }
    function assertCurrent(before) {
      const after = manager.context();
      if (before.epoch !== after.epoch || after.expired) throw new Error('Your session changed. Sign in again before continuing.');
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
    open.addEventListener('click', () => openBilling(open));
    close.addEventListener('click', hide);
    google.addEventListener('click', () => {
      if (new URLSearchParams(location.search).get('intent') === 'checkout') {
        try { sessionStorage.setItem(CHECKOUT_INTENT_KEY, 'checkout'); } catch {}
      }
      location.assign(`${config.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(`${location.origin}/app`)}`);
    });
    refresh.addEventListener('click', async () => {
      refresh.disabled = true; status.textContent = 'Checking access…';
      try { await checkAndRender(); } catch (error) { status.textContent = error.message; }
      finally { refresh.disabled = false; }
    });
    subscribe.addEventListener('click', () => openBilling(subscribe));
    billing('close').addEventListener('click', closeBilling);
    billingDialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...billingDialog.querySelectorAll('button,a[href],textarea,input,[tabindex]:not([tabindex="-1"])')]
        .filter(node => !node.disabled && node.getClientRects().length > 0);
      if (!controls.length) return;
      const first = controls[0], last = controls.at(-1), focused = document.activeElement;
      if (event.shiftKey && (focused === first || !billingDialog.contains(focused))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (focused === last || !billingDialog.contains(focused))) {
        event.preventDefault(); first.focus();
      }
    });
    billingDialog.addEventListener('cancel', event => { event.preventDefault(); closeBilling(); });
    billingDialog.addEventListener('close', () => {
      scheduleBillingPoll();
      document.dispatchEvent(new Event('theibs:billing-modal-close'));
      const target = billingTrigger?.isConnected && !billingTrigger.hidden && !billingTrigger.closest('[hidden]')
        ? billingTrigger : (screen.hidden ? open : (subscribe.hidden ? refresh : subscribe));
      if (target && !target.hidden) target.focus();
    });
    billing('methods').addEventListener('click', async event => {
      const button = event.target.closest('button[data-method]');
      if (!button || billingBusy || purchased() || pendingOrder() || !allowedMethods().includes(button.dataset.method)) return;
      billingBusy = true; renderBilling(); billingMessage('Preparing your payment…');
      try {
        const data = await billingRequest('/api/billing/checkout', {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({method:button.dataset.method})
        });
        if (!data.order) throw new Error('Payment details are not ready. Refresh and try again.');
        order = data.order; if (data.access) access = data.access;
        billingPolls = 0; billingMessage(order.method === 'PIX' ? 'Use the Pix code below. Access activates after verified payment.' : 'Review the price, then continue to the provider checkout.');
      } catch (error) {
        offer = null; order = null;
        billingMessage(`${error.message || 'Could not prepare the payment.'} Refresh status before trying again; a charge may already be pending.`, true);
      }
      finally { billingBusy = false; renderBilling(); }
    });
    billing('card-pay').addEventListener('click', () => {
      const url = safeCardUrl(order?.url);
      if (!url || order?.method !== 'CARD' || !pendingOrder()) return;
      try { sessionStorage.setItem(CHECKOUT_INTENT_KEY, 'checkout'); } catch {}
      location.assign(url);
    });
    billing('pix-copy').addEventListener('click', async () => {
      if (!order?.pix?.brCode) return;
      try { await navigator.clipboard.writeText(order.pix.brCode); billingMessage('Pix code copied.'); }
      catch { billing('pix-code').focus(); billing('pix-code').select(); billingMessage('Select and copy the Pix code from the field.'); }
    });
    billing('refresh').addEventListener('click', () => { billingPolls = 0; void refreshBilling(); });
    billing('signout').addEventListener('click', signOut);
    const updateVisibleBilling = () => {
      if (!billingBusy && (billingDialog.open || pendingOrder() || (order?.status === 'PAID' && !purchased()))) void refreshBilling(true);
    };
    window.addEventListener('focus', updateVisibleBilling);
    window.addEventListener('pageshow', updateVisibleBilling);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) updateVisibleBilling(); });
    async function signOut() {
      if (signingOut) return; signingOut = true; access = null;
      signout.disabled = true; headerSignout.disabled = true;
      closeBilling();
      const pending = manager?.signOut(); show(); status.textContent = 'Signing out…';
      try { await pending; } finally { location.replace(config?.required ? '/app?login=1' : '/'); }
    }
    signout.addEventListener('click', signOut); headerSignout.addEventListener('click', signOut);
    try {
      const response = await nativeFetch('/api/public-config'), payload = await response.json();
      if (!response.ok || !payload.auth) throw new Error('Access configuration unavailable.');
      config = payload.auth;
      if (!window.TheibsAuthSession) throw new Error('Reload the page to update access.');
      // A browser lock serializes rotation across tabs. The controller still
      // has a bounded provider timeout and coalesces callers within this tab.
      const withLock = window.navigator?.locks?.request ? (task, options) => window.navigator.locks.request(
        'theibs-auth-refresh-v1', { mode: 'exclusive', signal: options.signal }, task) : null;
      manager = window.TheibsAuthSession.create({ config, fetch: nativeFetch, storage: localStorage, baseUrl: location.href, onChange: onSessionChange, withLock });
      resolveConfig(); manager.load(sessionFromHash());
      if (!config.required) { access = { allowed: true, state: 'LOCAL' }; render(); open.hidden = true; hide(); releaseApp(); return; }
      open.hidden = false; await checkAndRender();
      if (loggedIn() && consumeCheckoutIntent()) openBilling(screen.hidden ? open : subscribe);
    } catch (error) {
      resolveConfig(); config ||= { required: true, providers: {}, billingEnabled: false };
      render(); status.textContent = error.message; show();
    }
  });
})();
