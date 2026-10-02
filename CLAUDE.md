# Striping Simulator — Development Guide

This file is the master reference for building Striping Simulator. Read it
before making architectural decisions; update it when decisions change.

## What this game is

A browser-playable 3D simulation game about laying out and striping parking
lots, and eventually warehouses, factories, loading docks, and other large
industrial spaces. Starts small (one parking lot job) and grows feature by
feature — no big-bang rewrites.

Two gameplay phases, two cameras:

1. **Preparation — top-down 3D camera.** Player is in an equipment yard,
   loading a truck with the striping rig, paint, cones, measuring tools, and
   stencils for the job ahead.
2. **Striping — over-the-shoulder 3D camera.** Player is on site, driving the
   striping rig and spraying paint along the required layout.

Player clicks "Start Job" to transition from phase 1 to phase 2.

Real-world accuracy matters: stall widths, line widths, and spacing are in
actual feet/inches (9'x18' standard stall, 4" stripe width, etc.), not
arbitrary game units. See `src/core/measurements.ts`.

## The ride-on striping rig (critical reference)

Reference photos (`reference images/`):
`lindedriver_appl_02.png` (the full ride-on rig — this is the authoritative
one for layout) and `graco-linelazerwebp.webp` (the walk-behind striper unit
alone, for nozzle/chassis detail). Confirmed against these photos — **do not
revert to assuming the buggy leads**; an earlier version of this doc had that
backwards.

The rig is **two separate connected objects, not one vehicle**:

- **Striping machine (leads, at the front).** Paint tank, engine, pump,
  spray nozzle. The nozzle hangs off the machine's **front-right corner**,
  not centered — the line it paints is offset to the right of the rig's
  centerline.
- **Buggy (trails, at the rear).** Operator seat, engine, steering. This is
  what the player drives; direction of travel is *toward* the striper.

The two are joined by an **articulated hitch**, not a rigid frame — and
critically, **steering and propulsion are split across the two halves**,
which is the whole point of the design and easy to get backwards:

- The operator sits on the **buggy** and controls **speed** with foot
  pedals. The buggy has no steering input of its own.
- The operator steers via **handlebars mounted on the striper**. The
  striper is the directly-steered "lead" reference, like a bicycle's front
  wheel — even though it doesn't provide propulsion itself.

Mechanically this is the same kinematics as a car towing a trailer (a
steered lead unit + a passively-hinged trailing unit, joined at a pivot),
just with the roles assigned unusually: the steered/lead unit (striper) is
physically in *front*, and the trailing unit (buggy) is the one with the
engine/pedals. Don't let "the buggy has the engine" tempt you into making it
the steered reference — the handlebars are on the striper, full stop.

The payoff of using real trailer-following kinematics rather than a rigid
frame: drive straight for a bit and the buggy's heading naturally converges
back to match the striper's (the stable equilibrium of the equation in
`stepRig`). Turn, and the two visibly articulate apart around the hitch
pivot, same as a real towed trailer swinging out. Reverse is correspondingly
twitchy/unstable, same as backing up a real trailer — that's an accurate
emergent property of the model, not a bug to fix.

On top of that sits an explicit **lock state** (`RigState.locked`) — added
after the asymptotic convergence above turned out not to be enough on its
own: it technically never reaches exact zero difference, and the user
wanted driving straight to feel like a genuine rigid lock, not an
approximation. While no steer input is held and the two units are aligned,
`buggyHeading` is pinned to exactly equal `striperHeading` (not just
converged close to it). Releasing the steer hands control back to the
trailer equation, which re-engages the lock on its own once it settles
within `RIG_SPEC.lockEngageThresholdRad`. Verified the exact transitions
numerically (locked ⇄ unlocked on the correct frame, exact heading equality
on lock/re-lock) rather than just eyeballing it — the threshold is only
~1°, too small to reliably judge by screenshot.

**While locked, steer input doesn't break the lock immediately — it goes
through a tap-vs-hold decision first** (`RigState.tapSteerDir` /
`tapHoldSec`, `RIG_SPEC.tapHoldThresholdSec` = 0.15s). This exists because
aligning the stripe precisely by turning was fiddly — fine lateral
adjustment was only available by breaking the lock, turning, and
re-settling, which is slow and imprecise for what's often just a tiny
correction. Now:
- **A quick tap** (steer pressed and released again before the threshold)
  does not turn or unlock anything. It nudges the whole rig sideways by a
  small fixed distance (`RIG_SPEC.nudgeDistanceFt`, currently 0.1ft) —
  applied as a lateral offset to the striper's position (using
  `rightVector(striperHeading)`), which the buggy automatically inherits
  through the existing hitch-arm derivation (`buggyX/Z = striperX/Z -
  forward(buggyHeading)*frameLengthFt`) — no separate handling needed for
  the buggy's side of it.
- **Holding steer past the threshold** breaks the lock and hands off to
  normal steering immediately on the same frame the threshold is crossed —
  from there it behaves exactly like unlocked steering always has.
