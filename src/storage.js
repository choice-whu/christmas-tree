const DB_NAME = 'christmas-photo-wall-db';
const DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_PHOTOS = 'photos';
const STORE_MUSIC = 'music';
const META_STATE_KEY = 'state';
const MUSIC_BGM_KEY = 'bgm';

function wrapRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function runTransaction(db, storeNames, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error || tx.error || new Error('IndexedDB transaction failed'));
    };
    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    tx.onerror = () => fail(tx.error);
    tx.onabort = () => fail(tx.error);
    try {
      const stores = Array.isArray(storeNames)
        ? storeNames.map(name => tx.objectStore(name))
        : tx.objectStore(storeNames);
      Promise.resolve(work(stores, tx)).then(value => {
        result = value;
      }, error => {
        try { tx.abort(); } catch {}
        fail(error);
      });
    } catch (error) {
      try { tx.abort(); } catch {}
      fail(error);
    }
  });
}

export function createLocalStore() {
  let dbPromise = null;
  let available = typeof indexedDB !== 'undefined';

  function openDb() {
    if (!available) return Promise.resolve(null);
    if (dbPromise) return dbPromise;

    dbPromise = new Promise(resolve => {
      let request;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        available = false;
        resolve(null);
        return;
      }

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
        if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
          db.createObjectStore(STORE_PHOTOS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_MUSIC)) {
          db.createObjectStore(STORE_MUSIC, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        available = false;
        resolve(null);
      };
      request.onblocked = () => {
        available = false;
        resolve(null);
      };
    });

    return dbPromise;
  }

  return {
    async load() {
      const db = await openDb();
      if (!db) {
        return { available: false, hiddenDefaults: [], order: [], customPhotos: [], customMusic: null };
      }
      try {
        const data = await runTransaction(db, [STORE_META, STORE_PHOTOS, STORE_MUSIC], 'readonly', async ([meta, photos, music]) => {
          const [metaState, savedPhotos, savedMusic] = await Promise.all([
            wrapRequest(meta.get(META_STATE_KEY)),
            wrapRequest(photos.getAll()),
            wrapRequest(music.get(MUSIC_BGM_KEY)),
          ]);
          const customPhotos = (savedPhotos || []).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id)));
          const hiddenDefaults = Array.isArray(metaState?.hiddenDefaults) ? metaState.hiddenDefaults.map(String) : [];
          const order = Array.isArray(metaState?.order) ? metaState.order.map(String) : [];
          const customMusic = savedMusic?.blob ? { name: savedMusic.name || '自定义音乐', blob: savedMusic.blob } : null;
          return { available: true, hiddenDefaults, order, customPhotos, customMusic };
        });
        return data;
      } catch {
        available = false;
        return { available: false, hiddenDefaults: [], order: [], customPhotos: [], customMusic: null };
      }
    },

    async savePhoto(record) {
      const db = await openDb();
      if (!db) return false;
      await runTransaction(db, STORE_PHOTOS, 'readwrite', store => wrapRequest(store.put(record)));
      return true;
    },

    async deletePhoto(id) {
      const db = await openDb();
      if (!db) return false;
      await runTransaction(db, STORE_PHOTOS, 'readwrite', store => wrapRequest(store.delete(id)));
      return true;
    },

    async clearCustomPhotos() {
      const db = await openDb();
      if (!db) return false;
      await runTransaction(db, STORE_PHOTOS, 'readwrite', store => wrapRequest(store.clear()));
      return true;
    },

    async setMetaState({ hiddenDefaults = [], order = [] }) {
      const db = await openDb();
      if (!db) return false;
      const cleanHidden = Array.from(new Set(hiddenDefaults.map(String)));
      const cleanOrder = Array.from(new Set(order.map(String)));
      await runTransaction(db, STORE_META, 'readwrite', store =>
        wrapRequest(store.put({ hiddenDefaults: cleanHidden, order: cleanOrder }, META_STATE_KEY))
      );
      return true;
    },

    async setHiddenDefaults(ids) {
      const db = await openDb();
      if (!db) return false;
      const hiddenDefaults = Array.from(new Set(ids.map(String)));
      await runTransaction(db, STORE_META, 'readwrite', async store => {
        const existing = await wrapRequest(store.get(META_STATE_KEY));
        const order = Array.isArray(existing?.order) ? existing.order.map(String) : [];
        await wrapRequest(store.put({ hiddenDefaults, order }, META_STATE_KEY));
      });
      return true;
    },

    async saveMusic({ name, blob }) {
      const db = await openDb();
      if (!db) return false;
      await runTransaction(db, STORE_MUSIC, 'readwrite', store =>
        wrapRequest(store.put({ id: MUSIC_BGM_KEY, name, blob, updatedAt: Date.now() }))
      );
      return true;
    },

    async clearMusic() {
      const db = await openDb();
      if (!db) return false;
      await runTransaction(db, STORE_MUSIC, 'readwrite', store => wrapRequest(store.delete(MUSIC_BGM_KEY)));
      return true;
    },

    async resetAll() {
      const db = await openDb();
      if (!db) return false;
      await runTransaction(db, [STORE_META, STORE_PHOTOS, STORE_MUSIC], 'readwrite', async ([meta, photos, music]) => {
        await Promise.all([
          wrapRequest(meta.clear()),
          wrapRequest(photos.clear()),
          wrapRequest(music.clear()),
        ]);
      });
      return true;
    },
  };
}
