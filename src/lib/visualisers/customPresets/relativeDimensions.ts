import type { ButterchurnPreset } from "../butterchurnPresets";

/** A shape that is switched off. A preset always has four of each. */
const unusedShape = { baseVals: { enabled: 0 }, init_eqs_eel: "", frame_eqs_eel: "" };
const unusedWave = { baseVals: { enabled: 0 }, init_eqs_eel: "", frame_eqs_eel: "", point_eqs_eel: "" };

/**
 * Per-frame state shared with the emitters through `q` variables:
 *  q1 / q2: the path emitter A is on and the one it came from (0 spiral, 1 circle, 2 star, 3 hexagons)
 *  q3: blend from the old path to the new one (0..1)
 *  q4: rotation angle
 *  q5: base hue (0..1), one full rainbow every 20 seconds
 *  q6: how much sound there is (0 silent .. 1 playing), eased, so everything can fall back to a faint glow
 *  q7 / q8: how much to scale an offset from the centre in x and y so circles stay round (the wide side is 1)
 *  q9: how lit the treble row is (0..1), following how busy the treble is
 *  q29: kick, 1 on a hard bass hit and falling away over about a third of a second
 */
const FRAME_EQS = `
period = 8;
phase = time / period;
index = int(phase);
q1 = index % 4;
q2 = (index + 3) % 4;
into = min((phase - index) * period / 1.5, 1);
q3 = into * into * (3 - 2 * into);

// Butterchurn's levels are relative to a long-term average, so quiet and loud music look alike. Silence shows as
// levels near 0 at first and, once the average has drained (about 30 s), as every level and its average being
// exactly 1, which real music never is.
flat = equal(bass, 1) * equal(mid, 1) * equal(treb, 1) * equal(bass_att, 1);
heard = above(bass + mid + treb, 0.15) * (1 - flat);
energy = energy + (heard - energy) * 0.08;
q6 = energy;

// Hits are measured against a slow average (about half a second) of the groove. Butterchurn's own bass_att follows
// bass within a frame or two, so a kick that takes more than one frame to rise never got above it, and most were missed.
slow_rate = 1 - pow(0.94, 30 / max(fps, 10));
bass_slow = bass_slow + (bass - bass_slow) * slow_rate;

// Kick: jumps to the strength of a bass hit and decays fast, so the main shape can flare on the beat rather than
// follow the bass level. It also holds the trails longer and pushes the zoom, so the flare streaks outward.
// The threshold is low so soft kicks count, and the flare grows with how far the hit is above the groove: a ratio of
// 1.15 gives a small flare, 1.4 or more a full one, so chance wobble in the bass barely shows.
kick_hit = above(bass, bass_slow * 1.15) * above(bass, 0.5) * above(energy, 0.3) * above(time - last_kick, 0.15);
last_kick = if(kick_hit, time, last_kick);
kick = max(kick * pow(0.86, 30 / max(fps, 10)), kick_hit * min(max((bass / max(bass_slow, 0.2) - 1) * 2.5, 0.3), 1));
q29 = kick;
decay = 0.93 + 0.04 * kick;
zoom = 1.025 + 0.02 * kick;

rot_acc = rot_acc + (0.1 + 0.3 * energy + 0.5 * bass_att * energy) / max(fps, 10);
q4 = rot_acc;

hue = time * 0.05;
q5 = hue - int(hue);

// Offsets from the centre are in units of the shorter side, so the x and y of a wide window scale differently.
// Left unset (0), every particle lands in the middle.
q7 = aspecty;
q8 = aspectx;

// The row of emitters follows how busy the treble is (cymbals, hats and the like). Butterchurn's treb is already
// relative to the track's own long-term average, so above 1 means louder than usual. The drive jumps up quickly and
// eases down more slowly, and is multiplied by the sound level so silence leaves the row dark.
treb_target = min(max((treb - 1) * 2.5, 0), 1) * energy;
treb_drive = treb_drive + (treb_target - treb_drive) * if(above(treb_target, treb_drive), 0.5, 0.15);
q9 = treb_drive;
`;

/**
 * Emitter A: particles along a path that eases between a spiral, nested circles, a small star inside a big one and
 * three nested hexagons, each turning at its own speed. The hue runs along the path, so each turn of the spiral is a band of the rainbow.
 */
