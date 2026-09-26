'use strict';

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {
      // O motor continua funcionando se o navegador bloquear a instalação PWA.
    });
  }, { once: true });
}
