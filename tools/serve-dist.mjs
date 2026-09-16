#!/usr/bin/env node
// Serves dist/music-hub/browser the way Vercel does.
//
// The point is fidelity, not convenience: the headers in vercel.json — the
// strict CSP above all — are part of what the browser runs, so a bug that only
// appears in production has to be reproducible here. `npx serve` would not do,
// because it sends none of them.
//
// Reads vercel.json at startup, so the rules cannot drift from what is
// deployed: change the CSP there and this picks it up on the next run.
//
//   node tools/serve-dist.mjs [--port 4173] [--dist dist/music-hub/browser]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};

const PORT = Number(flag('--port', 4173));
const ROOT = flag('--dist', 'dist/music-hub/browser');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/vnd.microsoft.icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Vercel's `source` is a path pattern, not a regexp, but the ones this project
// uses are all of the shape `/prefix-(.*)` or `/literal` — close enough that
// anchoring them as regexps reproduces the matching exactly.
function toMatcher(source) {
  // `(.*)` is pulled out to a placeholder before escaping, or escaping the dot
  // inside it would leave nothing for the wildcard step to recognise — which
  // silently matched no rule at all, and served the app with no CSP.
  const WILDCARD = '\u0000';
  const pattern =
    '^' +
    source
      .split('(.*)')
      .join(WILDCARD)
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .split(WILDCARD)
      .join('.*') +
    '$';
  const re = new RegExp(pattern);
  return path => re.test(path);
}

const vercel = JSON.parse(await readFile('vercel.json', 'utf8'));
const rules = (vercel.headers ?? []).map(rule => ({
  matches: toMatcher(rule.source),
  headers: rule.headers,
}));

function headersFor(pathname) {
  const out = {};
  for (const rule of rules) {
    if (!rule.matches(pathname)) continue;
    for (const { key, value } of rule.headers) out[key] = value;
  }
  return out;
}

// Vercel rewrites everything to /index.html, but only after a real file has
// failed to match — otherwise the chunks would all come back as HTML.
async function resolve(pathname) {
  const clean = normalize(decodeURIComponent(pathname.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const candidate = join(ROOT, clean);
  try {
    const info = await stat(candidate);
    if (info.isFile()) return { file: candidate, servedAs: clean };
  } catch {
    /* falls through to the SPA rewrite */
  }
  return { file: join(ROOT, 'index.html'), servedAs: '/index.html' };
}

const server = createServer(async (req, res) => {
  const { file, servedAs } = await resolve(req.url ?? '/');
  let body;
  try {
    body = await readFile(file);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  // Headers are keyed on what was *served*, matching Vercel: a rewritten
  // navigation gets index.html's no-store, not the requested path's rules.
  const headers = {
    ...headersFor(servedAs),
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Content-Length': body.length,
  };
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
});

server.listen(PORT, () => {
  console.log(`serving ${ROOT} with vercel.json headers on http://localhost:${PORT}`);
});
