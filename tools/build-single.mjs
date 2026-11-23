// Bundle the game into one self-contained HTML fragment (three.js from a CDN).
//   node tools/build-single.mjs <out.html>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = process.argv[2] || path.join(root, 'dist/jetski-rider.html');
const r = await esbuild.build({ entryPoints: [path.join(root, 'src/main.js')], bundle: true, format: 'esm', minify: true, external: ['three', '../vendor/firebase-db.js'], write: false, target: 'es2020' });
const js = r.outputFiles[0].text;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'));
const page = `<title>Jetski Rider</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Saira:wght@400;500;600&family=Saira+Extra+Condensed:ital,wght@0,600;0,800;1,700;1,900&display=swap">
<style>
${css}
</style>
${body}
<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js" } }</script>
<script type="module">
${js}
</script>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log('wrote', out, (page.length / 1024).toFixed(0) + ' KB');
