/*
 * AutoLog — service worker.
 * App shell: stale-while-revalidate. Chiamate api/: sempre in rete.
 * Bumpare CACHE_VERSION a ogni release.
 */
'use strict';

var CACHE_VERSION = 'autolog-v7';

/* Percorsi relativi allo scope: funzionano anche sotto l'Ingress di HA. */
var SHELL = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'charts.js',
  'calc.js',
  'i18n.js',
  'units.js',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return Promise.allSettled(SHELL.map(function (u) { return cache.add(u); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE_VERSION ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  /* Le API non vanno mai in cache: meglio un errore che dati stantii. */
  if (/(^|\/)api\//.test(url.pathname)) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.match(req).then(function (cached) {
        var network = fetch(req).then(function (res) {
          if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
          return res;
        }).catch(function () { return cached; });
        return cached || network;
      });
    })
  );
});
