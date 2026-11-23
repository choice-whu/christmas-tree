const MAX_CUSTOM_PHOTOS = 60;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_MUSIC_BYTES = 30 * 1024 * 1024;
const MAX_THUMBNAIL_EDGE = 480;
const REVOKE_DELAY_MS = 1200;

function isSupportedImage(file) {
  if (!file || file.size > MAX_FILE_BYTES) return false;
  if (file.type === 'image/svg+xml') return false;
  if (file.type) return file.type.startsWith('image/');
  return /\.(jpe?g|png|webp|avif|gif|bmp)$/i.test(file.name || '');
}

function isSupportedAudio(file) {
  if (!file || file.size > MAX_MUSIC_BYTES) return false;
  if (file.type) return file.type.startsWith('audio/');
  return /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name || '');
}

function formatPhotoAlt(file, fallbackIndex) {
  const base = (file?.name || '').replace(/\.[^.]+$/, '').trim();
  return base || `自定义照片 ${fallbackIndex}`;
}

function createId() {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function decodeAndThumb(file, fallbackIndex) {
  if (!isSupportedImage(file)) {
    throw new Error('不支持的图片格式或文件过大。');
  }
  const originalUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = originalUrl;
    await image.decode();

    const maxDim = Math.max(image.naturalWidth, image.naturalHeight);
    const ratio = maxDim > 0 ? Math.min(1, MAX_THUMBNAIL_EDGE / maxDim) : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建画布上下文。');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    let thumbnailBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .8));
    if (!thumbnailBlob) {
      thumbnailBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .84));
    }
    if (!thumbnailBlob) throw new Error('无法生成照片缩略图。');

    const thumbnailUrl = URL.createObjectURL(thumbnailBlob);
    return {
      id: createId(),
      createdAt: Date.now(),
      alt: formatPhotoAlt(file, fallbackIndex),
      width: image.naturalWidth || 320,
      height: image.naturalHeight || 400,
      originalBlob: file,
      thumbnailBlob,
      originalUrl,
      thumbnailUrl,
    };
  } catch (error) {
    URL.revokeObjectURL(originalUrl);
    throw error;
  }
}

