// Assembles a self-contained preview/index.html from the REAL popup.html +
// popup.css + popup.js, with the chrome-mock prepended, so the shipped UI can
// be rendered + screenshotted in a plain browser tab. Run after any UI change:
//   node preview/build-preview.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const html = readFileSync(join(root, 'popup.html'), 'utf8');
const css = readFileSync(join(root, 'popup.css'), 'utf8');
const js = readFileSync(join(root, 'popup.js'), 'utf8');
const mock = readFileSync(join(here, 'chrome-mock.js'), 'utf8');

// Pull the body inner HTML, minus the <script src="popup.js"> tag and the
// <link rel=stylesheet> (we inline both).
const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
let body = bodyMatch ? bodyMatch[1] : html;
body = body
  .replace(/<script[^>]*src=["']popup\.js["'][^>]*>\s*<\/script>/gi, '')
  .replace(/<link[^>]*popup\.css[^>]*>/gi, '');

const out = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>GAW: RE-SEARCH — preview</title>
<style>
/* preview page chrome: center the 600px popup on a neutral backdrop */
body.__preview_host { margin:0; background:#010409; display:flex; justify-content:center; padding:24px 0; }
.__preview_frame { width:600px; box-shadow:0 0 0 1px #30363d, 0 24px 60px rgba(0,0,0,.6); border-radius:8px; overflow:hidden; }
${css}
</style>
</head>
<body class="__preview_host">
<div class="__preview_frame">
${body}
</div>
<script>${mock}</script>
<script>${js}</script>
</body>
</html>
`;

writeFileSync(join(here, 'index.html'), out, 'utf8');
console.log('[preview] wrote preview/index.html (' + out.length + ' bytes)');
