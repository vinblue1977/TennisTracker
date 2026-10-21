import { formatDate, winPct } from './data';
import type { Recap } from './data';

const W = 1080;
const H = 1350;

/** The season card as a 1080x1350 PNG. */
export async function recapPng(r: Recap): Promise<Blob> {
  await Promise.all(['700 80px "Barlow Condensed"', '600 30px Barlow'].map((f) => document.fonts.load(f)));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('canvas unavailable');
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#1d5a3a');
  g.addColorStop(1, '#173f2a');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  const text = (s: string, x: number, y: number, font: string, color: string) => {
    c.font = font;
    c.fillStyle = color;
    c.fillText(s, x, y);
  };
  const display = (px: number) => `700 ${px}px "Barlow Condensed", sans-serif`;
  const body = (px: number) => `600 ${px}px Barlow, sans-serif`;
  text(`${r.year} SEASON · DOUBLES`, 80, 130, display(48), '#d7f04b');
  text(`${winPct(r)}%`, 80, 420, display(300), '#eef2ec');
  text(`${r.wins}–${r.losses}`, 80, 510, display(90), '#b9d3c2');
  text(`${r.wins + r.losses} matches · ${r.events} ${r.events === 1 ? 'event' : 'events'}`, 80, 580, body(38), '#b9d3c2');
  const tiles: [string, string][] = [
    [r.partner?.name ?? '–', r.partner ? `Best partner · ${r.partner.wins}–${r.partner.losses}` : 'Best partner'],
    [r.upset ? (r.upset.gap ? `+${r.upset.gap.toFixed(2)}` : 'Upset win') : '–', r.upset ? `Biggest upset · w/ ${r.upset.partner}, ${formatDate(r.upset.date)}` : 'Biggest upset'],
    [r.longestWin ? `W${r.longestWin}` : '–', 'Longest win streak'],
    [`${r.winners + r.finalists} ${r.winners + r.finalists === 1 ? 'trophy' : 'trophies'}`, `${r.winners} winner · ${r.finalists} finalist`],
  ];
  tiles.forEach(([big, small], i) => {
    const x = 80 + (i % 2) * 450;
    const y = 680 + Math.floor(i / 2) * 250;
    c.fillStyle = 'rgba(0,0,0,0.22)';
    c.beginPath();
    c.roundRect(x, y, 430, 220, 28);
    c.fill();
    text(big, x + 30, y + 100, display(72), '#eef2ec');
    text(small, x + 30, y + 160, body(28), '#b9d3c2');
  });
  text('Tennis Tracker', 80, 1260, body(30), '#b9d3c2');
  if (r.wtn) {
    c.textAlign = 'right';
    text(`WTN ${r.wtn.from.toFixed(1)} → ${r.wtn.to.toFixed(1)}`, W - 80, 1260, body(30), '#b9d3c2');
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png failed'))), 'image/png'));
}

/** Share sheet where files are supported, else a download. */
export async function shareRecap(blob: Blob, year: string): Promise<void> {
  const file = new File([blob], `season-${year}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) throw e;
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