const PATH_EQS = `
k = instance / num_inst;

pa0 = k * 18.85;
pr0 = 0.04 + 0.34 * k;
// The circle is drawn three times over, at a third, two thirds and full size, so it fills the middle instead of
// leaving a hole. Each third of the particles makes one lap.
layer = int(k * 3);
lap = k * 3 - layer;
pa1 = lap * 6.283;
pr1 = 0.26 * (layer + 1) / 3;

// The star is two stars: the first 40% of the particles make a small one (0.45 size, particles 0.55 size) in the
// middle, the rest a full-size one around it.
inner = below(k, 0.4);
pa2 = (inner * k / 0.4 + (1 - inner) * (k - 0.4) / 0.6) * 6.283;
pr2 = (0.22 + 0.1 * cos(5 * pa2)) * (inner * 0.45 + (1 - inner) * 1);

// The hexagons are three nested ones. A regular hexagon is a circle stretched out to its corners: at an angle th
// into one of its six sixty-degree sides the radius is the distance to the side (0.866 of the corner radius)
// divided by cos of how far th is from the middle of that side.
pa3 = lap * 6.283;
th = pa3 - 1.0472 * int(pa3 / 1.0472);
pr3 = 0.28 * (layer + 1) / 3 * 0.866 / cos(th - 0.5236);

// How big the particles are on each path, relative to the usual size.
pf0 = 1;
pf1 = 1;
pf2 = inner * 0.55 + (1 - inner) * 1;
pf3 = 0.9;

// How fast each path turns, as a multiple of the rotation in q4. The star is slow. The three hexagons turn at
// three speeds: the inner one fast, the middle one at the base speed the other way, the outer one at half.
hex_speed = if(equal(layer, 0), 2, if(equal(layer, 1), -1, 0.5));
ps0 = q4;
ps1 = q4;
ps2 = q4 * 0.35;
ps3 = q4 * hex_speed;

cur_a = equal(q1, 0) * pa0 + equal(q1, 1) * pa1 + equal(q1, 2) * pa2 + equal(q1, 3) * pa3;
cur_r = equal(q1, 0) * pr0 + equal(q1, 1) * pr1 + equal(q1, 2) * pr2 + equal(q1, 3) * pr3;
cur_f = equal(q1, 0) * pf0 + equal(q1, 1) * pf1 + equal(q1, 2) * pf2 + equal(q1, 3) * pf3;
cur_s = equal(q1, 0) * ps0 + equal(q1, 1) * ps1 + equal(q1, 2) * ps2 + equal(q1, 3) * ps3;
old_a = equal(q2, 0) * pa0 + equal(q2, 1) * pa1 + equal(q2, 2) * pa2 + equal(q2, 3) * pa3;
old_r = equal(q2, 0) * pr0 + equal(q2, 1) * pr1 + equal(q2, 2) * pr2 + equal(q2, 3) * pr3;
old_f = equal(q2, 0) * pf0 + equal(q2, 1) * pf1 + equal(q2, 2) * pf2 + equal(q2, 3) * pf3;
old_s = equal(q2, 0) * ps0 + equal(q2, 1) * ps1 + equal(q2, 2) * ps2 + equal(q2, 3) * ps3;

// The spin is blended along with the shape, so changing path never makes the picture jump.
ang = old_a + (cur_a - old_a) * q3 + old_s + (cur_s - old_s) * q3;
// Overall size of the path (1 = the full size the three paths are written at). Smaller fills the middle of the screen.
size = 0.65;
dist = (old_r + (cur_r - old_r) * q3) * size;
x = 0.5 + dist * cos(ang) * q7;
y = 0.5 + dist * sin(ang) * q8;

// Bass lifts the emission and nudges the hue (at most 0.06 of the colour wheel either way).
punch = min(max(bass * 0.5, 0), 1);
shift = min(max(bass - 1, -1), 1) * 0.06;

h = q5 + 0.15 * k + shift;
h = h - int(h);
r = min(max(0.5 + 0.7 * sin(6.283 * h), 0), 1);
g = min(max(0.5 + 0.7 * sin(6.283 * (h + 0.3333)), 0), 1);
b = min(max(0.5 + 0.7 * sin(6.283 * (h + 0.6667)), 0), 1);

// Soft glow: bright centre, transparent edge. The shape keeps its size; the bass level lifts how much it emits and
// each hard hit (q29) takes it to full. With no sound it falls back to 12%.
a = min((0.35 + 0.3 * punch + 0.65 * q29) * (0.12 + 0.88 * q6), 1);
r2 = r; g2 = g; b2 = b; a2 = 0;
// Doubles at the peak of a heavy kick (q29 = 1) and settles back within about a third of a second.
rad = 0.014 * (1 + q29) * (old_f + (cur_f - old_f) * q3);
`;

