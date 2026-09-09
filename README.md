# next/image: aborted client request permanently hangs that `/_next/image` cache key

Minimal reproduction for a Next.js image optimizer bug: if the first client requesting a not-yet-cached
`/_next/image?url=…&w=…&q=…` disconnects before the optimizer finishes, every later request for that exact key
(url + width + quality + negotiated format) hangs until the server process restarts. Nothing is logged.

## Reproduce

```bash
pnpm install          # or npm install
pnpm run gen          # writes public/hero.webp (synthetic 2560x1440)
pnpm run build
pnpm start            # next start -p 3999   (keep running)

# in another terminal
pnpm run repro
```

Expected output on an affected version:

```
w=640  follow-up: TIMEOUT after 8001ms
w=750  follow-up: TIMEOUT after 8002ms
...
control (w=1920, never aborted): 200 after 130ms

5/5 keys are now permanently hung (restart the server to clear).
```

`curl -m 10 -H 'Accept: image/webp' 'http://localhost:3999/_next/image?url=%2Fhero.webp&w=640&q=75'` now hangs too,
while `w=1920`, `q=90`, or `Accept: image/avif` for the same image answer in milliseconds. Restarting `next start` clears it.

## What is happening

1. `NextNodeServer.imageOptimizer` → `fetchInternalImage(href, req.originalRequest, res.originalResponse, …)` builds
   `createRequestResponseMocks({ socket: _req.socket })` — the **client's** socket — and then `await mocked.res.hasStreamed`,
   which only resolves on `finish`/`end` of the mocked response.
2. The internal request is served by `serve-static` → bundled `send`, which gates streaming on on-finished's
   `isFinished(res)`: `Boolean(res.finished || (socket && !socket.writable))`. The mocked response reports
   `finished = false` but exposes the client's socket. Once the client has gone, the socket is not writable, `send`
   treats the response as already finished, writes nothing and never calls `end()`.
3. `hasStreamed` never settles → the `responseGenerator` promise never settles → `Batcher.batch` never reaches
   `finally { pending.delete(key) }` → every later `imageResponseCache.get(key)` awaits the same dead promise.

## Fix that makes the repro pass

Keep the socket on the mocked **request** (the router reads `encrypted` / `remoteAddress` from it) but don't hand it to
the mocked **response** — it is a buffer, not a wire:

```diff
 // packages/next/src/server/lib/mock-request.ts  (createRequestResponseMocks)
         res: new MockedResponse({
-            socket,
+            socket: null,
             resWriter,
             maximumResponseBody
         })
```

With that change the identical script goes from 5/5 permanent hangs to 5/5 `200` responses, and pages still render
their images. A belt-and-braces addition would be a timeout on `responseGenerator` in `ResponseCache` so a generator
that never settles is evicted from the batcher instead of poisoning the key.

## Real-world trigger

Resize the browser window while a page with responsive `<Image>`s is open (Chromium re-selects `srcset` candidates and
starts new requests), then navigate away: the cancelled requests wedge their keys. Behind a CDN this only bites cache
misses; on self-hosted `next start` (previews, single-instance deployments) it presents as "some images never load".
