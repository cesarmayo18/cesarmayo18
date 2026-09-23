#!/usr/bin/env node
// Draws assets/santiago.svg: Santiago's skyline in pixel art, using the real time, weather and air quality.
// Usage: node scripts/santiago.mjs [--offline] [--time 21:30] [--weather rain] [--clouds 80] [--aqi 150] [--out file.svg]
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const LAT = -33.45;
const LON = -70.66;
const TZ = 'America/Santiago';
const W = 960;
const H = 320;
const PX = 4;
const HORIZON = 264;
const FONT = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// ---------- pure logic ----------

export function weatherKind(code) {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  return 'clear';
}

const WEATHER_LABEL = {
  clear: 'clear sky', partly: 'partly cloudy', overcast: 'overcast',
  fog: 'fog', rain: 'rain', snow: 'snow', storm: 'thunderstorm',
};

export function aqiLabel(aqi) {
  if (aqi == null) return null;
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'smoggy';
  return 'smog alert';
}

export function toMinutes(iso) {
  const [h, m] = iso.split('T')[1].split(':').map(Number);
  return h * 60 + m;
}

export function phaseOf(min, sunrise, sunset, twilight = 40) {
  if (Math.abs(min - sunrise) <= twilight) return 'dawn';
  if (Math.abs(min - sunset) <= twilight) return 'dusk';
  return min > sunrise && min < sunset ? 'day' : 'night';
}

export function skyArc(min, sunrise, sunset) {
  if (min >= sunrise && min <= sunset) return { body: 'sun', t: (min - sunrise) / (sunset - sunrise) };
  const night = 1440 - sunset + sunrise;
  return { body: 'moon', t: ((min - sunset + 1440) % 1440) / night };
}

