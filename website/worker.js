// SPDX-License-Identifier: MIT
//
// The site is static. This Worker exists for one reason: Workers static assets
// answer a Range request with the whole file and a 200, and Safari (iOS in
// particular) will not play a video from a server that cannot return 206
// Partial Content. wrangler.toml runs it first for *.mp4 only; every other
// path is served straight from public/ without reaching this code.
//
// The asset is streamed and trimmed rather than read into memory. The asset
// binding sends no Content-Length, so the size is counted once per file
// version (ETag) and remembered for the life of the isolate. If the asset
// server ever honours Range itself, its 206 is passed through untouched.

/** ETag (or path) → size in bytes. */
const sizes = new Map();

export default {
  async fetch(request, env) {
    const range = request.headers.get('Range');
    // Ask for the whole file: trimming is done here.
    const plain = new Request(request);
    plain.headers.delete('Range');
    const asset = await env.ASSETS.fetch(plain);
    if (asset.status !== 200 || asset.body === null) return asset;

    const headers = new Headers(asset.headers);
    headers.set('Accept-Ranges', 'bytes');
    if (range === null || request.method !== 'GET') {
      return new Response(asset.body, { status: 200, headers });
    }

    const size = await sizeOf(asset, plain, env);
    const bounds = parseRange(range, size);
    if (bounds === null) {
      asset.body.cancel();
      headers.set('Content-Range', `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }

    const [start, end] = bounds;
    const length = end - start + 1;
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    const trimmed = asset.body.pipeThrough(slice(start, end));
    // FixedLengthStream makes the Workers runtime send a real Content-Length.
    if (typeof FixedLengthStream === 'function') {
      const fixed = new FixedLengthStream(length);
      trimmed.pipeTo(fixed.writable);
      return new Response(fixed.readable, { status: 206, headers });
    }
    headers.set('Content-Length', String(length));
    return new Response(trimmed, { status: 206, headers });
  },
};

async function sizeOf(asset, plain, env) {
  const declared = Number(asset.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > 0) return declared;
  const key = asset.headers.get('ETag') ?? new URL(plain.url).pathname;
  const known = sizes.get(key);
  if (known !== undefined) return known;
  // Count a second copy so the first can still be streamed to the viewer.
  const copy = await env.ASSETS.fetch(plain);
  const reader = copy.body.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
  }
  sizes.set(key, total);
  return total;
}

/** One range only (`bytes=a-b`, `bytes=a-`, `bytes=-n`), which is all a media element asks for. */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (m === null || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return null;
  return [start, end];
}

/** Passes through bytes start..end (inclusive) of a byte stream and drops the rest. */
function slice(start, end) {
  let offset = 0;
  return new TransformStream({
    transform(chunk, controller) {
      const from = offset;
      offset += chunk.byteLength;
      if (offset <= start || from > end) return;
      controller.enqueue(chunk.subarray(Math.max(0, start - from), Math.min(chunk.byteLength, end - from + 1)));
      if (offset > end) controller.terminate();
    },
  });
}
