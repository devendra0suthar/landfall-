import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

/**
 * Bundle the extension.
 *
 * esbuild rather than a framework plugin: three entry points, no JSX, no CSS
 * pipeline. The one thing that matters is that the content script is a single
 * self-contained file — a content script cannot resolve bare imports at runtime.
 */

await mkdir('dist', { recursive: true });

await build({
  entryPoints: ['src/content.ts', 'src/background.ts', 'src/popup.ts'],
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  outdir: 'dist',
  logLevel: 'info',
});

await copyFile('manifest.json', 'dist/manifest.json');
await copyFile('src/popup.html', 'dist/popup.html');
console.log('extension built into dist/ — load it unpacked from there');