// 0 = new moon, 0.5 = full moon.
export function moonPhase(date) {
  const synodic = 29.530588853;
  const days = (date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
  return (((days % synodic) + synodic) % synodic) / synodic;
}

// mulberry32: tiny seeded PRNG so the skyline is stable between renders.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- drawing helpers ----------

const q = (v) => Math.round(v / PX) * PX;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
const rect = (x, y, w, h, fill, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra}/>`;

function pixelDisc(cx, cy, r, colorAt) {
  let out = '';
  for (let dy = -r; dy < r; dy += PX) {
    for (let dx = -r; dx < r; dx += PX) {
      const px = dx + PX / 2;
      const py = dy + PX / 2;
      if (px * px + py * py > r * r) continue;
      const fill = colorAt(px, py);
      if (fill) out += rect(cx + dx, cy + dy, PX, PX, fill);
    }
  }
  return out;
}

function stepped(ys, fill) {
  let d = `M0 ${HORIZON}`;
  ys.forEach((y, i) => { d += `L${i * PX} ${y}L${(i + 1) * PX} ${y}`; });
  return `<path d="${d}L${W} ${HORIZON}Z" fill="${fill}"/>`;
}

function ridge(base, amp, seed, freq, floor = 0) {
  const r = rng(seed);
  const [p1, p2, p3] = [r() * 6, r() * 6, r() * 6];
  return Array.from({ length: W / PX }, (_, i) => {
    const x = i * PX;
    const n = (0.55 * Math.sin(x * freq + p1) + 0.3 * Math.sin(x * freq * 2.3 + p2) + 0.15 * Math.sin(x * freq * 5.1 + p3) + 1) / 2;
    return q(base - amp * (floor + (1 - floor) * n));
  });
}

// ---------- palettes ----------

const PALETTES = {
  night: { skyTop: '#0b1026', skyBottom: '#2b2f5a', far: '#262b52', snow: '#8e96c8', near: '#1c2040', hill: '#161a33', building: '#12152b', buildingAlt: '#181c38', glass: '#1d2a4d', window: '#ffd37a', ground: '#0d0f1f', road: '#1a1d33', text: '#c0caf5', sun: '#ffe38a', cloud: '#3b4066' },
  dawn: { skyTop: '#3b3f78', skyBottom: '#f6a57a', far: '#6d5f8f', snow: '#f3d6e0', near: '#4a4270', hill: '#3a3a5c', building: '#2e2c4a', buildingAlt: '#3a3658', glass: '#6f7fb0', window: '#ffd37a', ground: '#231f35', road: '#2c2842', text: '#fbe3d6', sun: '#ffb86b', cloud: '#f6c1b5' },
  day: { skyTop: '#4a90d9', skyBottom: '#bfe3ff', far: '#7389b0', snow: '#ffffff', near: '#6f8aa8', hill: '#5f7f5a', building: '#5b6b85', buildingAlt: '#6f7f99', glass: '#9cc7e8', window: '#d8ecff', ground: '#2f3a4c', road: '#465164', text: '#eaf2ff', sun: '#ffe38a', cloud: '#ffffff' },
  dusk: { skyTop: '#2d2a6e', skyBottom: '#ff8a5c', far: '#6a4f7a', snow: '#ffc9b0', near: '#48365e', hill: '#3a2f4f', building: '#2a2440', buildingAlt: '#352d4f', glass: '#7a6fa8', window: '#ffc766', ground: '#1f1a2e', road: '#2a2340', text: '#ffe0cc', sun: '#ff9e5e', cloud: '#e59a8c' },
};

const GLOOMY = new Set(['overcast', 'fog', 'rain', 'snow', 'storm']);
const WET = new Set(['rain', 'snow', 'storm']);

function palette(phase, gloomy) {
  const p = { ...PALETTES[phase] };
  if (!gloomy) return p;
  const grey = phase === 'day' ? '#8a93a3' : '#2a2d3d';
  p.skyTop = mix(p.skyTop, grey, 0.65);
  p.skyBottom = mix(p.skyBottom, grey, 0.55);
  p.cloud = mix(p.cloud, grey, 0.5);
  return p;
}

// ---------- layers ----------

function sky(p) {
  const bands = Math.ceil(HORIZON / 16);
  let out = '';
  for (let i = 0; i < bands; i++) out += rect(0, i * 16, W, 16, mix(p.skyTop, p.skyBottom, i / (bands - 1)));
  return out;
}

function stars(phase, s) {
  if (phase === 'day' || s.cloudCover > 75 || GLOOMY.has(s.kind)) return '';
  const r = rng(7);
  const opacity = phase === 'night' ? 1 : 0.35;
  let out = `<g opacity="${opacity}">`;
  for (let i = 0; i < 80; i++) {
    const size = r() < 0.2 ? PX : 2;
    const style = `animation-delay:-${(r() * 4).toFixed(1)}s;animation-duration:${(2 + r() * 3).toFixed(1)}s`;
    out += rect(q(r() * W), q(r() * 170), size, size, '#ffffff', ` class="tw" style="${style}"`);
  }
  return out + '</g>';
}

function celestial(s, phase, p) {
  const arc = skyArc(s.minutes, s.sunrise, s.sunset);
  const cx = q(60 + arc.t * (W - 120));
  const cy = q(HORIZON - 60 - Math.sin(Math.PI * arc.t) * 150);
  const dim = GLOOMY.has(s.kind) ? ' opacity="0.3"' : '';
  if (arc.body === 'sun') {
    return `<g${dim}><g opacity="0.25">${pixelDisc(cx, cy, 28, () => p.sun)}</g>${pixelDisc(cx, cy, 16, () => p.sun)}</g>`;
  }
  // Southern hemisphere: the waxing moon is lit on its left side.
  const k = Math.cos(2 * Math.PI * moonPhase(s.date));
  const waxing = moonPhase(s.date) < 0.5;
  const moon = pixelDisc(cx, cy, 14, (dx, dy) => {
    const edge = k * Math.sqrt(Math.max(0, 196 - dy * dy));
    const lit = waxing ? -dx > edge : -dx < -edge;
    return lit ? '#f4f1de' : '#3a3f66';
  });
  return `<g${dim}><g opacity="0.12">${pixelDisc(cx, cy, 26, () => '#f4f1de')}</g>${moon}</g>`;
}

function clouds(p, s) {
  const n = WET.has(s.kind) || s.kind === 'overcast' ? 9 : Math.round((s.cloudCover / 100) * 7);
  const r = rng(99);
  let out = '';
  for (let i = 0; i < n; i++) {
    const y = q(24 + r() * 110);
    const w = q(56 + r() * 72);
    const dur = (90 + r() * 120).toFixed(0);
    const begin = (r() * dur).toFixed(0);
    const shade = mix(p.cloud, '#000000', 0.18);
    out += `<g opacity="0.92"><animateTransform attributeName="transform" type="translate" from="${-w - 20} ${y}" to="${W + 20} ${y}" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/>`
      + rect(0, 8, w, 12, p.cloud) + rect(q(w * 0.15), 0, q(w * 0.4), 8, p.cloud) + rect(q(w * 0.5), 4, q(w * 0.3), 4, p.cloud)
      + rect(PX, 20, w - PX * 2, PX, shade) + '</g>';
  }
  return out;
}

function andes(p) {
  const base = 200;
  const amp = 110;
  const ys = ridge(base, amp, 11, 0.012, 0.45);
  const snowline = base - amp * 0.68;
  let snow = '';
  ys.forEach((y, i) => {
    if (y < snowline) snow += rect(i * PX, y, PX, q((snowline - y) * 0.6 + PX), p.snow);
  });
  return stepped(ys, p.far) + snow + stepped(ridge(222, 22, 23, 0.02), p.near);
}

function haze(aqi) {
  if (aqi == null || aqi <= 50) return '';
  const opacity = Math.min(0.6, 0.12 + ((aqi - 50) / 150) * 0.48).toFixed(2);
  return `<rect x="0" y="90" width="${W}" height="${HORIZON - 90}" fill="url(#smog)" opacity="${opacity}"/>`;
}

function hillY(x) {
  return q(HORIZON - (84 * Math.exp(-(((x - 250) / 78) ** 2)) + 6 * Math.sin(x * 0.08)));
}

function sanCristobal(p, phase) {
  const ys = Array.from({ length: W / PX }, (_, i) => {
    const x = i * PX;
    return x >= 96 && x < 420 ? Math.min(hillY(x), HORIZON) : HORIZON;
  });
  const r = rng(31);
  let trees = '';
  for (let i = 0; i < 46; i++) {
    const x = q(110 + r() * 290);
    const top = hillY(x) + 8;
    if (top < HORIZON - 8) trees += rect(x, q(top + r() * (HORIZON - top - 8)), PX, PX, mix(p.hill, '#000000', 0.3));
  }
  // La Virgen del San Cristóbal, arms open over the city.
  const x0 = 248;
  const top = hillY(x0);
  const white = phase === 'day' ? '#f4f4f4' : '#fff6d8';
  const glow = phase === 'day' ? '' : `<g opacity="0.25">${pixelDisc(x0 + 2, top - 18, 16, () => '#fff1b8')}</g>`;
  const virgin = glow + rect(x0 - 4, top - 8, 12, 8, mix(p.hill, '#cfd3dc', 0.6))
    + rect(x0, top - 24, PX, 16, white) + rect(x0 - 4, top - 16, 12, PX, white) + rect(x0 - 2, top - 12, 8, PX, white) + rect(x0, top - 28, PX, PX, white);
  return `<g id="san-cristobal">${stepped(ys, p.hill)}${trees}${virgin}</g>`;
}

function windows(x, y, w, h, p, phase, lights, lit = p.window) {
  const chance = { night: 0.33, dawn: 0.15, dusk: 0.18, day: 0 }[phase];
  const dayGlass = mix(p.building, '#ffffff', 0.22);
  let out = '';
  for (let wy = y + 8; wy < y + h - 6; wy += 8) {
    for (let wx = x + 4; wx <= x + w - 8; wx += 8) {
      const roll = lights();
      if (phase === 'day') { if (roll < 0.55) out += rect(wx, wy, PX, PX, dayGlass); } else if (roll < chance) out += rect(wx, wy, PX, PX, lit);
    }
  }
  return out;
}

function costanera(p, phase, lights) {
  const x0 = 690;
  const night = phase !== 'day';
  const dark = mix(p.glass, p.building, 0.45);
  const crown = phase === 'night' ? '#9d7cd8' : dark;
  let out = rect(x0, 72, 44, HORIZON - 72, p.glass) + rect(x0 + 4, 56, 36, 16, p.glass) + rect(x0 + 8, 44, 28, 12, p.glass);
  for (let sx = x0 + 4; sx < x0 + 44; sx += 8) out += rect(sx, 72, PX, HORIZON - 72, dark);
  for (let fx = x0 + 8; fx < x0 + 36; fx += 8) out += rect(fx, fx === x0 + 8 || fx === x0 + 32 ? 32 : 24, PX, 20, crown);
  if (night) {
    for (let fy = 80; fy < HORIZON - 8; fy += 8) {
      for (let fx = x0; fx < x0 + 44; fx += 8) if (lights() < 0.45) out += rect(fx, fy, PX, PX, '#cfe3ff');
    }
  }
  return `<g id="costanera">${out}${rect(x0 + 20, 20, PX, PX, '#ff4d5e', ' class="blink"')}</g>`;
}

function entel(p) {
  const cx = 440;
  return `<g id="torre-entel">${rect(cx - 8, 128, 16, HORIZON - 128, p.buildingAlt)}${rect(cx - 16, 116, 32, 12, p.building)}`
    + `${rect(cx - 12, 112, 24, PX, p.buildingAlt)}${rect(cx - 2, 56, PX, 56, mix(p.building, '#9aa0b8', 0.5))}`
    + `${rect(cx - 2, 52, PX, PX, '#ff4d5e', ' class="blink" style="animation-delay:-.7s"')}</g>`;
}

function titanium(p, phase, lights) {
  const x0 = 575;
  const glass = mix(p.glass, p.building, 0.25);
  let out = '';
  for (let c = 0; c < 10; c++) {
    const top = q(104 - c * 2);
    out += rect(x0 + c * PX, top, PX, HORIZON - top, glass);
  }
  for (let fy = 108; fy < HORIZON; fy += 12) out += rect(x0, fy, 40, PX / 2, mix(glass, p.building, 0.5));
  return `<g id="titanium">${out}${windows(x0, 104, 40, HORIZON - 104, p, phase, lights, '#cfe3ff')}</g>`;
}

function city(p, phase, lights) {
  const r = rng(42);
  let back = '';
  for (let x = 0; x < W;) {
    const w = [24, 32, 40, 48][Math.floor(r() * 4)];
    const max = x < 100 ? 70 : x < 420 ? 30 : x < 560 ? 110 : 130;
    const h = q(24 + r() * max);
    back += rect(x, HORIZON - h, w, h, r() < 0.5 ? p.building : p.buildingAlt) + windows(x, HORIZON - h, w, h, p, phase, lights);
    x += w + (r() < 0.3 ? PX * 2 : 0);
  }
  const f = rng(77);
  const frontColor = mix(p.building, '#000000', 0.25);
  let front = '';
  for (let x = 0; x < W;) {
    const w = q(16 + f() * 24);
    if (f() < 0.6) {
      const h = q(12 + f() * 28);
      front += rect(x, HORIZON - h, w, h, frontColor) + windows(x, HORIZON - h, w, h, { ...p, building: frontColor }, phase, lights);
    }
    x += w + PX;
  }
  return back + entel(p) + titanium(p, phase, lights) + costanera(p, phase, lights) + front;
}

function fog(kind) {
  if (kind !== 'fog') return '';
  return [150, 190, 226].map((y, i) => rect(0, y, W, 28, '#c9ced8', ` opacity="${0.3 + i * 0.1}"`)).join('');
}

function street(p, phase) {
  const lit = phase !== 'day';
  let out = rect(0, HORIZON, W, H - HORIZON, p.ground) + rect(0, HORIZON + 4, W, 16, p.road);
  for (let x = 0; x < W; x += 24) out += rect(x, HORIZON + 11, 12, 2, mix(p.road, '#ffffff', 0.3));
  const cars = [['#f7768e', 1, 17, 0], ['#7aa2f7', 1, 23, 9], ['#e0af68', -1, 19, 4], ['#9ece6a', -1, 26, 15], ['#c0caf5', 1, 21, 13]];
  for (const [color, dir, dur, begin] of cars) {
    const y = dir === 1 ? HORIZON + 12 : HORIZON + 4;
    const [from, to] = dir === 1 ? [-40, W + 40] : [W + 40, -40];
    const head = dir === 1 ? 16 : -4;
    const lights = lit ? rect(head, 4, PX, 2, '#ffe38a') + rect(dir === 1 ? -2 : 16, 4, 2, 2, '#ff4d5e') : '';
    out += `<g><animateTransform attributeName="transform" type="translate" from="${from} ${y}" to="${to} ${y}" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/>`
      + rect(0, 2, 16, 6, color) + rect(4, 0, 8, 3, mix(color, '#000000', 0.3)) + lights + '</g>';
  }
  return out;
}

function precipitation(kind) {
  if (!WET.has(kind)) return '';
  const snow = kind === 'snow';
  const r = rng(5);
  let drops = '';
  for (let i = 0; i < (snow ? 90 : 140); i++) {
    const x = q(r() * W);
    const y = q(r() * H);
    const one = snow ? rect(x, y, PX, PX, '#ffffff') : rect(x, y, 2, 8, '#a9c7ff');
    drops += one + one.replace(`y="${y}"`, `y="${y - H}"`);
  }
  const flash = kind === 'storm' ? rect(0, 0, W, HORIZON, '#ffffff', ' class="flash"') : '';
  return `<g opacity="${snow ? 0.85 : 0.55}" clip-path="url(#air)"><g><animateTransform attributeName="transform" type="translate" from="0 0" to="0 ${H}" dur="${snow ? 7 : 0.8}s" repeatCount="indefinite"/>${drops}</g></g>${flash}`;
}

function caption(p, s) {
  const left = `SANTIAGO DE CHILE · ${s.clock} · ${s.temp}°C · ${WEATHER_LABEL[s.kind].toUpperCase()}`;
  const air = aqiLabel(s.aqi);
  const right = air ? `AIR ${s.aqi} · ${air.toUpperCase()}` : '';
  const attrs = `y="${H - 14}" font-family="${FONT}" font-size="13" letter-spacing="1.5" fill="${p.text}"`;
  return `<text x="16" ${attrs}>${left}</text><text x="${W - 16}" text-anchor="end" ${attrs} opacity="0.7">${right}</text>`;
}

export function render(s) {
  const phase = phaseOf(s.minutes, s.sunrise, s.sunset);
  const p = palette(phase, GLOOMY.has(s.kind));
  const lights = rng(s.seed);
  const label = `Santiago de Chile at ${s.clock}: ${WEATHER_LABEL[s.kind]}, ${s.temp}°C`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" shape-rendering="crispEdges" role="img" aria-label="${label}">`
    + '<style>.tw{animation:tw 3s ease-in-out infinite}@keyframes tw{50%{opacity:.2}}'
    + '.blink{animation:blink 1.4s steps(1) infinite}@keyframes blink{50%{opacity:0}}'
    + '.flash{opacity:0;animation:flash 9s infinite}@keyframes flash{0%,90%,100%{opacity:0}91%{opacity:.85}92%{opacity:0}94%{opacity:.6}95%{opacity:0}}'
    + '@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>'
    + `<defs><linearGradient id="smog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b08a5a" stop-opacity="0"/><stop offset="1" stop-color="#b08a5a"/></linearGradient>`
    + `<clipPath id="air"><rect width="${W}" height="${HORIZON + 20}"/></clipPath></defs>`
    + sky(p) + stars(phase, s) + celestial(s, phase, p) + andes(p) + clouds(p, s) + haze(s.aqi)
    + sanCristobal(p, phase) + city(p, phase, lights) + fog(s.kind) + street(p, phase) + precipitation(s.kind) + caption(p, s)
    + '</svg>';
}

