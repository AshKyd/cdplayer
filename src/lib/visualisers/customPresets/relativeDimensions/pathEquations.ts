/**
 * Emitter A: particles along a path that eases between a spiral, nested circles, a small star inside a big one and
 * three nested hexagons, each turning at its own speed. The hue runs along the path, so each turn of the spiral is a band of the rainbow.
 */
export const PATH_EQS = `
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
// A shape's radius is in screen heights, so q8 (longer side / height) makes it a fraction of the longer side.
rad = 0.014 * q8 * (1 + q29) * (old_f + (cur_f - old_f) * q3);
`;
