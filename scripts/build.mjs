import { build, context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  sourcemap: true,
  format: 'esm',
  target: 'chrome120',
  outdir: distDir,
  entryNames: '[name]',
  logLevel: 'info'
};

const entryPoints = {
  background: path.join(root, 'src/background.ts'),
  content: path.join(root, 'src/content.ts'),
  popup: path.join(root, 'src/popup.ts')
};

async function copyStatic() {
  await mkdir(distDir, { recursive: true });
  await cp(path.join(root, 'manifest.json'), path.join(distDir, 'manifest.json'));
  await cp(path.join(root, 'src/popup.html'), path.join(distDir, 'popup.html'));
}

async function clean() {
  if (existsSync(distDir)) {
    await rm(distDir, { recursive: true, force: true });
  }
}

await clean();
await copyStatic();

if (watch) {
  const ctx = await context({ entryPoints, ...common });
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await build({ entryPoints, ...common });
}
