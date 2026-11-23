import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);
const NATURAL_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const FALLBACK_SIZE = { width: 320, height: 400 };
const MAX_THUMB_EDGE = 480;

const PHOTOS_START = '<!-- PHOTOS:START -->';
const PHOTOS_END = '<!-- PHOTOS:END -->';

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export async function listPhotoFiles(photosDir) {
  let entries;
  try {
    entries = await fs.readdir(photosDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  return entries
    .filter(entry => entry.isFile() && !entry.name.startsWith('.') && PHOTO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map(entry => entry.name)
    .sort((a, b) => NATURAL_COLLATOR.compare(a, b));
}

export function readImageSizeFromBuffer(buf) {
  if (!buf || buf.length < 12) return { ...FALLBACK_SIZE };

  // PNG
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width > 0 && height > 0) return { width, height };
  }

  // GIF
  if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') {
    const width = buf.readUInt16LE(6);
    const height = buf.readUInt16LE(8);
    if (width > 0 && height > 0) return { width, height };
  }

  // WebP
  if (buf.length >= 25 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8 ' && buf.length >= 30 && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
      const width = buf.readUInt16LE(26) & 0x3fff;
      const height = buf.readUInt16LE(28) & 0x3fff;
      if (width > 0 && height > 0) return { width, height };
    }
    if (chunk === 'VP8L' && buf.length >= 25 && buf[20] === 0x2f) {
      const bits = buf.readUInt32LE(21);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      if (width > 0 && height > 0) return { width, height };
    }
    if (chunk === 'VP8X' && buf.length >= 30) {
      const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      if (width > 0 && height > 0) return { width, height };
    }
  }

  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 3 < buf.length) {
      while (offset < buf.length && buf[offset] === 0xff) offset++;
      if (offset >= buf.length) break;
      const marker = buf[offset++];
      if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS
      if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 1 >= buf.length) break;
      const length = buf.readUInt16BE(offset);
      if (length < 2 || offset + length > buf.length) break;
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof && length >= 7) {
        const height = buf.readUInt16BE(offset + 3);
        const width = buf.readUInt16BE(offset + 5);
        if (width > 0 && height > 0) return { width, height };
      }
      offset += length;
    }
  }

  return { ...FALLBACK_SIZE };
}

export async function readImageSize(input) {
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    return readImageSizeFromBuffer(Buffer.from(input));
  }
  const handle = await fs.open(input, 'r');
  try {
    const stat = await handle.stat();
    const bytesToRead = Math.min(stat.size, 262144);
    const buf = Buffer.alloc(bytesToRead);
    await handle.read(buf, 0, bytesToRead, 0);
    return readImageSizeFromBuffer(buf);
  } finally {
    await handle.close();
  }
}

export function buildPrintMarkup(entries, indent = '        ') {
  if (!entries.length) return '';
  return entries
    .map((entry, idx) => {
      const id = String(entry.id ?? idx + 1);
      const href = `./photos/${encodeURIComponent(entry.fileName)}`;
      const thumbSrc = entry.thumbFileName
        ? `./assets/thumbs/${encodeURIComponent(entry.thumbFileName)}`
        : href;
      const num = idx + 1;
      const width = entry.width || FALLBACK_SIZE.width;
      const height = entry.height || FALLBACK_SIZE.height;
      return (
        `${indent}<a class="print" data-photo-id="${escapeHtml(id)}" href="${escapeHtml(href)}" aria-label="查看第 ${num} 张照片">` +
        `<img src="${escapeHtml(thumbSrc)}" alt="相册照片 ${num}" loading="lazy" decoding="async" width="${width}" height="${height}">` +
        '</a>'
      );
    })
    .join('\n');
}

