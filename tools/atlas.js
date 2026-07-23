#!/usr/bin/env node
/*
 * atlas.js — authoring helper for adding/updating a Fight of Us character.
 *
 * Two subcommands, both wrapping ImageMagick 7 (`magick`, https://imagemagick.org):
 *
 *   slice   Cut a grid sprite-sheet into numbered cells.
 *   config  Turn a folder of finished frames into a starter CLIP_CONFIG entry
 *           (per-frame anchors + scale) you paste into js/game.js.
 *
 * What this tool does NOT do: remove backgrounds. The source sheets are opaque
 * with non-uniform backgrounds, so turning a raw cell into a clean, transparent,
 * tightly-trimmed sprite is an art/matting step (a matting tool or by hand).
 * See docs/adding-a-character.md for the full workflow.
 *
 * Usage:
 *   node tools/atlas.js slice  --in <atlas.png> --cols <C> --rows <R> --out <dir>
 *   node tools/atlas.js config --frames <dir> --pose <name> [--loop]
 *                             [--frame-ms <n>] [--target-height <px>]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function die(msg) { console.error('Error: ' + msg); process.exit(1); }

function magick(args) {
  try {
    return execFileSync('magick', args, { encoding: 'utf8' }).trim();
  } catch (e) {
    if (e.code === 'ENOENT') {
      die('ImageMagick (`magick`) not found. Install it (macOS: `brew install imagemagick`).');
    }
    die('magick failed: ' + (e.stderr || e.message));
  }
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { a[key] = true; }
      else { a[key] = next; i++; }
    }
  }
  return a;
}

// ---------------------------------------------------------------------------
// slice: grid-cut an atlas into numbered cells
// ---------------------------------------------------------------------------
function cmdSlice(a) {
  const inPath = a.in, cols = parseInt(a.cols, 10), rows = parseInt(a.rows, 10), out = a.out;
  if (!inPath || !cols || !rows || !out) {
    die('slice needs --in <atlas.png> --cols <C> --rows <R> --out <dir>');
  }
  if (!fs.existsSync(inPath)) die('atlas not found: ' + inPath);
  const [w, h] = magick(['identify', '-format', '%w %h', inPath]).split(' ').map(Number);
  if (w % cols !== 0 || h % rows !== 0) {
    console.warn(`Warning: ${w}x${h} does not divide evenly into ${cols}x${rows} ` +
      `(cell ${(w / cols).toFixed(1)}x${(h / rows).toFixed(1)}); cells may be off by a pixel.`);
  }
  fs.mkdirSync(out, { recursive: true });
  // -crop CxR@ splits into C columns x R rows of equal tiles, row-major.
  magick([inPath, '-crop', `${cols}x${rows}@`, '+repage', '+adjoin', path.join(out, '%d.png')]);
  const n = cols * rows;
  console.log(`Sliced ${inPath} into ${n} cells → ${out}/0.png … ${out}/${n - 1}.png`);
  console.log('These are RAW cells (opaque background). Next: remove each frame\'s background to');
  console.log('transparent and trim it tight (matting tool or by hand), then run `config`.');
}

// ---------------------------------------------------------------------------
// config: starter CLIP_CONFIG from finished (transparent, trimmed) frames
// ---------------------------------------------------------------------------
function cmdConfig(a) {
  const dir = a.frames, pose = a.pose;
  if (!dir || !pose) die('config needs --frames <dir> --pose <name>');
  if (!fs.existsSync(dir)) die('frames dir not found: ' + dir);
  const frameMs = a['frame-ms'] ? parseInt(a['frame-ms'], 10) : 100;
  const targetH = a['target-height'] ? parseFloat(a['target-height']) : 182;
  const loop = !!a.loop;

  const files = fs.readdirSync(dir)
    .filter(f => /^\d+\.png$/i.test(f))
    .sort((x, y) => parseInt(x) - parseInt(y));
  if (!files.length) die('no numbered frames (0.png, 1.png, …) in ' + dir);

  const anchors = [];
  const heights = [];
  for (const f of files) {
    const p = path.join(dir, f);
    // %w %h = full frame size; %@ = content bounding box "WxH+X+Y" (from alpha)
    const out = magick(['identify', '-format', '%w %h|%@', p]);
    const [wh, bbox] = out.split('|');
    const [fw, fh] = wh.split(' ').map(Number);
    const m = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(bbox);
    // anchor x = horizontal centre of the visible content; y = bottom edge of the frame
    // (matches the engine's default pivot of idw/2, idh). Tune per-frame afterwards.
    const cx = m ? (parseInt(m[3]) + parseInt(m[1]) / 2) : fw / 2;
    anchors.push({ x: Math.round(cx * 10) / 10, y: fh });
    heights.push(fh);
  }
  heights.sort((x, y) => x - y);
  const medianH = heights[Math.floor(heights.length / 2)];
  const scale = Math.round((targetH / medianH) * 10000) / 10000;

  const anchorsStr = anchors.map(p => `{x:${p.x},y:${p.y}}`).join(', ');
  const msArr = JSON.stringify(new Array(files.length).fill(frameMs));
  console.log(`// starter CLIP_CONFIG entry for "${pose}" (${files.length} frames) — paste into`);
  console.log(`// CLIP_CONFIG.<charId> in js/game.js, then fine-tune anchors/scale/frameMs by eye:`);
  console.log(`    ${pose}: { loop: ${loop}, frameMs: ${msArr}, anchors: [${anchorsStr}], scale: ${scale} },`);
  console.log(`// scale estimated for ~${targetH}px on-screen height (median frame ${medianH}px). ` +
    `anchors = (content centre-x, frame bottom).`);
}

// ---------------------------------------------------------------------------
const [, , cmd, ...rest] = process.argv;
const args = parseArgs(rest);
if (cmd === 'slice') cmdSlice(args);
else if (cmd === 'config') cmdConfig(args);
else {
  console.log('Usage:');
  console.log('  node tools/atlas.js slice  --in <atlas.png> --cols <C> --rows <R> --out <dir>');
  console.log('  node tools/atlas.js config --frames <dir> --pose <name> [--loop] [--frame-ms <n>] [--target-height <px>]');
  process.exit(cmd ? 1 : 0);
}
