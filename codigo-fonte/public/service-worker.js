'use strict';

const CACHE = 'theibs-shell-v0.14.6-rc.1-analyze';
const SHELL = [
  '/', '/landing.html', '/landing.css', '/landing.js', '/landing-assets/theibs-logo.png', '/landing-assets/osyra-studio.svg',
  '/landing-assets/theibs-app.png', '/landing-assets/theibs-training.png', '/app', '/styles.css', '/dashboard.css', '/multiway.css', '/pwa.js', '/auth-session.js', '/auth-ui.js',
  '/card-model.js', '/essence-ui.js', '/card-keyboard.js', '/dashboard.js',
  '/card-voice.js', '/card-voice-fast.js', '/card-voice-ui.js', '/voice-evaluation.js', '/voice-evaluation-ui.js', '/card-voice.css', '/economic-panel.js', '/economic-panel.css',
  '/focus-ui.js', '/multiway-ui.js', '/analysis-snapshots.js', '/analyze-feedback.js', '/continuation-view.js', '/opponent-inputs.js', '/app.js', '/assistant-ui.js',
  '/manifest.webmanifest', '/icons/theibs.svg', '/icons/theibs-192.png',
  '/icons/theibs-512.png', '/icons/theibs-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('theibs-shell-') && key !== CACHE).map(key => caches.delete(key))
  )));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || caches.match(url.pathname === '/' ? '/' : '/app'))));
});