// ---------- I/O ----------

async function fetchJson(url, attempts = 3) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return await res.json();
  } catch (err) {
    if (attempts <= 1) throw err;
    await new Promise((r) => setTimeout(r, 3_000));
    return fetchJson(url, attempts - 1);
  }
}

async function fetchConditions() {
  const query = `latitude=${LAT}&longitude=${LON}&timezone=${encodeURIComponent(TZ)}`;
  const [wx, air] = await Promise.all([
    fetchJson(`https://api.open-meteo.com/v1/forecast?${query}&current=temperature_2m,weather_code,cloud_cover&daily=sunrise,sunset&forecast_days=1`),
    fetchJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${query}&current=us_aqi`).catch(() => null),
  ]);
  return {
    time: wx.current.time, temp: wx.current.temperature_2m, code: wx.current.weather_code,
    cloudCover: wx.current.cloud_cover, sunrise: wx.daily.sunrise[0], sunset: wx.daily.sunset[0],
    aqi: air?.current?.us_aqi ?? null,
  };
}

const OFFLINE = { time: '2026-01-01T13:00', temp: 24, code: 0, cloudCover: 20, sunrise: '2026-01-01T06:40', sunset: '2026-01-01T20:50', aqi: 45 };

async function main() {
  const { values } = parseArgs({
    options: {
      offline: { type: 'boolean' }, time: { type: 'string' }, weather: { type: 'string' },
      clouds: { type: 'string' }, aqi: { type: 'string' },
      out: { type: 'string', default: resolve(dirname(fileURLToPath(import.meta.url)), '../assets/santiago.svg') },
    },
  });
  const c = values.offline ? OFFLINE : await fetchConditions();
  const clock = values.time ?? c.time.split('T')[1].slice(0, 5);
  const svg = render({
    minutes: toMinutes(`T${clock}`), sunrise: toMinutes(c.sunrise), sunset: toMinutes(c.sunset),
    kind: values.weather ?? weatherKind(c.code), cloudCover: values.clouds ? Number(values.clouds) : c.cloudCover,
    temp: Math.round(c.temp), aqi: values.aqi ? Number(values.aqi) : c.aqi, clock, date: new Date(),
    seed: Number(c.time.replace(/\D/g, '').slice(-8)),
  });
  await mkdir(dirname(values.out), { recursive: true });
  await writeFile(values.out, svg);
  console.log(`wrote ${values.out} (${clock}, ${c.temp}°C, code ${c.code}, aqi ${c.aqi})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
