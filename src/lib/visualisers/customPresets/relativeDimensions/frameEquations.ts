/**
 * Per-frame state shared with the emitters through `q` variables:
 *  q1 / q2: the path emitter A is on and the one it came from (0 spiral, 1 circle, 2 star, 3 hexagons)
 *  q3: blend from the old path to the new one (0..1)
 *  q4: rotation angle
 *  q5: base hue (0..1), one full rainbow every 20 seconds
 *  q6: how much sound there is (0 silent .. 1 playing), eased, so everything can fall back to a faint glow
 *  q7 / q8: what to multiply an offset from the centre (in units of the longer side) by, in x and y, to get a fraction of the canvas, so shapes stay round (the longer side's is 1)
 *  q9: how lit the treble row is (0..1), following how busy the treble is
 *  q29: kick, 1 on a hard bass hit and falling away over about a third of a second
 */
export const FRAME_EQS = `
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

// Positions are fractions of the canvas, so a fraction of the width is longer than the same fraction of the height on
// a wide canvas. The longer side over the width and over the height scale an offset (in units of the longer side) to a
// fraction of each side, keeping circles round. They come from pixelsx / pixelsy, not aspectx / aspecty: butterchurn
// only refreshes the aspect values the equations see when a preset loads, so they go stale when the window resizes.
// Left unset (0), every particle lands in the middle.
longer_side = max(pixelsx, pixelsy);
q7 = longer_side / pixelsx;
q8 = longer_side / pixelsy;

// The row of emitters follows how busy the treble is (cymbals, hats and the like). Butterchurn's treb is already
// relative to the track's own long-term average, so above 1 means louder than usual. The drive jumps up quickly and
// eases down more slowly, and is multiplied by the sound level so silence leaves the row dark.
treb_target = min(max((treb - 1) * 2.5, 0), 1) * energy;
treb_drive = treb_drive + (treb_target - treb_drive) * if(above(treb_target, treb_drive), 0.5, 0.15);
q9 = treb_drive;
`;
