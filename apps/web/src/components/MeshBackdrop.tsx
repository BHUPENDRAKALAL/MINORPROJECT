import { useEffect, useRef } from "react";

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

// A grainy mesh gradient (the technique behind Paper's Mesh Gradient): four soft colour spots drift on their
// own slow paths, the space between them is warped by two sine waves, colours blend by inverse distance, and a
// fine film grain sits on top. The pointer gently draws the nearest spot toward it.
const FRAG = `precision highp float;
uniform vec2 res; uniform vec2 mouse; uniform float t; uniform float near;
uniform vec3 c0; uniform vec3 c1; uniform vec3 c2; uniform vec3 c3;

float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main(){
  vec2 uv = gl_FragCoord.xy / res;
  uv.y = 1.0 - uv.y;
  float aspect = res.x / res.y;
  vec2 q = vec2(uv.x * aspect, uv.y);

  // Warp the space with two slow waves, one per axis.
  q.x += 0.06 * sin(q.y * 3.1 + t * 0.21);
  q.y += 0.06 * sin(q.x * 2.7 - t * 0.17);

  vec2 m = vec2(mouse.x / res.x * aspect, mouse.y / res.y);
  vec2 p0 = vec2(0.20 * aspect + 0.10 * sin(t * 0.11), 0.25 + 0.08 * cos(t * 0.13));
  vec2 p1 = vec2(0.80 * aspect + 0.08 * cos(t * 0.09), 0.20 + 0.10 * sin(t * 0.12));
  vec2 p2 = vec2(0.30 * aspect + 0.09 * cos(t * 0.10), 0.85 + 0.06 * sin(t * 0.15));
  vec2 p3 = vec2(0.75 * aspect + 0.10 * sin(t * 0.08), 0.75 + 0.08 * cos(t * 0.10));
  // The pointer leans on the spots a little (strongest on the one nearest to it).
  p0 = mix(p0, m, near * 0.18 * exp(-distance(p0, m) * 2.0));
  p1 = mix(p1, m, near * 0.18 * exp(-distance(p1, m) * 2.0));
  p2 = mix(p2, m, near * 0.18 * exp(-distance(p2, m) * 2.0));
  p3 = mix(p3, m, near * 0.18 * exp(-distance(p3, m) * 2.0));

  // Inverse-distance blend; a higher power gives softer, larger fields.
  float w0 = 1.0 / pow(distance(q, p0) + 0.05, 2.2);
  float w1 = 1.0 / pow(distance(q, p1) + 0.05, 2.2);
  float w2 = 1.0 / pow(distance(q, p2) + 0.05, 2.2);
  float w3 = 1.0 / pow(distance(q, p3) + 0.05, 2.2);
  vec3 col = (c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3) / (w0 + w1 + w2 + w3);

  // Fine film grain that shifts every frame.
  float g = hash(gl_FragCoord.xy + fract(t * 7.0) * 100.0) - 0.5;
  col += g * 0.035;
  gl_FragColor = vec4(col, 1.0);
}`;

function rgb(css: string): [number, number, number] {
  const probe = document.createElement("span");
  probe.style.color = css;
  document.body.appendChild(probe);
  const m = getComputedStyle(probe).color.match(/[\d.]+/g) ?? ["0", "0", "0"];
  probe.remove();
  return [Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255];
}

/**
 * A slow, grainy mesh gradient for the sign-in pages, in the theme's own colours (set as --mesh-1..4 in CSS).
 * Decorative only. Without WebGL the CSS fallback gradient behind it shows. Still for people who prefer
 * reduced motion, paused while the tab is hidden.
 */
export function MeshBackdrop({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const gl = canvas?.getContext("webgl", { antialias: false, premultipliedAlpha: false });
    if (!canvas || !gl) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const U = { res: u("res"), mouse: u("mouse"), t: u("t"), near: u("near"), c0: u("c0"), c1: u("c1"), c2: u("c2"), c3: u("c3") };

    const colours = () => {
      const cs = getComputedStyle(canvas);
      (["c0", "c1", "c2", "c3"] as const).forEach((k, i) => gl.uniform3fv(U[k], rgb(cs.getPropertyValue(`--mesh-${i + 1}`).trim() || "#eee")));
    };
    colours();

    let dpr = 1;
    const resize = () => {
      // A soft gradient needs few pixels; half resolution is invisible and very light on the GPU.
      dpr = Math.min(window.devicePixelRatio || 1, 2) * 0.5;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();

    const target = { x: 0, y: 0, on: 0 };
    const pos = { x: 0, y: 0, near: 0 };
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      target.x = (e.clientX - r.left) * dpr;
      target.y = (e.clientY - r.top) * dpr;
      target.on = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom ? 1 : 0.4;
    };
    const onLeave = () => (target.on = 0);

    let frame = 0;
    let last = 0;
    const start = performance.now();
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 33) return;
      last = now;
      pos.x += (target.x - pos.x) * 0.06;
      pos.y += (target.y - pos.y) * 0.06;
      pos.near += (target.on - pos.near) * 0.04;
      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform2f(U.mouse, pos.x, pos.y);
      gl.uniform1f(U.t, still ? 4 : (now - start) / 1000);
      gl.uniform1f(U.near, pos.near);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    frame = requestAnimationFrame(draw);

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const mo = new MutationObserver(colours);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const onVisible = () => {
      cancelAnimationFrame(frame);
      if (document.visibilityState === "visible") frame = requestAnimationFrame(draw);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisible);
      // Keep the context (StrictMode runs effects twice in development; a lost context can't draw again).
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
