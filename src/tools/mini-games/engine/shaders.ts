/**
 * WebGL2 着色器源码（GLSL ES 3.00）。
 *
 * M1 采用“发光点精灵 + 加法混合 + 同批放大重绘”的轻量辉光：
 * 不做 FBO/多 pass 后处理（无头软渲染更稳、移动端更省），而是把同一批粒子按
 * 1× / 1.9× / 2.8× 的点尺寸与递减透明度叠画 1~3 次，得到核心 + 双层光晕的霓虹观感。
 * 注意：`#version 300 es` 必须是着色器字符串首行。
 */

export const POINT_VERT = `#version 300 es
precision highp float;
in vec2 a_pos;      // CSS 像素坐标
in float a_size;    // 点半径（CSS 像素）
in float a_hue;     // 色相 0..360
in float a_life;    // 存活比例 0..1
in float a_glow;    // 亮度倍率
uniform vec2 u_res; // 画布 CSS 尺寸
uniform vec2 u_shake;
uniform float u_dpr;
uniform float u_sizeMul;
out float v_hue;
out float v_life;
out float v_glow;
void main() {
  float nx = (a_pos.x + u_shake.x) / u_res.x * 2.0 - 1.0;
  float ny = 1.0 - (a_pos.y + u_shake.y) / u_res.y * 2.0;
  gl_Position = vec4(nx, ny, 0.0, 1.0);
  gl_PointSize = a_size * u_sizeMul * u_dpr * 2.0; // *2 因半径转直径
  v_hue = a_hue;
  v_life = a_life;
  v_glow = a_glow;
}
`

export const POINT_FRAG = `#version 300 es
precision highp float;
in float v_hue;
in float v_life;
in float v_glow;
uniform float u_alphaMul;
out vec4 outColor;

vec3 hsl2rgb(float h, float s, float l) {
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float hp = mod(h / 60.0, 6.0);
  float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
  vec3 rgb;
  if (hp < 1.0) rgb = vec3(c, x, 0.0);
  else if (hp < 2.0) rgb = vec3(x, c, 0.0);
  else if (hp < 3.0) rgb = vec3(0.0, c, x);
  else if (hp < 4.0) rgb = vec3(0.0, x, c);
  else if (hp < 5.0) rgb = vec3(x, 0.0, c);
  else rgb = vec3(c, 0.0, x);
  float m = l - c * 0.5;
  return rgb + vec3(m);
}

void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0; // 0 中心 -> 1 边缘
  if (d > 1.0) discard;
  // 中心亮核 + 外圈饱和辉光：半径越小越亮、越接近暖色白。
  float core = 1.0 - smoothstep(0.0, 0.42, d);
  float halo = 1.0 - smoothstep(0.2, 1.0, d);
  float lightness = 0.5 + 0.28 * core;
  vec3 col = hsl2rgb(v_hue, 1.0, clamp(lightness, 0.0, 0.82));
  // 残生命做淡入淡出（新生稍亮、将灭快速衰减）。
  float fade = clamp(min(v_life * 2.2, 1.0), 0.0, 1.0);
  float a = (core * 0.95 + halo * 0.55) * fade * v_glow * u_alphaMul;
  outColor = vec4(col * (0.6 + core * 0.8), a);
}
`