- **Heading is frozen during the pending window** (the first
  `tapHoldThresholdSec` of any new press while locked) — we can't know yet
  whether it's a tap or the start of a hold, so nothing turns until that's
  decided. This means every hold-to-steer has a ~150ms window before
  turning visibly starts; an accepted tradeoff of needing *some* waiting
  period to disambiguate a tap from the start of a hold at all. Don't
  shorten `tapHoldThresholdSec` much to "fix" this without checking it
  doesn't start swallowing deliberate taps instead.
- Verified all of it numerically: heading provably unchanged for the whole
  pending window, a short press produces exactly one nudge of exactly
  `nudgeDistanceFt` applied only on release (not during the press), repeated
  taps accumulate (two taps measured at exactly 2x one tap's offset), and a
  sustained press crosses into an unlocked, actively-steering state right
  around the expected frame count. Also confirmed visually: a lot driven
  with several quick taps shows a visibly stepped/jogged stripe (discrete
  lateral jumps between straight segments), clearly distinct from the smooth
  curve a real turn produces.

**Q/E give a second, rotational flavor of fine-adjustment** — `nudgeRotate(state, dir)`
in `stripingRig.ts`, a small fixed heading change (`RIG_SPEC.rotateNudgeRad`,
currently ~1.15°) around the striper's own position (same pivot normal
steering already uses), still locked afterward since both headings move
together. Deliberately **not** built on the same tap/hold machinery as A/D:
there's no competing "hold" behavior to disambiguate from for Q/E (nothing
else is bound to them), so every `keydown` — including the browser's native
key-repeat while held — just fires one nudge directly, called straight from
`main.ts`'s keydown handler rather than through the per-frame polled
`JobSiteScene.update()` input (see `JobSiteScene.nudgeRotate`). A no-op
while unlocked, same precondition as the lateral nudge. Sign convention
matches `RigInput.steer` (+1 = right = E, -1 = left = Q) — verified against
an actual held D-turn that the signs genuinely agree, not just that they're
opposite each other, since a self-consistent-but-backwards sign convention
would pass a weaker test. Repeated nudges accumulate into a visibly smooth
curve (not stepped, unlike the lateral nudge) since each one changes heading
and the rig keeps moving between presses — confirmed visually.