export function createPhotoCollection(grid, store = null) {
  const defaultPhotos = Array.from(grid.querySelectorAll('[data-photo-id]'), (link, idx) => {
    const image = link.querySelector('img');
    return {
      id: link.dataset.photoId,
      original: link.getAttribute('href'),
      thumbnail: image.getAttribute('src'),
      alt: image.alt || `相册照片 ${idx + 1}`,
      width: Number(image.getAttribute('width')) || 320,
      height: Number(image.getAttribute('height')) || 400,
      source: 'default',
    };
  });

  const hiddenDefaults = new Set();
  const customEntries = [];
  let orderIds = [];
  const photos = [];
  const activeUrls = new Set();
  const pendingRevokes = new Map();
  let storageAvailable = true;
  let customMusic = null; // { name, url }

  function scheduleRevoke(urls) {
    const list = urls.filter(Boolean);
    if (!list.length) return;
    for (const url of list) activeUrls.delete(url);
    const timer = setTimeout(() => {
      pendingRevokes.delete(timer);
      for (const url of list) URL.revokeObjectURL(url);
    }, REVOKE_DELAY_MS);
    pendingRevokes.set(timer, list);
  }

  function buildTile(photo) {
    const isDefault = photo.source === 'default';
    const tile = document.createElement(isDefault ? 'a' : 'button');
    if (isDefault) {
      tile.href = photo.original;
    } else {
      tile.type = 'button';
    }
    tile.className = 'print';
    tile.dataset.photoId = photo.id;
    tile.setAttribute('aria-label', `查看${photo.alt}`);

    const image = document.createElement('img');
    image.alt = photo.alt;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.width = photo.width || 320;
    image.height = photo.height || 400;
    image.src = photo.thumbnail;
    tile.append(image);
    return tile;
  }

  function rebuild() {
    const byId = new Map();
    for (const item of customEntries) {
      byId.set(item.id, {
        id: item.id,
        original: item.original,
        thumbnail: item.thumbnail,
        alt: item.alt,
        width: item.width,
        height: item.height,
        source: 'custom',
      });
    }
    for (const item of defaultPhotos) {
      if (!hiddenDefaults.has(item.id)) {
        byId.set(item.id, { ...item, source: 'default' });
      }
    }

    const next = [];
    const seen = new Set();
    for (const id of orderIds) {
      const item = byId.get(id);
      if (item && !seen.has(id)) {
        seen.add(id);
        next.push({ ...item, order: next.length });
      }
    }
    for (const item of byId.values()) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        next.push({ ...item, order: next.length });
      }
    }
    if (orderIds.length) {
      orderIds = next.map(item => item.id);
    }
    photos.splice(0, photos.length, ...next);

    if (photos.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'prints-empty';
      empty.textContent = '还没有照片，可通过自定义面板添加照片或恢复示例。';
      grid.replaceChildren(empty);
    } else {
      grid.replaceChildren(...photos.map(buildTile));
    }
  }

  rebuild();

  async function persistMeta() {
    if (!store) return;
    await store.setMetaState({ hiddenDefaults: [...hiddenDefaults], order: orderIds });
  }

  return {
    all: photos,

    stats() {
      const defaultCount = defaultPhotos.length - hiddenDefaults.size;
      const customCount = customEntries.length;
      const isExactDefault = photos.length === defaultPhotos.length &&
        photos.every((item, idx) => item.id === defaultPhotos[idx].id);
      return {
        total: photos.length,
        defaultCount,
        customCount,
        totalDefaults: defaultPhotos.length,
        maxCustom: MAX_CUSTOM_PHOTOS,
        hasOverrides: hiddenDefaults.size > 0 || customCount > 0 || !isExactDefault,
        hasCustomMusic: Boolean(customMusic),
        musicName: customMusic?.name || null,
        storageAvailable,
      };
    },

    async hydrate() {
      if (!store) return { customMusic: null };
      const saved = await store.load();
      storageAvailable = saved.available;

      hiddenDefaults.clear();
      for (const id of saved.hiddenDefaults) {
        if (defaultPhotos.some(item => item.id === id)) {
          hiddenDefaults.add(id);
        }
      }
      orderIds = Array.isArray(saved.order) ? saved.order.map(String) : [];

      const oldUrls = [];
      for (const item of customEntries.splice(0)) {
        oldUrls.push(item.original, item.thumbnail);
      }
      if (customMusic?.url) {
        oldUrls.push(customMusic.url);
        customMusic = null;
      }
      scheduleRevoke(oldUrls);

      for (const record of saved.customPhotos) {
        if (!record?.originalBlob || !record?.thumbnailBlob) continue;
        const original = URL.createObjectURL(record.originalBlob);
        const thumbnail = URL.createObjectURL(record.thumbnailBlob);
        activeUrls.add(original);
        activeUrls.add(thumbnail);
        customEntries.push({
          id: record.id,
          alt: record.alt || '自定义照片',
          width: record.width || 320,
          height: record.height || 400,
          original,
          thumbnail,
        });
      }

      if (saved.customMusic?.blob) {
        const url = URL.createObjectURL(saved.customMusic.blob);
        activeUrls.add(url);
        customMusic = { name: saved.customMusic.name, url };
      }

      rebuild();
      return { customMusic };
    },

    async importFiles(files, { replace = false } = {}) {
      const fileList = Array.from(files || []);
      const prepared = [];
      let invalid = 0;
      let overLimit = 0;
      let storageError = false;

      const existingCustomCount = replace ? 0 : customEntries.length;
      const previousOrder = photos.map(photo => photo.id);
      for (let i = 0; i < fileList.length; i++) {
        if (existingCustomCount + prepared.length >= MAX_CUSTOM_PHOTOS) {
          overLimit++;
          continue;
        }
        try {
          const item = await decodeAndThumb(fileList[i], existingCustomCount + prepared.length + 1);
          prepared.push(item);
        } catch {
          invalid++;
        }
      }

      if (replace && prepared.length === 0) {
        return {
          added: [],
          invalid,
          overLimit,
          maxTotal: MAX_CUSTOM_PHOTOS,
          storageError: false,
        };
      }

      const urlsToRevoke = [];
      if (replace && prepared.length > 0) {
        try {
          if (store) {
            await store.clearCustomPhotos();
            await store.setHiddenDefaults(defaultPhotos.map(item => item.id));
          }
          for (const item of defaultPhotos) hiddenDefaults.add(item.id);
          for (const old of customEntries.splice(0)) {
            urlsToRevoke.push(old.original, old.thumbnail);
          }
        } catch {
          storageError = true;
          for (const item of prepared) {
            URL.revokeObjectURL(item.originalUrl);
            URL.revokeObjectURL(item.thumbnailUrl);
          }
          return {
            added: [],
            invalid,
            overLimit,
            maxTotal: MAX_CUSTOM_PHOTOS,
            storageError,
          };
        }
      }

      const added = [];
      for (let i = 0; i < prepared.length; i++) {
        const item = prepared[i];
        try {
          if (store) {
            await store.savePhoto({
              id: item.id,
              createdAt: item.createdAt + i,
              alt: item.alt,
              width: item.width,
              height: item.height,
              originalBlob: item.originalBlob,
              thumbnailBlob: item.thumbnailBlob,
            });
          }
          activeUrls.add(item.originalUrl);
          activeUrls.add(item.thumbnailUrl);
          customEntries.push({
            id: item.id,
            alt: item.alt,
            width: item.width,
            height: item.height,
            original: item.originalUrl,
            thumbnail: item.thumbnailUrl,
          });
          added.push(item.id);
        } catch {
          storageError = true;
          for (let j = i; j < prepared.length; j++) {
            URL.revokeObjectURL(prepared[j].originalUrl);
            URL.revokeObjectURL(prepared[j].thumbnailUrl);
          }
          break;
        }
      }

      scheduleRevoke(urlsToRevoke);
      if (replace) {
        orderIds = added.slice();
      } else if (added.length > 0) {
        orderIds = [...added, ...previousOrder];
      }
      if (added.length > 0) {
        try {
          await persistMeta();
        } catch {
          storageError = true;
        }
      }
      rebuild();
      return {
        added: photos.filter(photo => added.includes(photo.id)),
        invalid,
        overLimit,
        maxTotal: MAX_CUSTOM_PHOTOS,
        storageError,
      };
    },

    async pinPhoto(id) {
      if (!photos.some(item => item.id === id)) return false;
      const rest = photos.map(item => item.id).filter(itemId => itemId !== id);
      orderIds = [id, ...rest];
      await persistMeta();
      rebuild();
      return true;
    },

    async removePhoto(id) {
      const targetDefault = defaultPhotos.find(item => item.id === id);
      if (targetDefault) {
        hiddenDefaults.add(id);
        if (orderIds.length) orderIds = orderIds.filter(itemId => itemId !== id);
        await persistMeta();
        rebuild();
        return true;
      }
      const idx = customEntries.findIndex(item => item.id === id);
      if (idx >= 0) {
        const [removed] = customEntries.splice(idx, 1);
        if (store) await store.deletePhoto(id);
        if (orderIds.length) {
          orderIds = orderIds.filter(itemId => itemId !== id);
          await persistMeta();
        }
        scheduleRevoke([removed.original, removed.thumbnail]);
        rebuild();
        return true;
      }
      return false;
    },

    async clearAll() {
      for (const item of defaultPhotos) hiddenDefaults.add(item.id);
      orderIds = [];
      const urlsToRevoke = customEntries.splice(0).flatMap(item => [item.original, item.thumbnail]);
      if (store) {
        await store.clearCustomPhotos();
        await persistMeta();
      }
      scheduleRevoke(urlsToRevoke);
      rebuild();
    },

    async restoreDefaultPhotos() {
      hiddenDefaults.clear();
      orderIds = [];
      const urlsToRevoke = customEntries.splice(0).flatMap(item => [item.original, item.thumbnail]);
      if (store) {
        await store.clearCustomPhotos();
        await persistMeta();
      }
      scheduleRevoke(urlsToRevoke);
      rebuild();
    },

    async setCustomMusic(file) {
      if (!isSupportedAudio(file)) {
        throw new Error('请选择受支持的音频文件（不超过 30 MB）。');
      }
      if (store) {
        await store.saveMusic({ name: file.name, blob: file });
      }
      const prevUrl = customMusic?.url;
      const url = URL.createObjectURL(file);
      activeUrls.add(url);
      customMusic = { name: file.name, url };
      if (prevUrl) scheduleRevoke([prevUrl]);
      return { ...customMusic };
    },

    async clearCustomMusic() {
      if (store) await store.clearMusic();
      const prevUrl = customMusic?.url;
      customMusic = null;
      if (prevUrl) scheduleRevoke([prevUrl]);
    },

    async resetAll() {
      hiddenDefaults.clear();
      orderIds = [];
      const urlsToRevoke = customEntries.splice(0).flatMap(item => [item.original, item.thumbnail]);
      if (customMusic?.url) {
        urlsToRevoke.push(customMusic.url);
        customMusic = null;
      }
      if (store) await store.resetAll();
      scheduleRevoke(urlsToRevoke);
      rebuild();
    },

    dispose() {
      for (const [timer, list] of pendingRevokes) {
        clearTimeout(timer);
        for (const url of list) URL.revokeObjectURL(url);
      }
      pendingRevokes.clear();
      for (const url of activeUrls) URL.revokeObjectURL(url);
      activeUrls.clear();
    },
  };
}
