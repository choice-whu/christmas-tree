import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PORT = 8000;
const MAX_PORT_TRIES = 21;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
};

function parseArgs(argv) {
  let port = DEFAULT_PORT;
  let strictPort = false;
  let openBrowser = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-open') {
      openBrowser = false;
    } else if (arg === '--strict-port') {
      strictPort = true;
    } else if (arg === '--port' && argv[i + 1]) {
      const parsed = Number.parseInt(argv[++i], 10);
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) port = parsed;
    } else if (arg.startsWith('--port=')) {
      const parsed = Number.parseInt(arg.slice('--port='.length), 10);
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) port = parsed;
    }
  }
  return { port, strictPort, openBrowser };
}

function launchBrowser(url) {
  let command;
  let args;
  if (process.platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

function resolveSafePath(rawUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(rawUrl, 'http://127.0.0.1').pathname);
  } catch {
    return null;
  }
  const relative = pathname.replace(/^\/+/, '');
  const resolved = path.resolve(ROOT_DIR, relative);
  if (resolved !== ROOT_DIR && !resolved.startsWith(ROOT_DIR + path.sep)) {
    return null;
  }
  return resolved;
}

async function handleRequest(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  let filePath = resolveSafePath(req.url || '/');
  if (!filePath) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }

  let stats;
  try {
    stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stats = await fs.stat(filePath);
    }
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const totalSize = stats.size;
  const headers = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };

  const rangeHeader = req.headers.range;
  if (rangeHeader && totalSize > 0) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (match) {
      const start = match[1] === '' ? Math.max(0, totalSize - Number(match[2])) : Number(match[1]);
      const end = match[1] !== '' && match[2] !== '' ? Math.min(totalSize - 1, Number(match[2])) : totalSize - 1;
      if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start <= end && end < totalSize) {
        res.writeHead(206, {
          ...headers,
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Content-Length': String(end - start + 1),
        });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        createReadStream(filePath, { start, end }).pipe(res);
        return;
      }
      res.writeHead(416, { 'Content-Range': `bytes */${totalSize}` });
      res.end();
      return;
    }
  }

  res.writeHead(200, {
    ...headers,
    'Content-Length': String(totalSize),
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

function listenOnPort(server, port) {
  return new Promise((resolve, reject) => {
    const onError = error => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

async function main() {
  const { port: basePort, strictPort, openBrowser } = parseArgs(process.argv.slice(2));
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('Internal Server Error');
    });
  });

  const maxTries = strictPort ? 1 : MAX_PORT_TRIES;
  let boundPort = null;
  for (let offset = 0; offset < maxTries; offset++) {
    const candidate = basePort + offset;
    if (candidate > 65535) break;
    try {
      await listenOnPort(server, candidate);
      boundPort = candidate;
      break;
    } catch (error) {
      if (error.code !== 'EADDRINUSE' || offset === maxTries - 1) {
        throw error;
      }
    }
  }

  const url = `http://localhost:${boundPort}/`;
  console.log(`服务已启动：${url}`);
  console.log('按 Ctrl+C 停止服务。');
  if (openBrowser) launchBrowser(url);

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(error => {
  console.error('本地服务启动失败：', error.message);
  process.exit(1);
});
