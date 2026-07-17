// Screenshot a URL into ./temporary screenshots/ with an auto-incremented name.
// Usage: node screenshot.mjs http://localhost:3000 [label]
//        node screenshot.mjs http://localhost:3000 lobby --click=#btn --wait=400
import puppeteer from 'puppeteer';
import { mkdir, readdir, writeFile } from 'node:fs/promises';

const OUT = './temporary screenshots';
const url = process.argv[2] ?? 'http://localhost:3000';
const args = process.argv.slice(3);
const label = args.find((a) => !a.startsWith('--'));
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

const width = Number(flag('width') ?? 1280);
const height = Number(flag('height') ?? 900);
const full = args.includes('--full');

await mkdir(OUT, { recursive: true });

// Next free index, so screenshots are never overwritten.
const existing = await readdir(OUT).catch(() => []);
const next =
  existing
    .map((f) => Number(/^screenshot-(\d+)/.exec(f)?.[1]))
    .filter(Number.isFinite)
    .reduce((max, n) => Math.max(max, n), 0) + 1;

const file = `${OUT}/screenshot-${next}${label ? `-${label}` : ''}.png`;

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width, height, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'networkidle0' });
await page.evaluateHandle('document.fonts.ready');

// Optional: drive the page before capturing.
const nav = flag('nav');
if (nav) await page.evaluate((s) => window.__go?.(s), nav);
const click = flag('click');
if (click) await page.click(click);
const wait = Number(flag('wait') ?? 250);
await new Promise((r) => setTimeout(r, wait));

await page.screenshot({ path: file, fullPage: full });
await browser.close();
console.log(file);
