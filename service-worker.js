// ==== Offline Audio with Range support ====
// バージョンを上げると配布更新されます
const CACHE_NAME = "audio-player-v3";

// 必要ファイルを同一オリジンで
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./QR_5.mp3",           // ←実ファイル名に合わせて
];

// install: 事前キャッシュ（確実に取り直すため cache:'reload'）
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(
      PRECACHE.map((url) =>
        cache.add(new Request(url, { cache: "reload" })).catch(() => null)
      )
    );
  })());
  self.skipWaiting();
});

// activate: 古いキャッシュ削除
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)));
  })());
  self.clients.claim();
});

// fetch: mp3を含む音声に Range 対応、他はネット→失敗時キャッシュ
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 同一オリジンのみ対象
  const sameOrigin = url.origin === self.location.origin;
  const isAudio = sameOrigin && /\.(mp3|m4a|aac|ogg|wav)(\?.*)?$/i.test(url.pathname);

  // ---- Range（部分取得）対応 ----
  const rangeHeader = req.headers.get("range");
  if (isAudio && rangeHeader) {
    event.respondWith((async () => {
      // まずキャッシュ or ネットからフルバイト列を入手
      const cache = await caches.open(CACHE_NAME);
      let res = await cache.match(req);
      if (!res) {
        const net = await fetch(req);
        // 成功時はキャッシュに保存
        if (net.ok) cache.put(req, net.clone());
        res = net;
      }
      // 失敗ならそのまま返す
      if (!res || !res.ok) return res;

      // ArrayBuffer化して手動で部分レスポンスを返す
      const buf = await res.arrayBuffer();

      // 例: "bytes=12345-"
      const bytes = rangeHeader.match(/bytes=(\d+)-(\d+)?/i);
      const start = Number(bytes[1]);
      const end = bytes[2] ? Number(bytes[2]) : buf.byteLength - 1;

      const chunk = buf.slice(start, end + 1);
      const headers = new Headers(res.headers);
      headers.set("Content-Type", headers.get("Content-Type") || "audio/mpeg");
      headers.set("Content-Range", `bytes ${start}-${end}/${buf.byteLength}`);
      headers.set("Accept-Ranges", "bytes");
      headers.set("Content-Length", String(chunk.byteLength));

      return new Response(chunk, { status: 206, statusText: "Partial Content", headers });
    })());
    return;
  }

  // ---- 音声（Rangeなし）: キャッシュ優先 ----
  if (isAudio) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      const net = await fetch(req);
      if (net.ok) cache.put(req, net.clone());
      return net;
    })());
    return;
  }

  // ---- それ以外: ネット→失敗時キャッシュ ----
  event.respondWith((async () => {
    try {
      const net = await fetch(req);
      if (sameOrigin && req.method === "GET" && net.status === 200) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, net.clone());
      }
      return net;
    } catch {
      const cached = await caches.match(req);
      return cached || new Response("Offline", { status: 503, statusText: "Service Unavailable" });
    }
  })());
});
