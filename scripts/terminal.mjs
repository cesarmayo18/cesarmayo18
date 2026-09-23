#!/usr/bin/env node
// Draws assets/terminal.svg: a terminal that types itself. Edit SESSION and re-run.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Tokyo Night, the LazyVim default.
const C = {
  bg: '#1a1b26', bar: '#16161e', border: '#292e42', fg: '#c0caf5', dim: '#565f89',
  blue: '#7aa2f7', cyan: '#7dcfff', green: '#9ece6a', magenta: '#bb9af7', orange: '#ff9e64', yellow: '#e0af68', red: '#f7768e',
};

// Each output line is a list of [text, color] segments.
const SESSION = [
  { cmd: 'whoami', out: [
    [['cesar mayo', C.fg], [' — software engineer @ ', C.dim], ['fapro', C.magenta]],
    [["santiago, chile · building backends that don't page you at 3am", C.dim]],
  ] },
  { cmd: 'cat stack.yml', out: [
    [['backend:  ', C.blue], ['go, typescript, node, strapi, postgresql', C.fg]],
    [['frontend: ', C.blue], ['react, next.js, react native', C.fg]],
    [['cloud:    ', C.blue], ['aws (lambda, sqs, s3), docker, github actions', C.fg]],
  ] },
  { cmd: 'cat ~/.principles', out: [
    [['→ ', C.green], ['concepts before code', C.fg]],
    [['→ ', C.green], ['clean & hexagonal architecture', C.fg]],
    [['→ ', C.green], ['tests first, then the rest', C.fg]],
  ] },
  { cmd: 'ls ~/side-projects', out: [
    [['truco-club/', C.cyan], ['   ', C.fg], ['restaurant-agent/', C.cyan], ['   ', C.fg], ['this-readme/', C.cyan]],
  ] },
  { cmd: 'echo $CURRENT_FOCUS', out: [
    [['scrapers at scale · event-driven systems · ai agents', C.yellow]],
  ] },
];

const W = 960;
const FONT_SIZE = 15;
const CW = 9; // approximate monospace advance at 15px
const LH = 24;
const PAD = 28;
const TITLE = 36;
const TMUX = 26;
const GAP = 10;
const TYPE_MS = 0.055;
const FONT = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ {2,}/g, (m) => '\u00a0'.repeat(m.length));
const reveal = (t) => `<set attributeName="opacity" to="1" begin="${t.toFixed(2)}s" fill="freeze"/>`;
const spans = (segments) => segments.map(([text, fill]) => `<tspan fill="${fill}">${esc(text)}</tspan>`).join('');

function prompt(y, t) {
  return `<text x="${PAD}" y="${y}" opacity="0">${reveal(t)}<tspan fill="${C.blue}">~</tspan><tspan fill="${C.magenta}"> ❯</tspan></text>`;
}

function typed(cmd, y, t, i) {
  const x = PAD + 4 * CW;
  const n = cmd.length;
  const dur = (n + 1) * TYPE_MS;
  const widths = [...Array(n).keys()].map((k) => k * CW).concat(W).join(';');
  const xs = [...Array(n + 1).keys()].map((k) => x + k * CW).join(';');
  const begin = `${t.toFixed(2)}s`;
  return `<clipPath id="c${i}"><rect x="${x}" y="${y - LH + 6}" width="0" height="${LH}">`
    + `<animate attributeName="width" values="${widths}" calcMode="discrete" begin="${begin}" dur="${dur.toFixed(2)}s" fill="freeze"/></rect></clipPath>`
    + `<text x="${x}" y="${y}" fill="${C.fg}" clip-path="url(#c${i})">${esc(cmd)}</text>`
    + `<rect x="${x}" y="${y - 14}" width="${CW}" height="18" fill="${C.fg}" opacity="0">`
    + `<animate attributeName="x" values="${xs}" calcMode="discrete" begin="${begin}" dur="${dur.toFixed(2)}s" fill="freeze"/>`
    + `<set attributeName="opacity" to="0.8" begin="${begin}"/><set attributeName="opacity" to="0" begin="${(t + dur).toFixed(2)}s" fill="freeze"/></rect>`;
}

function render() {
  let body = '';
  let y = TITLE + PAD + 8;
  let t = 0.5;
  SESSION.forEach(({ cmd, out }, i) => {
    body += prompt(y, t);
    t += 0.35;
    body += typed(cmd, y, t, i);
    t += (cmd.length + 1) * TYPE_MS + 0.25;
    for (const line of out) {
      y += LH;
      body += `<text x="${PAD}" y="${y}" opacity="0">${reveal(t)}${spans(line)}</text>`;
      t += 0.07;
    }
    y += LH + GAP;
    t += 0.6;
  });
  body += prompt(y, t);
  body += `<rect x="${PAD + 4 * CW}" y="${y - 14}" width="${CW}" height="18" fill="${C.fg}" opacity="0">`
    + `<animate attributeName="opacity" values="0.8;0" calcMode="discrete" dur="1.1s" begin="${t.toFixed(2)}s" repeatCount="indefinite"/></rect>`;

  const h = y + PAD - 6 + TMUX;
  const barY = h - TMUX;
  const chrome = `<rect x="0.5" y="0.5" width="${W - 1}" height="${h - 1}" rx="10" fill="${C.bg}" stroke="${C.border}"/>`
    + `<path d="M0.5 ${TITLE}V10.5a10 10 0 0 1 10-10h${W - 21}a10 10 0 0 1 10 10V${TITLE}Z" fill="${C.bar}"/>`
    + [C.red, C.yellow, C.green].map((fill, i) => `<circle cx="${22 + i * 20}" cy="18" r="6" fill="${fill}"/>`).join('')
    + `<text x="${W / 2}" y="23" text-anchor="middle" fill="${C.dim}" font-size="13">cesar@fapro — ~/profile — zsh</text>`
    + `<path d="M0.5 ${barY}H${W - 0.5}V${h - 10.5}a10 10 0 0 1-10 10H10.5a10 10 0 0 1-10-10Z" fill="${C.bar}"/>`
    + `<rect x="0.5" y="${barY}" width="92" height="${TMUX - 0.5}" fill="${C.green}"/>`
    + `<text x="14" y="${barY + 17}" font-size="13" font-weight="bold" fill="${C.bar}">profile</text>`
    + `<text x="108" y="${barY + 17}" font-size="13"><tspan fill="${C.fg}">0:zsh*</tspan><tspan fill="${C.dim}">  1:nvim  2:api</tspan></text>`
    + `<text x="${W - 16}" y="${barY + 17}" font-size="13" text-anchor="end"><tspan fill="${C.dim}">github.com/</tspan><tspan fill="${C.magenta}">cesarmayo18</tspan></text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}" font-family="${FONT}" font-size="${FONT_SIZE}" role="img" aria-label="Terminal: cesar mayo, software engineer at Fapro, Santiago de Chile">`
    + chrome + body + '</svg>';
}

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/terminal.svg');
await mkdir(dirname(out), { recursive: true });
await writeFile(out, render());
console.log(`wrote ${out}`);
