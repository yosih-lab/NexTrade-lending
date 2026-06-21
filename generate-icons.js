// generate-icons.js — run once with: node generate-icons.js
// Requires: npm install canvas
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const OUT = path.join(__dirname, 'icons');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const r = size * 0.12; // corner radius

  // Background
  ctx.fillStyle = '#131722';
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size);
  ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();

  const cx = size / 2, cy = size / 2;
  const pad = size * 0.15;
  const W = size - pad * 2, H = size - pad * 2;

  // Draw candlestick chart (3 candles)
  const candles = [
    { x: 0.18, open: 0.72, close: 0.42, high: 0.32, low: 0.80 },
    { x: 0.50, open: 0.42, close: 0.25, high: 0.18, low: 0.50 },
    { x: 0.82, open: 0.25, close: 0.45, high: 0.20, low: 0.55 },
  ];

  candles.forEach(function(c) {
    const x = pad + c.x * W;
    const y1 = pad + c.high * H;
    const y2 = pad + c.low * H;
    const yt = pad + Math.min(c.open, c.close) * H;
    const yb = pad + Math.max(c.open, c.close) * H;
    const isUp = c.close < c.open;
    const col = isUp ? '#26a69a' : '#ef5350';
    const bw = W * 0.14;

    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1, size * 0.018);
    ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();

    ctx.fillStyle = col;
    ctx.fillRect(x - bw / 2, yt, bw, yb - yt);
  });

  // "N" letter in accent blue
  ctx.fillStyle = '#2962ff';
  ctx.font = `900 ${size * 0.22}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('N', cx, size - pad * 0.4);

  return canvas.toBuffer('image/png');
}

SIZES.forEach(function(s) {
  const buf = drawIcon(s);
  const out = path.join(OUT, `icon-${s}.png`);
  fs.writeFileSync(out, buf);
  console.log('Written:', out);
});
console.log('Done!');