(An earlier version of this doc described a **rigid frame** instead,
reasoning from the photos that the connecting bar looks solid/welded. That
was a mistake — revisit the articulated-hitch model above, not that one, if
you're ever unsure which is current.)

Why it's modeled as two separate objects (not one fused mesh) regardless of
hitch type: the plan is to eventually let players mix and match buggies and
striper attachments, detach the striper for walk-behind operation, and
adjust spray guns independently. Keeping them as two independently-tracked
objects in code is what makes that possible later.

**Paint must originate from the nozzle's actual world position**, not the
vehicle center and not directly under the player. Turning, reversing, and
(eventually) adjusting the spray gun all change where paint lands. This is
implemented as:

- `src/core/vehicles/stripingRig.ts` — pure physics/state.
  `striperHeading` is driven directly by the player's steer input (the
  handlebars). `buggyHeading` has no direct input; it evolves via the
  standard car-towing-a-trailer differential equation —
  `d(buggyHeading)/dt = (speed/frameLengthFt) * sin(striperHeading - buggyHeading)`
  — using the shared system speed (from the buggy's pedals/throttle). The
  buggy's position then trails `frameLengthFt` behind the hitch pivot
  (`hitchPivotPosition(state)`, currently just the striper's own reference
  point) along its own evolving heading.
- The nozzle is offset from the striper's own pivot by
  `nozzleForwardOffsetFt` (forward) and `nozzleRightOffsetFt` (lateral,
  toward the striper's right side) — see `rightVector()` in
  `src/core/heading.ts` for the heading-to-right-vector convention.
- `nozzleWorldPosition(state)` is the single source of truth for where paint
  should be drawn. The renderer (`JobSiteScene`) calls this every frame the
  nozzle is on and feeds it to the paint system — it does not re-derive the
  nozzle position from mesh transforms.
- There's no rigid tow-bar mesh baked into either vehicle anymore (it would
  visually "detach" during articulation). `JobSiteScene` draws a separate
  hitch-bar mesh each frame, positioned/rotated to span between
  `hitchPivotPosition(state)` and the buggy's actual position — always
  `frameLengthFt` long by construction, only its orientation changes.

If you need to place a new paint-emitting tool (e.g. a stencil sprayer, a
walk-behind striper), follow the same pattern: compute its world position in
`src/core/`, independent of any Three.js object, and have the renderer read
that value.

## Wet paint and tire tracks

Real traffic paint takes time to cure — roughly 5 minutes for the quick-dry
variety these rigs use. Drive a wheel through it before it's dry and you
track it across the lot. Implemented as three small, separable pieces:

- `src/core/paintDrying.ts` — `WetPaintField`. Records sprayed points with a
  timestamp (`recordPaint`), drops ones older than `PAINT_DRY_TIME_SEC`
  (currently 300s) each frame (`prune`), and answers "is anything wet within
  range of this point" (`isWetAt`). Samples are thinned to one per ~0.5ft of
  nozzle travel so a long spray doesn't pile up redundant points — still
  just a flat array scanned linearly; fine at prototype scale, but revisit
  with a spatial grid if lot sizes or dry times grow a lot.
- `wheelContacts(state)` in `stripingRig.ts` — returns the 4 ground-contact
  points (buggy's 2 rear wheels + striper's 2 wheels) used to check against
  the wet-paint field. **The nozzle's lateral offset
  (`nozzleRightOffsetFt`) must stay bigger than every wheel's own
  `*RightFt` offset.** Real rigs keep the nozzle clearly outboard of the
  wheel tracks so they don't drive through their own fresh line on a normal
  straight pass — get this backwards (as an earlier draft did, with the
  nozzle almost coincident with the buggy's own wheel) and the rig
  self-contaminates constantly instead of only on deliberate mistakes
  (tight turns, backtracking over an earlier pass). Verified by driving
  straight while spraying (no contamination) vs. looping hard back across a
  just-sprayed line (contamination triggers).
- **`TIRE_SPEC.pickupRadiusFt` must mean "the wheel is actually over the
  paint," not "the wheel is nearby."** It's derived directly from
  `RIG_SPEC.stripeLineWidthFt / 2` (plus a small ~0.4in allowance for the
  tire's own contact-patch width) rather than a round number picked by eye —
  an earlier draft used a flat 0.35ft, more than double the stripe's actual
  half-width, which registered contamination well before a wheel visibly
  touched the line. Verified the exact cutoff with an isolated test (wet
  just under the radius, dry just beyond it). If you ever retune this,
  check `WetPaintField`'s `minSampleSpacingFt` too (passed as `0.25` from
  `JobSiteScene`) — it has to stay under `2 * pickupRadiusFt` or gaps open
  up between stored wet-paint samples along an otherwise continuous stripe.
- `src/core/vehicles/tireContamination.ts` — one contamination scalar
  (0..1) for the whole rig, not per-wheel (a simplification — revisit if
  independent per-wheel tracking ever matters). Touching wet paint sets it
  to 1; it depletes linearly over `depletionDistanceFt` (20ft) of travel.
  `JobSiteScene` renders tracks at all 4 wheel contact points while
  `level > 0`, with alpha scaled by the current level so the marks visibly
  fade out as the tires run dry — same paint color, thinner width
  (`TIRE_SPEC.trackWidthFt`), lower opacity than the main stripe. Each
  wheel gets its own `RibbonTrail` instance (`withAlpha: true`) so the four
  tracks can fade independently; see "The paint rendering pipeline" below
  for how the fade is actually drawn.

**Not yet implemented, by design — deferred, not forgotten:** a score
deduction for leaving tire tracks, which should persist until the player
cleans the tracked area up with black paint. When picked up:
- Needs a way to mark a region "contaminated until cleaned" (today's
  `WetPaintField`/`TireContaminationState` only track *current* wetness and
  *current* tire load — neither persists a lingering "this spot got tracked"
  record once the tires dry off).
- Needs the cleanup tool/action itself (black paint over a tracked area).
- Needs to hook into whatever the overall job-scoring system ends up being
  (doesn't exist yet beyond `CoverageTracker`'s completion %).

## Engine portability

**Decision:** build with Three.js + TypeScript + Vite now, but keep gameplay
logic engine-independent wherever practical, because migrating to Unity (or
conceivably Unreal) later is a real possibility once core mechanics are
proven out. Per an earlier feasibility pass: models/textures/layouts migrate
easily; vehicle physics, paint spraying, and camera systems do not and would
need to be rebuilt regardless of prep — so the goal here is to minimize what's
*entangled* with Three.js, not to make the rewrite free.

Concretely:

- `src/core/` — game rules, measurements, job/equipment data types, vehicle
  physics. **No Three.js imports allowed here.** Everything here operates on
  plain numbers/objects (feet, radians, plain `{x,z}` points) so it could be
  ported to C#/Unity by hand without re-deriving the logic.
- `src/engine/threejs/` — all rendering, meshes, cameras, canvas-texture
  painting. This is the layer that gets thrown away/rewritten on an engine
  migration.
- `src/data/` — equipment and job definitions as JSON, not hardcoded in
  TypeScript. New jobs/equipment should be added here first.
- `src/ui/` — DOM-based HUD, separate from the 3D scene.
- Prefer glTF/GLB for any future imported 3D models (portable format) over
  engine-specific formats. (Current prototype uses procedural primitive
  geometry, no imported models yet.)

Do not add Three.js types/imports to anything in `src/core/`. If a core
function needs to expose something to the renderer, return plain data and let
`src/engine/threejs/` consume it.

## Architecture / file map

```
striping-simulator/
├── CLAUDE.md
├── index.html
├── package.json
├── public/                            — static assets served as-is (not bundled)
│   └── sounds/
│       ├── striping_simulator_engine_idle_loop.wav
│       └── striping_simulator_paint_spray_loop.wav
├── src/
│   ├── main.ts                        — bootstraps renderer, phase state machine, input, game loop
│   ├── style.css                      — HUD overlay styling
│   ├── core/                          — engine-independent game rules
│   │   ├── measurements.ts            — feet/inches constants & helpers
│   │   ├── heading.ts                 — shared forward/right vector convention from a heading angle
│   │   ├── equipment.ts               — EquipmentDef type
│   │   ├── jobs.ts                    — JobDef type
│   │   ├── layout.ts                  — stall layout spec, generates required stripe centerlines
│   │   ├── paintTracking.ts           — CoverageTracker: completion % from sprayed points vs required lines
│   │   ├── paintDrying.ts             — WetPaintField: tracks which recently-sprayed points are still wet
│   │   └── vehicles/
│   │       ├── stripingRig.ts         — articulated-hitch buggy+striper physics, nozzle + wheel contact positions
│   │       └── tireContamination.ts   — tire wet-paint pickup level, depletes over distance driven
│   ├── data/
│   │   ├── equipment.json             — equipment catalog
│   │   └── jobs.json                  — job definitions (lot layout, required equipment)
│   ├── engine/threejs/                — all rendering, disposable on engine migration
│   │   ├── cameras.ts                 — top-down (yard) + over-the-shoulder (job site) camera rigs
│   │   ├── vehicleMesh.ts             — buggy/striper low-poly meshes (local +Z = forward)
│   │   ├── paintRibbon.ts             — RibbonTrail: 3D geometry for the stripe + tire tracks (ground itself is a plain colored material, no texture)
│   │   ├── yardScene.ts               — equipment yard scene, click-to-load truck
│   │   └── jobSiteScene.ts            — job site scene, drives rig physics + paint + coverage each frame
│   ├── engine/audio/
│   │   └── rigAudio.ts                — RigAudio: real engine + spray loop samples (public/sounds/) + synthesized hitch lock/unlock clicks
│   └── ui/
│       └── hud.ts                     — DOM overlay: phase instructions, Start Job button, completion bar
└── reference images/
    ├── lindedriver_appl_02.png        — full ride-on rig (authoritative for layout)
    ├── graco-linelazerwebp.webp       — walk-behind striper unit alone (nozzle/chassis detail)
    └── shopping.webp                  — earlier ride-on rig reference photo
```

## Controls (current prototype)

- **Yard phase:** click equipment to load/unload the truck. "Start Job"
  enables once all `requiredEquipment` for the active job is loaded. A
  `hud-controls-panel` (top-right, `Hud.controlsPanel` in `hud.ts`) shows the
  full control reference — both yard and job-site controls — while in the
  yard, and hides once the job starts (the top instruction line covers job
  site controls compactly enough during actual driving). If more phases get
  their own control schemes later, extend `CONTROLS_TEXT` in `hud.ts` rather
  than bolting on a second panel.
- **Job site phase:** `W`/`S` (or arrows) drive forward/back, `A`/`D` steer
  left/right respectively (no steering authority at a standstill — matches
  real towed-rig behavior; mind the heading-to-screen-direction sign when
  touching `stepRig`'s `headingDelta`, see the comment there),
  `SPACE` sprays paint continuously while held. A "WHEEL / LOCKED" badge
  (top-center) shows whenever the hitch is pinned straight and disappears
  the instant a steering hold breaks it — see "Satisfying-feel feedback"
  below.

## Mechanics notes / gotchas learned the hard way

- **Steering authority should ramp up to full by some speed well under top
  speed, not scale all the way to `maxForwardSpeedFtPerSec`.** Originally
  `speedFraction` (which gates turn rate — no steering at a standstill) was
  computed as `currentSpeed / maxForwardSpeedFtPerSec`, which meant turning
  only felt sharp at or near full throttle and noticeably duller at normal
  cruising speed. Decoupled into its own `turnRampSpeedFtPerSec` (currently
  2.5, vs. a 9 ft/s top speed) so normal driving already gets full turn
  rate. Verified with an isolated test that a 90° turn now takes the same
  time at half throttle as at full throttle (confirms the ramp, not just
  max turn rate, was the actual fix — bumping `maxTurnRateRadPerSec` alone
  wouldn't have helped at partial throttle).
- **Top-down orthographic camera must size itself from the canvas aspect
  ratio**, not a fixed world width/height. Getting this wrong stretches
  circles into ellipses and can push content outside the visible frustum.
  See `createTopDownCamera`/`frameTopDownCamera` in `cameras.ts`.
- **Chase-camera geometry depends on where the "interesting" implement
  actually is relative to the camera.** Earlier (wrong) rig layout had the
  striper trailing behind the buggy; the camera had to sit far enough back
  to clear it, or the trailing implement (and the paint) fell behind the
  camera or below the view frustum. Now that the striper leads (in front),
  that specific failure mode doesn't apply — but a *different* one does:
  **when the two units are aligned (straight-line driving — their stable
  equilibrium, see the hitch physics note below), a dead-center chase
  camera keeps them exactly collinear**, so the near (buggy) mesh
  completely occludes the far (striper) mesh. Fixed by offsetting the
  camera laterally (`sideOffsetFt` in `OverShoulderCamera`) — a literal
  over-the-*shoulder* camera, not a dead-center one. During a turn the
  articulated hitch separates them on its own, but don't rely on that —
  straight-line driving is the common case. Whenever you change the rig's
  geometry, re-check camera framing with real screenshots (including
  mid-turn and while actively spraying), don't just reason about it on paper.
- **`OverShoulderCamera` has two shots, not one — the normal over-the-
  shoulder framing above, and a close zoom on the nozzle while `spraying`
  is true.** The actual painting is the thing worth seeing up close, so
  pressing Space doesn't just spray, it reframes the whole shot. Both
  `desiredPosition`/`lookTarget` branch on `target.spraying` internally;
  critically, this reuses the exact same exponential-smoothing `update()`
  loop as the normal shot rather than needing separate transition/animation
  code — the camera just eases toward whichever desired position the target
  currently implies, so toggling `spraying` eases smoothly between the two
  shots for free. Needed extending `OverShoulderTarget` beyond the buggy's
  own transform (`nozzleX/Z`, `striperHeading`) since the nozzle doesn't
  share the buggy's heading — it's on the independently-steered striper.
- **The buggy/striper hitch model has changed three times — know which one
  is current before touching `stripingRig.ts`.** In order: (1) a
  free-swinging trailer hitch where the trailing object was placed along
  the lead object's *recorded path history* ("cuts" through turns
  otherwise, needed a seeded tail point to avoid snapping to the lead
  object for the first few feet); (2) a **rigid frame** (striper pose = fixed
  forward+lateral offset from the buggy, same heading always, recomputed
  fresh each step — simple, but meant the two were always perfectly
  collinear, which both looked wrong during turns and caused the camera
  occlusion issue above); (3) **current: an articulated hitch using the
  standard car-towing-a-trailer differential equation**, with the *striper*
  as the steered/lead reference (handlebars) and the *buggy* as the
  passively-trailing one (pedals/speed only, no steering) — see "The
  ride-on striping rig" above for the full reasoning, which hinges on a
  real-world detail (where the handlebars actually are) that isn't
  derivable from physics alone. Don't reach for (1)'s path-history technique
  by default for a new hitched implement — it solves a different problem
  (an unconstrained free-swinging trailer) than (3)'s direct differential
  equation (a trailer whose lead point's heading is itself a known,
  directly-controlled input). Check which situation actually applies before
  picking a technique.
- **Paint canvas world-to-pixel mapping has two independent axes to get
  right: flip and origin.** The ground plane is rotated -90° about X to lie
  flat, and `THREE.CanvasTexture` flips V by default — combined, these two
  flips cancel out, so world Z maps *directly* (not mirrored) to canvas row.
  Separately, if the ground mesh is centered at a non-zero world position
  (it is, here — the lot sits in the middle of a padded ground plane), the
  canvas's pixel (0,0) is the ground's `(minX, minZ)` corner, **not** world
  `(0,0)`. Getting either of these wrong silently paints stripes in the wrong
  place while the gameplay-facing completion tracker (which works directly in
  world space, not canvas pixels) still reports correctly — so a passing
  completion % does not prove the paint renders in the right place. Verify
  paint placement by sampling actual canvas pixel color at the nozzle's world
  position, not just by eyeballing a screenshot.
- **Canvas-texture pixel resolution directly trades off against frame rate —
  this is *why* painting moved to geometry at all; don't reintroduce a
  canvas-texture painting path without re-reading this.** Early prototype
  painted both the stripe and tire tracks onto a 2D canvas mapped as the
  ground's texture. Doubling its resolution (8 → 16px/ft) once to fix
  blurriness tanked performance from ~60fps to ~10fps while spraying —
  confirmed by isolated A/B measurement (rAF-counted fps under sustained
  spraying) that canvas *size* was the real cost (each `needsUpdate=true`
  re-uploads the *entire* canvas to the GPU; no WebGL sub-region update path
  exists for `CanvasTexture`), not upload *frequency* — batching multiple
  paint calls into one upload/frame did not rescue the higher-resolution
  case. The canvas-texture approach (`PaintCanvas`) has since been deleted
  entirely; both the stripe and tire tracks are real 3D geometry now (see
  below). If a future feature seems to want canvas-texture painting again
  (e.g. stencils/stamps), measure fps before committing to that approach —
  the ceiling here is lower than it looks.
- **The paint rendering pipeline is all real 3D ribbon geometry —
  `RibbonTrail` in `paintRibbon.ts`** — used for both the main nozzle stripe
  (`JobSiteScene.stripeRibbon`, solid color, `withAlpha: false`) and all 4
  tire tracks (`JobSiteScene.wheelTrails`, one `RibbonTrail` instance per
  wheel, `withAlpha: true` for the fade). Each is a strip of quads following
  its path (width = `stripeLineWidthFt` for the stripe, `TIRE_SPEC.trackWidthFt`
  for tracks; flat-shaded `MeshBasicMaterial`), crisp at any zoom and
  anti-aliased by the renderer regardless of resolution — nothing here reads
  pixel density at all. Depth order (ground `y=0` → tire tracks `y=0.01` →
  stripe `y=0.015` → reference lines `y=0.02`, all named constants in
  `jobSiteScene.ts`) keeps reference lines visible as a guide over painted
  stripe, and the stripe visibly on top of tire tracks where they overlap.
  Measured 60fps sustained under full load (spraying + driving + active
  tire tracks) — essentially free compared to the canvas approach's
  40-60fps at low resolution or ~10fps at higher resolution.
  - **Per-vertex alpha (for the tire-track fade) rides on Three.js's
    built-in vertex-color pipeline** — a `color` attribute with itemSize 4
    (RGBA) plus `material.vertexColors = true` and `transparent = true`
    blends per-vertex alpha automatically, no custom shader needed. Checked
    this against the actual Three.js source (`USE_COLOR_ALPHA` /
    `vertexAlphas` in `WebGLPrograms.js`) before relying on it, since an
    earlier pass here had assumed (wrongly) that per-vertex alpha required a
    custom `ShaderMaterial` and used that assumption to justify leaving tire
    tracks on canvas. It didn't; don't repeat that assumption without
    checking.
  - **Streamed in fixed-size chunks (`QUADS_PER_CHUNK` quads/mesh), each
    uploaded via `BufferAttribute.addUpdateRange` — not whole-buffer
    `needsUpdate`.** This is the exact same trap as the canvas (an
    unbounded or needlessly-large GPU upload every frame) solved properly
    this time: only the newly-written vertex range gets uploaded, and no
    single buffer grows forever over a long play session.
  - **Corners are NOT mitered/averaged** — each segment's perpendicular is
    computed from just that segment's own direction, not blended with its
    neighbor's. At this rig's turn rate this reads as a smooth curve in
    practice (verified visually at a hard-right turn), but a very sharp
    heading change in a single frame could show a visible facet/kink at the
    joint. Revisit with averaged-normal miter joints if that ever becomes
    visible.
- **Browser QA harness note:** the `browser-automation` skill's `page.evaluate`
  runs in an isolated JS world that shares the DOM with the page but not its
  `window` object. A page script's `window.foo = x` will never be visible to
  a later `page.evaluate` read, even though DOM mutations (text content,
  styles, attributes) are visible both ways. Don't burn time debugging "my
  window hook isn't showing up" — it's this, not a game bug. To get data out
  for verification, write it into DOM text content (e.g. a hidden debug
  `<div>`) and read that back instead.
- **Audio (`RigAudio`) must be constructed from inside a real user-gesture
  call stack, or the browser silently creates the `AudioContext` suspended
  and nothing plays.** `JobSiteScene`'s constructor — which is where
  `RigAudio` gets created — already runs synchronously inside the "Start
  Job" button's click handler in `main.ts`, so it piggybacks on that gesture
  for free. If audio ever moves earlier (e.g. yard-phase ambience) it needs
  its own deliberate gesture trigger (a click/keypress), not just "construct
  it at page load."
  - **The engine loop is a real recorded sample** (`public/sounds/`, fetched
    + `decodeAudioData`'d, looped via `AudioBufferSourceNode.loop = true`),
    not synthesized — the first departure from this project's otherwise
    fully-procedural asset approach. Real audio assets belong in `public/`,
    not an `src/` import: Vite serves `public/` as-is at the root URL path
    without bundling or base64-inlining it into the JS, which matters for
    audio specifically (an imported/bundled audio file would get inlined).
    The fetch+decode is necessarily async, started from `start()`, but that's
    fine — the user-gesture constraint above is specifically about the
    `AudioContext`'s creation/unlock, not about when any individual sound
    starts playing, so the async load can safely happen after the
    synchronous construction. **Doesn't pitch-shift the sample with speed**
    (only volume) — it's a single idle-loop recording, not a multi-RPM set,
    so speeding up playback would sound like a chipmunk effect rather than a
    revving engine. Non-fatal on load failure (caught, logged, game stays
    fully playable) since nothing else depends on it.
  - **The spray loop (also a real sample) is preloaded in `start()` but not
    played until `startSpray()`/`stopSpray()`** — called from
    `JobSiteScene.update()` on the `rig.nozzleOn` edge (the same
    edge-detection pattern already used for the lock/unlock clicks, not a
    third different pattern). Preloading up front avoids a delay on the
    player's very first press of Space; since `AudioBufferSourceNode`s are
    single-use and can't be restarted after `stop()`, `startSpray()` creates
    a fresh one from the cached decoded `AudioBuffer` each time rather than
    reusing a node. Both start and stop are immediate/hard (no fade), matching
    the nozzle itself switching instantly, not trailing off. `startSpray()`
    no-ops if a source is already playing, so naive repeated calls (e.g. if
    a caller's edge-detection has a bug and fires every frame while held)
    can't stack multiple overlapping copies of the loop — verified this
    explicitly: held Space across many frames and confirmed exactly one
    start, not one per frame, then a separate press/release cycle correctly
    produced exactly one more start and one more stop.
  - The lock/unlock clicks are still synthesized procedurally via raw Web
    Audio API nodes (a noise-burst buffer, bandpass-filtered) — a one-off
    mechanical click is easy to synthesize convincingly and didn't need a
    recorded asset. Don't assume everything in `RigAudio` is one approach or
    the other; check which per-sound.
  - Verified the engine sample genuinely loads and plays (not just that the
    fetch didn't error): confirmed `AudioContext.state === 'running'` and
    the decoded buffer's duration matched what the WAV file's raw byte size
    implies for its format (16-bit mono PCM @ 32kHz) — an independent
    cross-check that the decode produced the right data, not just that it
    didn't throw. Separately verified the lock/unlock click wiring by
    driving the rig through a full lock → unlock → re-lock cycle and
    confirming the exact click counts (0 while straight, 1 unlock on
    turning, 1 lock on settling back).

## Satisfying-feel feedback: progress tone, PERFECT popup, LOCKED badge, chrome nozzle

Added in response to feedback that striping needed to feel more "ASMR,
satisfying and arcadey" — a sense of accomplishment for nailing the line, not
just a percentage ticking up silently.

- **Rising-pitch "connection" tone while painting onto the reference line.**
  `RigAudio.setProgressTone(active, completionFraction)` drives two oscillators
  (a sine fundamental + a triangle a fifth above, both pre-created and started
  once in `start()` — oscillators can't be restarted after `stop()`, so they're
  modulated forever via `setTargetAtTime` rather than recreated). Frequency
  rises from 320Hz to 1000Hz as `completionFraction` climbs toward 1 (the
  whole-job percentage, not a per-stripe reset) and gain ramps to 0 the instant
  `active` goes false. `active` is keyed off `CoverageTracker.recordSpray`'s
  `newlyCovered > 0` — i.e. the tone only sounds while genuinely making new
  progress, not just while the spacebar is held over already-painted ground.
- **Big score panel, top-right (`hud-score-panel` in `hud.ts`/`style.css`).**
  Replaced the old small inline completion text entirely. Large glowing
  percentage (`hud-score-percent`) gets a quick scale-bump animation
  (remove-class → force reflow via `offsetWidth` → re-add class, the same
  restart trick used by `flashPerfect` below) every time the displayed
  percentage increases, plus a progress bar underneath.
- **"PERFECT!" popup (`CoverageTracker.recordSpray` → `perfectStreak.ts` →
  `JobSiteScene.consumePerfectTrigger()` → `Hud.flashPerfect()`).**
  `recordSpray` returns `{ newlyCovered, lineDistanceFt }` —
  `lineDistanceFt` is the **perpendicular distance to the nearest required
  line *segment*, not to a discrete sample dot.** This distinction mattered: an
  earlier version measured distance to the nearest sample point, which is
  bounded below by roughly half the sample spacing (~0.5ft at the default
  1ft spacing) even when driving dead-on the line — so a tight precision
  threshold (0.05ft) was nearly unreachable no matter how accurately the
  player drove. Perpendicular-to-segment distance is unaffected by sample
  spacing and actually measures what "nailing the line" means.
  `perfectStreak.ts`'s `updatePerfectStreak` requires 5 **consecutive precise
  new-coverage events** (`PERFECT_PRECISION_FT = 0.05`, `STREAK_LENGTH_NEEDED
  = 5`) before triggering — deliberately not one celebration per precise hit,
  which at 60fps while carefully tracking a line would spam constantly.
  **Non-obvious subtlety:** "consecutive" does NOT mean every single
  `recordSpray` call in a row — at 60fps, a given sample only crosses into
  capture radius on one frame; every other frame along a dead-on pass has
  `newlyCovered === 0` simply because there's nothing new left nearby to
  cover, not because the player did anything wrong. So a frame with
  `newlyCovered === 0` only breaks the streak if it's *also* off-line;
  if still on-line it's neutral (preserves the streak without advancing it).
  Getting this wrong (treating every zero-progress frame as a break) makes
  the streak reset almost every tick and the popup effectively unreachable —
  verified this exact failure mode via a live browser test before fixing it
  (coverage climbed normally but the popup never once fired), then confirmed
  the fix with an isolated Node test simulating continuous 60fps-granularity
  spraying (not just one call per sample) — both the original
  nearest-sample-distance bug and this consecutive-frames bug need a
  continuous/high-frequency simulation to catch; a test that calls
  `recordSpray` once per sample (matching sample spacing exactly) won't
  reproduce either.
- **LOCKED badge (`hud-lock-badge`, top-center).** Unlike `flashPerfect`'s
  one-shot animation, this just mirrors `JobSiteScene.isLocked()` every frame
  via `Hud.setLocked(boolean)` (same "poll a getter once per frame in
  `main.ts`" pattern as `completionFraction`) — visible exactly while the
  hitch is locked straight, gone the instant a steering hold breaks it. Shows
  a small "WHEEL" label stacked above the lock text.
- **Nozzle housing finish.** The spray gun housing (`buildNozzleArmAssembly` in
  `vehicleMesh.ts`) was flat near-black (`0x222222`, no metalness) — first
  changed to a fully-metallic polished chrome (`metalness: 1, roughness: 0.08`)
  for visibility, then dialed back to a painted-plastic orange
  (`NOZZLE_HOUSING_COLOR = 0xe8622a`, `metalness: 0.1, roughness: 0.45`,
  matching real Graco-style spray gun housings) after the chrome version read
  as too reflective/distracting in motion. `JobSiteScene`'s constructor still
  takes the `THREE.WebGLRenderer` and builds a `scene.environment` via
  `PMREMGenerator` + three's `RoomEnvironment` addon
  (`three/examples/jsm/environments/RoomEnvironment.js`) — a pure-metal PBR
  material with nothing to reflect just looks flat/dark, and other metal
  parts (handlebars, arm brackets, hitch bar) still rely on it even though
  the nozzle itself no longer does.

## Future: drive-to-job-site phase (design notes only — not implemented)

A third phase, between loading the truck in the yard and arriving at the job
site: **driving the truck to the job**, inserted after "Start Job" and before
the over-the-shoulder striping phase. Explicitly design notes only — do not
build this yet, just keep the design coherent with everything else here so
it's ready to pick up later.

- **3D, with a minimap for the route.** Presumably a third camera mode
  distinct from the yard's top-down and the job site's over-the-shoulder —
  likely a chase/driving camera behind the truck, with the minimap as a
  separate small UI overlay (HUD element, not a second in-scene camera
  necessarily — e.g. a simple top-down route line rendered to its own small
  canvas or just an abstracted schematic, doesn't need to be a literal
  live-rendered minimap from day one).
- **Hazards along the way:**
  - Potholes — if the player hits one and the striping rig/equipment wasn't
    properly secured (ties back to the yard-phase loading step; may need the
    yard phase to track *how well* something was secured, not just *whether*
    it was loaded, which `getLoadedEquipment()`'s current boolean-per-item
    model doesn't support yet), equipment can come loose/fall off/get
    damaged.
  - Traffic and other random delays.
  - Being a "random hazard" system, this likely wants a seeded RNG (for
    reproducible testing) rather than raw `Math.random()`, and probably
    belongs in `src/core/` as engine-independent "trip event" logic (roll for
    hazards, resolve outcomes) separate from however the engine layer
    renders the drive itself — consistent with how rig physics / paint
    tracking / coverage already keep gameplay rules out of the Three.js
    layer.
- Open questions for whenever this gets built for real: does failing to
  secure equipment have gameplay stakes beyond flavor (lost time, damaged
  equipment needing yard repair/replacement, a de facto score hit)? Does the
  route/minimap ever involve player choice (multiple routes, risk/time
  tradeoffs) or is it just a timed/animated transition with random events
  layered on top?

## Development milestones

- [x] **v0.1 — Playable prototype.** Equipment yard (top-down, click to load
      truck) → Start Job → job site (over-the-shoulder). Drive the buggy+
      striper rig, spray paint that lands correctly under the nozzle,
      reference stall centerlines (9'x18' stalls, one sample job), live
      completion % tracking.
- [x] **Wet paint + tire tracks.** ~5 minute dry time; driving a wheel
      through wet paint picks it up and leaves fading tire-track marks over
      the next ~20ft. See "Wet paint and tire tracks" above.
- [x] **Satisfying-feel feedback pass.** Rising-pitch progress tone while
      painting onto the reference line, big glowing score panel, "PERFECT!"
      popup for precise line-tracking streaks, LOCKED hitch badge, chrome
      nozzle. See "Satisfying-feel feedback" above.
- [ ] **Tire-track score deduction + cleanup.** Deduct score for tracked-up
      asphalt until the player repaints the contaminated area with black
      paint. Explicitly deferred (not forgotten) — see the "Not yet
      implemented" note under "Wet paint and tire tracks" above for what's
      missing to build it.
- [ ] Real stencils/arrows/handicap symbols as paintable or stamped assets.
- [ ] Measuring tools as an actual yard-phase interaction (not just a loadable
      prop) and a pre-striping layout/marking step on site.
- [ ] Obstacles: curbs, islands, parked cars, uneven pavement.
- [ ] Multiple jobs / job selection, beyond the single sample job.
- [ ] Imported GLB models for rig/equipment instead of procedural primitives.
- [ ] Walk-behind striper (detached from buggy) as a separate playable mode.
- [ ] Warehouse/factory/loading-dock location types beyond parking lots.
- [ ] Scoring/accuracy grading against the required layout (coverage % exists;
      accuracy of line straightness/width does not yet).
- [ ] **Drive-to-job-site phase** (3D, minimap, hazards like potholes/
      unsecured-equipment damage, traffic delays). Design notes only so far
      — see "Future: drive-to-job-site phase" above. Not started.

## Coding conventions

- `tsconfig.json` has `erasableSyntaxOnly: true` — no TS enums, no
  constructor parameter-property shorthand, no namespaces. Use string literal
  union types instead of enums.
- `verbatimModuleSyntax: true` — type-only imports must use `import type` (or
  inline `type` modifiers on named imports).
- `noUnusedLocals`/`noUnusedParameters` are on. Prefix intentionally-unused
  parameters with `_`.
- 1 Three.js scene unit = 1 foot, everywhere. Don't introduce a different
  scale without updating this doc.
- Default to no code comments; add one only where the *why* isn't obvious
  from the code itself (this doc is the place for broader rationale).