/**
 * Emitter B: two rings of emitters, each evenly spaced round a circle and turning, drawn in the warp pass (the pass
 * that carries the previous frame forward) so they get the same zoom, twist and fade as the main shape, in one draw
 * instead of hundreds of shapes. Both rings light up with the treble, and each emitter flickers on its own, like a
 * cymbal wash.
 *
 * An emitter emits one point at a time: a dot where it is now, every frame. The zoom and twist of the feedback pass
 * carry the earlier dots outward, which is what makes the trails, the same as for the main shape. A ring's distance
 * from the centre swings on a sine wave (the outer ring) or a cosine wave (the inner), so the emitters wander in and
 * out. The outer ring turns steadily, so its dots trace lines. The inner ring jumps to a new random angle twenty
 * times a second, so its dots land all round and the zoom spreads each into a star-like burst.
 *
 * The emitters of a ring are identical, turned by whole sectors, so the shader turns a pixel back into the sector of
 * the nearest emitter and measures from that one, however many there are.
 */
const WARP_SHADER = `
const float TAU = 6.2831853;
// Radius of an emitter's dot, in screen heights.
const float SIZE = 0.0075;

vec3 rainbow(float hue) {
  return clamp(0.5 + 0.7 * sin(TAU * (hue + vec3(0.0, 0.33333, 0.66667))), 0.0, 1.0);
}

float jitter(float seed) {
  return fract(abs(sin(seed * 91.7 + 5.1) * 43758.5453));
}

// One ring. p: the pixel, in the same units and orientation as the shapes' x and y offsets from the centre.
// angle: which way emitter 0 points right now, in radians (positive is counterclockwise on screen). orbit: distance of
// the emitters from the centre right now.
vec3 emitterRing(vec2 p, float drive, float count, float orbit, float angle, float hue) {
  if (drive < 0.003) return vec3(0.0);

  float sector = TAU / count;
  // Which emitter is nearest this pixel (counting from emitter 0), and the pixel turned back into emitter 0's sector.
  float emitter = floor((atan(p.y, p.x) - angle) / sector + 0.5);
  float turn = emitter * sector;
  vec2 local = vec2(cos(turn) * p.x + sin(turn) * p.y, -sin(turn) * p.x + cos(turn) * p.y);

  // p is in units of the shorter side, so turning it into screen heights (the unit of the shapes' radius) only
  // needs the ratio of the shorter side to the height.
  float dist = length(local - orbit * vec2(cos(angle), sin(angle))) * min(texsize.x, texsize.y) / texsize.y;
  if (dist >= SIZE) return vec3(0.0);

  // Each emitter flickers on its own, eight times a second.
  float flicker = 0.15 + 0.85 * step(0.4, jitter(mod(emitter, count) * 7.0 + floor(time * 8.0)));
  return rainbow(fract(q5 + hue)) * (drive * flicker * (1.0 - dist / SIZE));
}

shader_body {
  // Same as the default warp pass: the previous frame, carried forward and faded.
  ret = texture(sampler_main, uv).rgb * decay;

  // The shapes count y down from the top; uv_orig counts up from the bottom.
  vec2 p = vec2(uv_orig.x - 0.5, 0.5 - uv_orig.y) / vec2(q7, q8);
  // The drive (q9) already includes the sound level. The outer ring (24 emitters) turns steadily counterclockwise and
  // its distance follows a sine wave. The inner ring (16) jumps to a random angle twenty times a second and its
  // distance follows a cosine wave. With the main shape's hue the three sit a third of the colour wheel apart.
  float wave = 0.8 * time;
  float scatter = TAU * jitter(floor(time * 20.0) + 3.0);
  ret += emitterRing(p, q9, 24.0, 0.34 + 0.06 * sin(wave), 0.30 * time, 0.6667);
  ret += emitterRing(p, q9, 16.0, 0.20 + 0.05 * cos(wave), scatter, 0.3333);
}
`;

/**
 * "Relative dimensions": complementary-colour particles flying into a spiral. The picture is fed back on itself with a slight zoom
 * and twist (`zoom`, `rot`, `decay`), so every particle is dragged inward along a spiral and fades.
 */
export const RELATIVE_DIMENSIONS: ButterchurnPreset = {
  version: 2,
  baseVals: {
    zoom: 1.025,
    rot: 0.012,
    decay: 0.93,
    gammaadj: 1.2,
    wrap: 0,
    warp: 0,
    wave_a: 0,
    ob_a: 0,
    ib_a: 0,
    mv_a: 0,
  },
  shapes: [
    {
      baseVals: { enabled: 1, sides: 8, additive: 1, num_inst: 192, border_a: 0 },
      init_eqs_eel: "",
      frame_eqs_eel: PATH_EQS,
    },
    unusedShape,
    unusedShape,
    unusedShape,
  ],
  waves: [unusedWave, unusedWave, unusedWave, unusedWave],
  init_eqs_eel: "",
  frame_eqs_eel: FRAME_EQS,
  pixel_eqs_eel: "",
  warp: WARP_SHADER,
  comp: "",
};
