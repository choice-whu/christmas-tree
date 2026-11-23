import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildPrintMarkup,
  listPhotoFiles,
  readImageSizeFromBuffer,
  replacePhotosBlock,
  syncPhotos,
} from '../scripts/sync-photos.mjs';

test('listPhotoFiles sorts naturally and ignores dotfiles, dirs, and non-images', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-photos-list-'));
  try {
    await fs.writeFile(path.join(dir, '10.jpg'), 'x');
    await fs.writeFile(path.join(dir, '2.JPG'), 'x');
    await fs.writeFile(path.join(dir, '1.png'), 'x');
    await fs.writeFile(path.join(dir, '圣诞 合照.webp'), 'x');
    await fs.writeFile(path.join(dir, '.hidden.jpg'), 'x');
    await fs.writeFile(path.join(dir, 'notes.txt'), 'x');
    await fs.mkdir(path.join(dir, 'nested.jpg'));

    const missing = await listPhotoFiles(path.join(dir, 'missing'));
    assert.deepEqual(missing, []);

    const files = await listPhotoFiles(dir);
    assert.deepEqual(files, ['1.png', '2.JPG', '10.jpg', '圣诞 合照.webp']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('buildPrintMarkup encodes spaces/Chinese filenames and supports missing thumbnails', () => {
  const markup = buildPrintMarkup([
    { id: '1', fileName: '冬日 合照 & 1.jpg', thumbFileName: '冬日 合照 & 1.webp', width: 384, height: 480 },
    { id: '2', fileName: 'two.png', thumbFileName: null, width: 640, height: 800 },
  ], '  ');

  assert.match(markup, /href="\.\/photos\/%E5%86%AC%E6%97%A5%20%E5%90%88%E7%85%A7%20%26%201\.jpg"/);
  assert.match(markup, /src="\.\/assets\/thumbs\/%E5%86%AC%E6%97%A5%20%E5%90%88%E7%85%A7%20%26%201\.webp"/);
  assert.match(markup, /src="\.\/photos\/two\.png"/);
  assert.match(markup, /width="640" height="800"/);
  assert.equal(buildPrintMarkup([]), '');
});

test('replacePhotosBlock is idempotent and handles empty lists', () => {
  const template = [
    '<div class="prints">',
    '  <!-- PHOTOS:START -->',
    '  <a href="stale">stale</a>',
    '  <!-- PHOTOS:END -->',
    '</div>',
  ].join('\n');

  const markup = buildPrintMarkup([{ id: '1', fileName: 'a.jpg', thumbFileName: 'a.webp', width: 320, height: 400 }], '  ');
  const first = replacePhotosBlock(template, markup);
  const second = replacePhotosBlock(first, markup);
  assert.equal(first, second);
  assert.ok(!first.includes('stale'));
  assert.ok(first.includes('a.webp'));

  const cleared = replacePhotosBlock(first, '');
  assert.equal(
    cleared,
    ['<div class="prints">', '  <!-- PHOTOS:START -->', '  <!-- PHOTOS:END -->', '</div>'].join('\n')
  );

  assert.throws(() => replacePhotosBlock('<div></div>', markup), /PHOTOS:START/);
});

test('readImageSizeFromBuffer reads PNG, GIF, JPEG, WebP (VP8/VP8L/VP8X) and falls back safely', () => {
  // PNG 640x480
  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(640, 16);
  png.writeUInt32BE(480, 20);
  assert.deepEqual(readImageSizeFromBuffer(png), { width: 640, height: 480 });

  // GIF 120x90
  const gif = Buffer.alloc(12);
  gif.write('GIF89a', 0, 'ascii');
  gif.writeUInt16LE(120, 6);
  gif.writeUInt16LE(90, 8);
  assert.deepEqual(readImageSizeFromBuffer(gif), { width: 120, height: 90 });

  // JPEG APP0 + SOF0 (960x1200)
  const jpeg = Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x04, 0xb0, 0x03, 0xc0, 0x03, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
  assert.deepEqual(readImageSizeFromBuffer(jpeg), { width: 960, height: 1200 });

  // WebP VP8 lossy (384x480)
  const vp8 = Buffer.alloc(30);
  vp8.write('RIFF', 0, 'ascii');
  vp8.write('WEBP', 8, 'ascii');
  vp8.write('VP8 ', 12, 'ascii');
  vp8[23] = 0x9d; vp8[24] = 0x01; vp8[25] = 0x2a;
  vp8.writeUInt16LE(384, 26);
  vp8.writeUInt16LE(480, 28);
  assert.deepEqual(readImageSizeFromBuffer(vp8), { width: 384, height: 480 });

  // WebP VP8L lossless (512x256)
  const vp8l = Buffer.alloc(25);
  vp8l.write('RIFF', 0, 'ascii');
  vp8l.write('WEBP', 8, 'ascii');
  vp8l.write('VP8L', 12, 'ascii');
  vp8l[20] = 0x2f;
  vp8l.writeUInt32LE((512 - 1) | ((256 - 1) << 14), 21);
  assert.deepEqual(readImageSizeFromBuffer(vp8l), { width: 512, height: 256 });

  // WebP VP8X extended (800x1000)
  const vp8x = Buffer.alloc(30);
  vp8x.write('RIFF', 0, 'ascii');
  vp8x.write('WEBP', 8, 'ascii');
  vp8x.write('VP8X', 12, 'ascii');
  const wMinus1 = 800 - 1;
  const hMinus1 = 1000 - 1;
  vp8x[24] = wMinus1 & 0xff; vp8x[25] = (wMinus1 >> 8) & 0xff; vp8x[26] = (wMinus1 >> 16) & 0xff;
  vp8x[27] = hMinus1 & 0xff; vp8x[28] = (hMinus1 >> 8) & 0xff; vp8x[29] = (hMinus1 >> 16) & 0xff;
  assert.deepEqual(readImageSizeFromBuffer(vp8x), { width: 800, height: 1000 });

  // Fallback
  assert.deepEqual(readImageSizeFromBuffer(Buffer.from('not-an-image')), { width: 320, height: 400 });
});

test('syncPhotos cleans stale thumbnails, updates index.html, and supports empty folder', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-photos-e2e-'));
  try {
    await fs.mkdir(path.join(root, 'photos'), { recursive: true });
    await fs.mkdir(path.join(root, 'assets', 'thumbs'), { recursive: true });
    await fs.writeFile(path.join(root, 'assets', 'thumbs', 'removed.webp'), 'stale');

    // Valid 1x1 PNG buffer
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    await fs.writeFile(path.join(root, 'photos', '我的 圣诞.png'), tinyPng);
    await fs.writeFile(
      path.join(root, 'index.html'),
      '<div id="prints">\n  <!-- PHOTOS:START -->\n  <!-- PHOTOS:END -->\n</div>\n'
    );

    const first = await syncPhotos(root);
    assert.equal(first.total, 1);
    assert.equal(first.removedThumbs, 1);
    const htmlAfterFirst = await fs.readFile(path.join(root, 'index.html'), 'utf8');
    assert.match(htmlAfterFirst, /%E6%88%91%E7%9A%84%20%E5%9C%A3%E8%AF%9E/);

    const second = await syncPhotos(root);
    assert.equal(second.total, 1);
    assert.equal(second.generatedThumbs, 0);
    assert.equal(second.reusedThumbs, 1);
    assert.equal(second.removedThumbs, 0);

    // Clear photos folder -> clean empty block
    await fs.unlink(path.join(root, 'photos', '我的 圣诞.png'));
    const cleared = await syncPhotos(root);
    assert.equal(cleared.total, 0);
    assert.equal(cleared.removedThumbs, 1);
    const htmlAfterClear = await fs.readFile(path.join(root, 'index.html'), 'utf8');
    assert.equal(htmlAfterClear, '<div id="prints">\n  <!-- PHOTOS:START -->\n  <!-- PHOTOS:END -->\n</div>\n');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
