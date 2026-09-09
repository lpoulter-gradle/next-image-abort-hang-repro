// Reproduces: a client that disconnects while /_next/image is still generating
// a not-yet-cached variant leaves that cache key permanently pending. Every later
// request for the same key (url + width + quality + negotiated format) hangs until
// the server restarts.
//
// usage: node repro.mjs http://localhost:3999 [widths...]
import net from 'node:net';
import http from 'node:http';

const [base, ...widthArgs] = process.argv.slice(2);
const { hostname, port } = new URL(base);
const widths = widthArgs.length ? widthArgs : ['640', '750', '828', '1080', '1200'];
const ABORT_MS = Number(process.env.ABORT_MS || 2);
const PROBE_MS = Number(process.env.PROBE_MS || 8000);

const keyPath = w => `/_next/image?url=%2Fhero.webp&w=${w}&q=75`;

// 1. Raw socket: send the request, then destroy the socket a few ms later —
//    long enough for the server to accept it and start optimizing, too short for
//    it to finish. This is what a browser does when it cancels an image request
//    (viewport resize re-selecting srcset, navigation away, tab close).
function abortedRequest(path) {
  return new Promise(resolve => {
    const s = net.connect(Number(port), hostname, () => {
      s.write(`GET ${path} HTTP/1.1\r\nHost: ${hostname}\r\nAccept: image/webp\r\n\r\n`);
      setTimeout(() => {
        s.destroy();
        resolve();
      }, ABORT_MS);
    });
    s.on('error', () => resolve());
  });
}

// 2. Normal request for the same key.
function probe(path) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const req = http.get({ hostname, port, path, headers: { Accept: 'image/webp' } }, res => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - t0 }));
    });
    req.setTimeout(PROBE_MS, () => {
      req.destroy();
      resolve({ status: 'TIMEOUT', ms: Date.now() - t0 });
    });
    req.on('error', e => resolve({ status: 'ERR ' + e.code, ms: Date.now() - t0 }));
  });
}

let hung = 0;
for (const w of widths) {
  await abortedRequest(keyPath(w));
  const r = await probe(keyPath(w));
  if (r.status === 'TIMEOUT') hung++;
  console.log(`w=${w}  follow-up: ${r.status} after ${r.ms}ms`);
}
// Control: a key that was never aborted.
const control = await probe(`/_next/image?url=%2Fhero.webp&w=1920&q=75`);
console.log(`control (w=1920, never aborted): ${control.status} after ${control.ms}ms`);
console.log(hung ? `\n${hung}/${widths.length} keys are now permanently hung (restart the server to clear).` : '\nNo hang reproduced.');
process.exit(hung ? 1 : 0);