export function replacePhotosBlock(html, markup) {
  const startIdx = html.indexOf(PHOTOS_START);
  const endIdx = html.indexOf(PHOTOS_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`在 index.html 中未找到 ${PHOTOS_START} / ${PHOTOS_END} 标记。`);
  }
  const lineStart = html.lastIndexOf('\n', startIdx);
  const indent = lineStart === -1 ? '' : html.slice(lineStart + 1, startIdx);
  const before = html.slice(0, startIdx + PHOTOS_START.length);
  const after = html.slice(endIdx);
  const body = markup ? `\n${markup}\n${indent}` : `\n${indent}`;
  return `${before}${body}${after}`;
}

function detectPythonPillow() {
  for (const cmd of ['python3', 'python']) {
    const probe = spawnSync(cmd, ['-c', 'import PIL.Image, PIL.ImageOps'], { stdio: 'ignore' });
    if (probe.status === 0) return cmd;
  }
  return null;
}

function detectSips() {
  if (process.platform !== 'darwin') return false;
  const probe = spawnSync('sips', ['--version'], { stdio: 'ignore' });
  return probe.status === 0;
}

function detectPowerShell() {
  if (process.platform !== 'win32') return false;
  const probe = spawnSync('powershell', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Drawing'], { stdio: 'ignore' });
  return probe.status === 0;
}

function generateThumbWithPython(pythonCmd, srcPath, dstPath) {
  const code = [
    'import sys',
    'from PIL import Image, ImageOps',
    'src, dst, edge = sys.argv[1], sys.argv[2], int(sys.argv[3])',
    'with Image.open(src) as im:',
    '    im = ImageOps.exif_transpose(im)',
    '    if im.mode not in ("RGB", "RGBA"):',
    '        im = im.convert("RGB")',
    '    im.thumbnail((edge, edge), Image.Resampling.LANCZOS)',
    '    im.save(dst, "WEBP", quality=80, method=6)',
  ].join('\n');
  const res = spawnSync(pythonCmd, ['-c', code, srcPath, dstPath, String(MAX_THUMB_EDGE)], { stdio: 'pipe' });
  return res.status === 0;
}

function generateThumbWithSips(srcPath, dstPath) {
  const res = spawnSync('sips', ['-s', 'format', 'jpeg', '-Z', String(MAX_THUMB_EDGE), srcPath, '--out', dstPath], { stdio: 'pipe' });
  return res.status === 0;
}

function generateThumbWithPowerShell(srcPath, dstPath) {
  const script = [
    'Add-Type -AssemblyName System.Drawing',
    '$src = $env:SYNC_SRC; $dst = $env:SYNC_DST; $edge = [int]$env:SYNC_EDGE',
    '$img = [System.Drawing.Image]::FromFile($src)',
    'try {',
    '  $scale = [Math]::Min(1.0, $edge / [Math]::Max($img.Width, $img.Height))',
    '  $w = [Math]::Max(1, [int][Math]::Round($img.Width * $scale))',
    '  $h = [Math]::Max(1, [int][Math]::Round($img.Height * $scale))',
    '  $bmp = New-Object System.Drawing.Bitmap($w, $h)',
    '  try {',
    '    $g = [System.Drawing.Graphics]::FromImage($bmp)',
    '    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
    '    $g.DrawImage($img, 0, 0, $w, $h)',
    '    $g.Dispose()',
    '    $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Jpeg)',
    '  } finally { $bmp.Dispose() }',
    '} finally { $img.Dispose() }',
  ].join('; ');
  const res = spawnSync('powershell', ['-NoProfile', '-Command', script], {
    env: { ...process.env, SYNC_SRC: srcPath, SYNC_DST: dstPath, SYNC_EDGE: String(MAX_THUMB_EDGE) },
    stdio: 'pipe',
  });
  return res.status === 0;
}

export async function syncPhotos(rootDir = ROOT_DIR) {
  const photosDir = path.join(rootDir, 'photos');
  const thumbsDir = path.join(rootDir, 'assets', 'thumbs');
  const indexPath = path.join(rootDir, 'index.html');

  await fs.mkdir(thumbsDir, { recursive: true });
  const files = await listPhotoFiles(photosDir);

  const expectedStems = new Set(files.map(file => path.parse(file).name));
  const existingThumbs = await fs.readdir(thumbsDir, { withFileTypes: true });
  let removedThumbs = 0;
  for (const item of existingThumbs) {
    if (!item.isFile()) continue;
    const stem = path.parse(item.name).name;
    if (!expectedStems.has(stem)) {
      await fs.unlink(path.join(thumbsDir, item.name));
      removedThumbs++;
    }
  }

  let pythonCmd;
  let hasSips;
  let hasPowerShell;
  let generatedThumbs = 0;
  let reusedThumbs = 0;

  const entries = [];
  for (let i = 0; i < files.length; i++) {
    const fileName = files[i];
    const srcPath = path.join(photosDir, fileName);
    const stem = path.parse(fileName).name;
    const srcStat = await fs.stat(srcPath);

    let thumbFileName = null;
    for (const candidate of [`${stem}.webp`, `${stem}.jpg`]) {
      try {
        const thumbStat = await fs.stat(path.join(thumbsDir, candidate));
        if (thumbStat.mtimeMs >= srcStat.mtimeMs) {
          thumbFileName = candidate;
          reusedThumbs++;
          break;
        }
      } catch {
        // Missing or unreadable thumbnail; regenerate below.
      }
    }

    if (!thumbFileName) {
      if (pythonCmd === undefined) pythonCmd = detectPythonPillow();
      if (pythonCmd) {
        const targetName = `${stem}.webp`;
        if (generateThumbWithPython(pythonCmd, srcPath, path.join(thumbsDir, targetName))) {
          thumbFileName = targetName;
          generatedThumbs++;
        }
      }
      if (!thumbFileName) {
        if (hasSips === undefined) hasSips = detectSips();
        if (hasSips) {
          const targetName = `${stem}.jpg`;
          if (generateThumbWithSips(srcPath, path.join(thumbsDir, targetName))) {
            thumbFileName = targetName;
            generatedThumbs++;
          }
        }
      }
      if (!thumbFileName) {
        if (hasPowerShell === undefined) hasPowerShell = detectPowerShell();
        if (hasPowerShell) {
          const targetName = `${stem}.jpg`;
          if (generateThumbWithPowerShell(srcPath, path.join(thumbsDir, targetName))) {
            thumbFileName = targetName;
            generatedThumbs++;
          }
        }
      }
    }

    const sizeTarget = thumbFileName ? path.join(thumbsDir, thumbFileName) : srcPath;
    const { width, height } = await readImageSize(sizeTarget);
    entries.push({
      id: String(i + 1),
      fileName,
      thumbFileName,
      width,
      height,
    });
  }

  const originalHtml = await fs.readFile(indexPath, 'utf8');
  const startIdx = originalHtml.indexOf(PHOTOS_START);
  const lineStart = startIdx === -1 ? -1 : originalHtml.lastIndexOf('\n', startIdx);
  const indent = lineStart === -1 ? '        ' : originalHtml.slice(lineStart + 1, startIdx);
  const markup = buildPrintMarkup(entries, indent);
  const nextHtml = replacePhotosBlock(originalHtml, markup);
  if (nextHtml !== originalHtml) {
    await fs.writeFile(indexPath, nextHtml, 'utf8');
  }

  return {
    total: entries.length,
    generatedThumbs,
    reusedThumbs,
    removedThumbs,
    fallbackOriginalCount: entries.filter(item => !item.thumbFileName).length,
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  syncPhotos(ROOT_DIR)
    .then(summary => {
      console.log(
        `同步完成：共 ${summary.total} 张照片（新生成缩略图 ${summary.generatedThumbs} 张，复用 ${summary.reusedThumbs} 张，清理旧缩略图 ${summary.removedThumbs} 张` +
        (summary.fallbackOriginalCount ? `，直接使用原图 ${summary.fallbackOriginalCount} 张` : '') +
        '）。'
      );
    })
    .catch(error => {
      console.error('同步照片失败：', error.message);
      process.exit(1);
    });
}
