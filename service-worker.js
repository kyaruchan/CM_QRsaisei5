// --- Bulletproof offline audio with Range support ---
const CACHE_NAME = "audio-player-v5"; // ★必ず更新
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./qr_5.mp3", // ←実ファイル名に合わせる（AUDIO_SRCと同じ表記で）
];

// install: 事前キャッシュ（確実に取り直す）
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

// activate: 古いキャッシュ削除＆即制御
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)));
    await self.clients.claim();
  })());
});

// fetch: 音声はキャッシュ優先＋Range対応、他はネット→失敗時キャッシュ
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isAudio = sameOrigin && /\.(mp3|m4a|aac|ogg|wav)(\?.*)?$/i.test(url.pathname);
  const range = req.headers.get("range");

  // ---- 音声：Range対応（キャッシュ優先）----
  if (isAudio) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);

      // まずは「URL文字列」でキャッシュを探す（ヘッダ差異の影響を避ける）
      let res = await cache.match(url.href);
      if (!res) res = await cache.match(req); // 念のため

      // キャッシュに無ければネット取得→保存（オンライン時）
      if (!res) {
        try {
          const net = await fetch(req);
          if (net.ok) cache.put(url.href, net.clone());
          res = net;
        } catch {
          // オフラインかつ未キャッシュ
          return new Response("Offline (audio not cached)", { status: 503 });
        }
      }

      // Range不要ならそのまま返す（キャッシュ優先）
      if (!range) return res;

      // ---- Range: キャッシュからフルを切り出して 206 で返す ----
      // キャッシュがストリーミング不可の場合もあるので ArrayBuffer 化
      const buf = await res.arrayBuffer();

      // 例) "bytes=12345-67890"
      const m = /bytes=(\d+)-(\d+)?/i.exec(range);
      const start = Number(m?.[1] ?? 0);
      const end = m?.[2] ? Number(m[2]) : (buf.byteLength - 1);

      // 範囲ガード
      const clampedStart = Math.max(0, Math.min(start, buf.byteLength - 1));
      const clampedEnd = Math.max(clampedStart, Math.min(end, buf.byteLength - 1));

      const chunk = buf.slice(clampedStart, clampedEnd + 1);
      const headers = new Headers(res.headers);
      // Content-Type が未設定ならmp3想定（m4a等は必要に応じて変える）
      if (!headers.get("Content-Type")) headers.set("Content-Type", "audio/mpeg");
      headers.set("Accept-Ranges", "bytes");
      headers.set("Content-Range", `bytes ${clampedStart}-${clampedEnd}/${buf.byteLength}`);
      headers.set("Content-Length", String(chunk.byteLength));

      return new Response(chunk, { status: 206, statusText: "Partial Content", headers });
    })());
    return;
  }

  // ---- 非音声：ネット→失敗時キャッシュ（成功時は更新）
  event.respondWith((async () => {
    try {
      const net = await fetch(req);
      if (sameOrigin && req.method === "GET" && net.status === 200) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(url.href, net.clone());
      }
      return net;
    } catch {
      const cached = await caches.match(url.href) || await caches.match(req);
      return cached || new Response("Offline", { status: 503 });
    }
  })());
});


