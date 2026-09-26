'use strict';

window.addEventListener('DOMContentLoaded', () => {
  const screen = document.getElementById('login-screen');
  const app = document.getElementById('app-shell');
  const status = document.getElementById('auth-status');
  const open = document.getElementById('open-auth');
  const local = document.getElementById('auth-local');
  const providers = [document.getElementById('auth-google'), document.getElementById('auth-apple')];

  function show() {
    screen.hidden = false;
    app.setAttribute('inert', '');
    document.body.style.overflow = 'hidden';
    local.focus();
  }
  function hide() {
    screen.hidden = true;
    app.removeAttribute('inert');
    document.body.style.overflow = '';
    open.focus();
  }

  open.addEventListener('click', show);
  local.addEventListener('click', hide);
  providers.forEach(button => button.addEventListener('click', () => {
    status.textContent = 'Conecte primeiro um projeto Supabase e configure este provedor.';
  }));
  if (new URLSearchParams(location.search).get('login') === '1') show();
});
