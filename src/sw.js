/* Gulf service worker. It keeps the page, its fonts and its data files on the device, so the page opens
   without a connection, as on the boat.

   The page comes from the network first, so a new version shows as soon as there is a connection. The
   stored copy serves when the network fails, or when it has not answered after 4 seconds. Fonts and data
   files come from the stored copy first. Forecasts do not pass through here: the page keeps them in
   localStorage.

   build.mjs fills in VERSION, a hash of the page and of this file, so every new build installs a new worker.
   It also fills in DATA_FILES, the names of the data files beside the page, such as the depth grid. Each name
   holds a hash of the file's content, so a stored copy never needs checking against the network. */

var VERSION = '__VERSION__';
var FONT_CSS = '__FONT_CSS__';
var DATA_FILES = '__DATA_FILES__';
var PAGE = 'gulf-almanac-page-' + VERSION, FONTS = 'gulf-almanac-fonts', DATA = 'gulf-almanac-data';
var WAIT_MS = 4000;

/* The font files for Latin text. Other scripts' files are stored when a page first uses them. */
var SUBSETS = ['latin', 'latin-ext'];

self.addEventListener('install', function (e) {
  e.waitUntil(Promise.all([
    caches.open(PAGE).then(function (c) { return c.add(new Request('./', { cache: 'reload' })); }),
    storeFonts().catch(function () { /* the fonts are stored on their first use instead */ }),
    storeData().catch(function () { /* the data files are stored on their first use instead */ })
  ]).then(function () { return self.skipWaiting(); }));
});

/* The data files the current build lists, each fetched unless a copy is already stored. */
function storeData() {
  return caches.open(DATA).then(function (c) {
    return Promise.all(DATA_FILES.map(function (f) {
      return c.match(f).then(function (hit) { return hit || c.add(new Request(f, { cache: 'reload' })); });
    }));
  });
}

/* The font stylesheet lists one file per script. Its comments name each script: a comment such as
   "latin" stands before the @font-face rule for that script. */
function storeFonts() {
  return caches.open(FONTS).then(function (c) {
    return fetch(FONT_CSS, { mode: 'cors' }).then(function (r) {
      if (!r.ok) throw new Error('font stylesheet ' + r.status);
      return r.clone().text().then(function (css) {
        var urls = [];
        css.split('/*').forEach(function (part) {
          var end = part.indexOf('*/');
          if (end < 0 || SUBSETS.indexOf(part.slice(0, end).trim()) < 0) return;
          var m = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(part);
          if (m && urls.indexOf(m[1]) < 0) urls.push(m[1]);
        });
        return c.put(FONT_CSS, r).then(function () {
          return Promise.all(urls.map(function (u) { return c.add(new Request(u, { mode: 'cors' })); }));
        });
      });
    });
  });
}

/* A new worker removes the copies of the page that earlier versions stored, and every stored data file
   that the current build does not list. */
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) {
      if (k.indexOf('gulf-almanac-page-') === 0 && k !== PAGE) return caches.delete(k);
      return null;
    }));
  }).then(function () {
    return caches.open(DATA).then(function (c) {
      return c.keys().then(function (reqs) {
        return Promise.all(reqs.map(function (r) { return dataName(new URL(r.url)) ? null : c.delete(r); }));
      });
    });
  }).then(function () { return self.clients.claim(); }));
});

/* The page and the data files the build lists are stored and served from the store. Any other file opened
   on its own, such as an icon or the manifest, passes through, so it can never take the page's place in the
   store. */
var SCOPE = new URL(self.registration.scope).pathname;
function isPage(url) { return url.origin === self.location.origin && (url.pathname === SCOPE || url.pathname === SCOPE + 'index.html'); }
/* The name of a data file the build lists, when url names one beside the page, or null. */
function dataName(url) {
  if (url.origin !== self.location.origin || url.pathname.indexOf(SCOPE) !== 0) return null;
  var name = url.pathname.slice(SCOPE.length);
  return DATA_FILES.indexOf(name) >= 0 ? name : null;
}

self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate' && isPage(url)) e.respondWith(page(req));
  else if (dataName(url)) e.respondWith(data(dataName(url)));
  else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') e.respondWith(font(req));
});

/* A data file: the stored copy, or the network's answer, which is then stored when it is good. */
function data(name) {
  return caches.open(DATA).then(function (c) {
    return c.match(name).then(function (hit) {
      return hit || fetch(name).then(function (r) {
        if (r.ok) c.put(name, r.clone());
        return r;
      });
    });
  });
}

/* The page: the network's answer when it is good and comes within WAIT_MS, and the stored copy otherwise.
   A good answer replaces the stored copy, even when it comes too late to be shown. An error from the
   server, such as a 404 or a 503, gives way to the stored copy when there is one. */
function page(req) {
  return caches.open(PAGE).then(function (c) {
    var stored = function () { return c.match('./'); };
    var net = fetch(req).then(function (r) {
      if (r.ok && r.type === 'basic') { c.put('./', r.clone()); return r; }
      return stored().then(function (s) { return s || r; });
    });
    var late = new Promise(function (resolve) { setTimeout(resolve, WAIT_MS); }).then(stored);
    return Promise.race([net.catch(stored), late]).then(function (r) { return r || net; });
  });
}

function font(req) {
  return caches.open(FONTS).then(function (c) {
    return c.match(req, { ignoreVary: true }).then(function (hit) {
      return hit || fetch(req).then(function (r) {
        if (r.ok) c.put(req, r.clone());
        return r;
      });
    });
  });
}
