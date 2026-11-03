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
export const WARP_SHADER = `
const float TAU = 6.2831853;
// Radius of an emitter's dot, in units of the longer side.
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

  // p and SIZE are both in units of the longer side, so dots scale with the larger edge.
  float dist = length(local - orbit * vec2(cos(angle), sin(angle)));
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
