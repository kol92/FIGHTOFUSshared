# Adding or updating a character

This is the end-to-end guide for putting a new fighter into Fight of Us, or re-arting an
existing one. It covers the art pipeline, every file you touch, and the hand-tuned config
that the folder structure alone doesn't explain.

> **Honest expectations.** Two parts of this are *not* mechanical and no script can fully do
> them for you: (1) turning a raw sprite-sheet into clean, transparent, tightly-trimmed frames
> (background removal is an art/matting step), and (2) fine-tuning per-frame `anchors`, `scale`,
> and `poseDurations` by eye. The `tools/atlas.js` helper does the mechanical slicing and gives
> you a *starter* config that lands within a few pixels of correct — you nudge from there.

---

## Mental model: what a fighter is made of

A fighter is **art files** + **config in `js/game.js`** + a **manifest entry** in `js/assets.js`
+ a **roster entry**. There are two animation systems, and a character can mix them:

| System | Art shape | Used by | Config needed |
| --- | --- | --- | --- |
| **Base** (single-image) | one PNG per pose (`base/idle.png`, `base/walk.png`, …) | Krisz, Laci | none (drawn as-is) |
| **Clips** (multi-frame) | one folder of numbered frames per pose (`walk/0.png…`) | Tomi, Barna | a `CLIP_CONFIG` block |

Everything else is layered on top of those: `special/` (Berserk alt-art), `ultimate/`, `enter/`,
`combat2/`. The engine loads **whatever categories exist** for a character (`ensureFighterLoaded`
in `js/game.js`), so you only provide the ones you have.

**Frame-resolution order during a match** (highest priority first): entrance animation → ultimate →
multi-frame clip for the current pose → `combat2` pose art → base pose image. When Berserk is active
the engine swaps base art for the `*_special` art.

---

## Step 1 — Prepare the art

Source sheets in this project are grid atlases (e.g. Barna's are 4 columns × 2 rows = 8 frames per
pose), opaque, on a non-uniform background. Getting from an atlas to game-ready frames:

1. **Slice the grid** into cells:
   ```bash
   node tools/atlas.js slice --in path/to/POSE_atlas.png --cols 4 --rows 2 --out /tmp/pose
   ```
   → `/tmp/pose/0.png … 7.png` (raw, still with background).

2. **Remove each frame's background** to transparent and **trim** it tight to the character.
   This is the manual/art step — use a matting tool (e.g. an AI background remover, `rembg`, or
   hand-masking in an image editor). The result must be **transparent PNG, cropped snug to the
   character**, because the animation `anchors` are measured relative to each frame's own edges.

Single-image (base) characters: do the same, but you'll end up with one finished image per pose,
which you rename to `idle.png`, `walk.png`, etc.

## Step 2 — Place the files

Use a short lowercase `<id>` (e.g. `nora`). Only create the categories you actually have:

```
assets/characters/<id>/
  base/       idle.png walk.png run.png jump.png block.png punch.png kick.png hit.png win.png lose.png
  special/    (optional) Berserk alt-art — same 10 pose names
  ultimate/   ult1.png ult2.png …  (+ a projectile sprite if the ultimate throws something)
  enter/      enter1.png enter2.png …  (spawn/entrance frames)
  combat2/    sweep.png throw.png beingThrown.png knockdown.png getUp.png crouch.png
  <pose>/     (clip characters only) one folder per animated pose: walk/0.png 1.png …
```

A clip character still needs a single `base/idle.png` — the character-select **portrait** draws that
one static frame (it does not animate the clip).

## Step 3 — Register in the manifest (`js/assets.js`)

`window.ASSETS` maps keys → paths. Add your character under each category you provided. It's a plain
object; hand-edit it. Match the exact keys the engine reads:

```js
sprites.<id>          = { idle: "assets/characters/<id>/base/idle.png", walk: "…", … }
special.<id>          = { idle: "…special/idle.png", … }        // Berserk alt-art (optional)
ultimates.<id>        = { ult1: "…ultimate/ult1.png", …, <projectile>: "…ultimate/<name>.png" }
enter.<id>            = { enter1: "…enter/enter1.png", … }
combat2.<id>          = { sweep: "…", throw: "…", beingThrown: "…", knockdown: "…", getUp: "…", crouch: "…" }
combat2_special.<id>  = { … }                                    // Berserk combat2 art (optional)
clips.<id>            = { walk: ["…/walk/0.png","…/walk/1.png", …], punch: [ … ], … }
```

## Step 4 — Add the roster entry (`js/game.js`)

In the `CHARACTERS` array, either add a new entry or replace one of the `enabled:false` `lockedN`
slots (the character-select grid has 6 cells):

```js
{ id: '<id>', name: 'NORA', enabled: true, spriteKey: '<id>',
  portraitCrop: { x: 20/236, y: 0, w: 196/236, h: 196/344 } },
```

**`portraitCrop`** frames the head + shoulders for the select/VS portrait, as fractions (0..1) of
`base/idle.png`'s dimensions. To derive it: open `idle.png`, note its `W×H`, pick the crop box in
pixels `(left, top, boxW, boxH)`, then `x=left/W, y=top/H, w=boxW/W, h=boxH/H`. Keeping the raw
fractions (`20/236`) makes it re-tunable.

## Step 5 — Animation config (clip characters only)

Single-image characters are done after Step 4. For a clip character, add a `CLIP_CONFIG.<id>` block —
one entry per animated pose. Generate a starter from your finished frames:

```bash
node tools/atlas.js config --frames assets/characters/<id>/walk --pose walk --loop --frame-ms 90
```

which prints a line to paste into `CLIP_CONFIG.<id>`:

```js
walk: { loop: true, frameMs: [90,90,…], anchors: [{x:130.5,y:481}, …], scale: 0.378 },
```

Field by field:
- **`loop`** — `true` for continuous poses (idle, walk, run); `false` for one-shots (punch, hit, win)
  that hold on the last frame.
- **`frameMs`** — array, one duration (ms) per frame. Uniform is fine to start.
- **`anchors`** — array of `{x, y}` in **each frame's own pixel space**: the point that is pinned to
  the character's on-ground position. `x` = horizontal centre of the **feet**, `y` = the frame's
  bottom edge. The generator computes `(content-centre-x, frame-height)`; nudge `x` per frame so the
  feet stay planted as the character shifts weight. (If a pose has no `anchors`, the engine defaults
  the pivot to `width/2, height`.)
- **`scale`** — size multiplier; on-screen height ≈ `frameHeight × scale`. The generator estimates it
  from `--target-height` (default 182px, matching the other fighters). Tune so your fighter stands the
  right height next to the others.

Run `config` once per animated pose. The same `poses/poseDurations/anchors/scale` shape is reused by
the ultimate and entrance blocks below.

## Step 6 — Ultimate (`ULTIMATES.<id>` in `js/game.js`)

Add an entry describing how the ultimate plays. Two kinds:

```js
// melee (Krisz — the STOP-sign swing has no projectile):
'<id>': { poses: ["ult1",…,"ult10"], poseDurations: [190,170,…], anchors: [{x,y},…], ultScale: 0.54 },

// projectile (Tomi/Laci/Barna — throws something):
'<id>': { kind: 'projectile', poses: ["ult1",…], poseDurations: […], anchors: […], ultScale: 0.66,
          projectileType: '<id>_thing', spawnPoseIndex: 4, spawnOffset: {x: 40, y: -60},
          spriteCharId: '<id>', spriteKey: '<projectile-key>' },
```

- **`poses`** must match keys present in `ultimates.<id>` in the manifest; they play back-to-back.
- **`poseDurations`** — ms per pose (same length/order as `poses`).
- **`anchors` / `ultScale`** — same meaning as `CLIP_CONFIG` (use `tools/atlas.js config` on the
  ultimate frames to get starters).
- Projectile ults also need a matching entry in **`PROJECTILE_TYPES`** in `js/game.js` (keyed by
  `projectileType`, e.g. `tomi_bottle`); `spawnPoseIndex`/`spawnOffset` say which pose releases it and
  from where, and `spriteCharId`/`spriteKey` point at the projectile's own sprite in `ultimates.<id>`
  (e.g. Tomi's `ult_bottle`).

## Step 7 — Entrance animation (`ENTER_ANIMATIONS.<id>`)

Same shape as an ultimate, minus the projectile fields:

```js
'<id>': { poses: ["enter1",…,"enter5"], poseDurations: [400,380,…], scale: 0.469, anchors: [{x,y},…] },
```

## Step 8 — Combat2 poses

`combat2/` (sweep, throw, being-thrown, knockdown, get-up, crouch) is **just art** — no per-character
config. Drop the six PNGs in and add them to `combat2.<id>` in the manifest. `combat2_special.<id>` is
the optional Berserk variant of those six.

## Step 9 — Hardcoded touchpoints (easy to miss)

A few small per-character bits are hardcoded in `js/game.js`. New characters fall back to sane
defaults, but check these:

- **`charEmoji(id)`** — the little emoji next to the name (Krisz 🍺, Tomi 💊, Barna ⚽). Add a case or
  it shows none.
- **`targetH`** in the fighter draw code — per-character on-screen height (Krisz 168, others 182).
  Adjust if your fighter looks too tall/short next to the others.
- Purely-cosmetic Berserk flourishes are Tomi-specific (sunglasses/effects); you do **not** need them.

## Step 10 — Test

Serve and click through (see the README). Verify: portrait in select/VS; entrance during the
countdown; walk/run/jump/block/punch/kick; sweep/throw/knockdown/get-up; ultimate (and its projectile);
Berserk alt-art; win/lose. Watch DevTools **Console** for errors and **Network** for 404s — a wrong
manifest path shows up there immediately. Sprites that look like they "float" or "jitter" mean an
`anchor`/`scale` needs nudging.

---

## Updating an existing character

Re-arting is a subset of the above: replace the PNGs under `assets/characters/<id>/…` (keep the same
filenames and frame counts and nothing else changes), or add/remove frames — in which case update that
pose's `clips.<id>` array in the manifest and its `CLIP_CONFIG` entry (frame count, `frameMs`,
`anchors`) to match. Re-run `tools/atlas.js config` on the new frames for fresh starter anchors.

## Helper reference — `tools/atlas.js`

Wraps ImageMagick 7 (`magick`; macOS: `brew install imagemagick`).

```bash
# cut a grid sheet into numbered cells
node tools/atlas.js slice  --in <atlas.png> --cols <C> --rows <R> --out <dir>

# starter CLIP_CONFIG entry from finished (transparent, trimmed) frames
node tools/atlas.js config --frames <dir> --pose <name> [--loop] [--frame-ms <n>] [--target-height <px>]
```

It does **not** remove backgrounds (see Step 1). `config` reads the frames' alpha to compute
`anchors = (content-centre-x, frame-bottom)` and estimates `scale` — a starting point you refine by eye.
