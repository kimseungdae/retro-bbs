import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const isWatch = process.argv.includes('--watch');

const extensionBuild = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  minify: !isWatch,
};

const webviewBuild = {
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  outfile: 'out/webview/main.js',
  format: 'iife',
  platform: 'browser',
  sourcemap: true,
  minify: !isWatch,
};

function copyStaticFiles() {
  const outWebview = 'out/webview';
  const outFonts = join(outWebview, 'fonts');
  if (!existsSync(outWebview)) mkdirSync(outWebview, { recursive: true });
  if (!existsSync(outFonts)) mkdirSync(outFonts, { recursive: true });
  copyFileSync('src/webview/index.html', join(outWebview, 'index.html'));
  copyFileSync('src/webview/styles.css', join(outWebview, 'styles.css'));
  copyFileSync('src/webview/fonts/neodgm.woff2', join(outFonts, 'neodgm.woff2'));
}

if (isWatch) {
  const extCtx = await esbuild.context(extensionBuild);
  const webCtx = await esbuild.context(webviewBuild);
  await extCtx.watch();
  await webCtx.watch();
  copyStaticFiles();
  console.log('Watching for changes...');
} else {
  await esbuild.build(extensionBuild);
  await esbuild.build(webviewBuild);
  copyStaticFiles();
  console.log('Build complete.');
}
