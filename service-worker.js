// ==== オフライン対応 Service Worker ====
// 変更を配信したいときは、このバージョン番号を上げる
const CACHE_NAME = "audio-player-v2";

// ここにオフラインで必要なファイルを列挙（同じフォルダ前提）
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./QR_5.mp3" // ←ファイル名をあなたの実ファイルに合わせて
];

// インストール：事前キャッシュ
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// 有効化：古いキャッシュを削除
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

// 取得：音声はキャッシュ優先、他はネット→失敗時キャッシュ
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 同一オリジンだけ対象（CDNや外部URLはCORSの都合で避ける）
  const sameOrigin = url.origin === self.location.origin;

  // mp3/ogg などの音声拡張子
  const isAudio = sameOrigin && /\.(mp3|ogg|wav|m4a)(\?.*)?$/i.test(url.pathname);

  if (isAudio) {
    // キャッシュ優先（オフラインでも即ヒット）
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return res;
        });
      })
    );
    return;
  }

  // それ以外はネット→失敗したらキャッシュ（一般的なフォールバック）
  event.respondWith(
    fetch(req)
      .then((res) => {
        // 成功したらついでに更新
        if (sameOrigin && res.status === 200 && req.method === "GET") {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
