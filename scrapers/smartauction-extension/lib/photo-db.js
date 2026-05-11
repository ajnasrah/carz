// PhotoDB — IndexedDB wrapper for persisting photos across popup open/close
// chrome.storage.local has a ~10MB limit; IndexedDB has no practical limit.

'use strict';

const PhotoDB = {
  DB_NAME: 'SmartAuctionPhotos',
  DB_VERSION: 1,
  STORE_NAME: 'photos',

  _db: null,

  async _open() {
    if (this._db) return this._db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };

      request.onsuccess = (e) => {
        this._db = e.target.result;
        resolve(this._db);
      };

      request.onerror = (e) => {
        reject(new Error('IndexedDB open failed: ' + e.target.error));
      };
    });
  },

  // Save all photos (replaces existing). Each photo: { dataUrl, resizedBase64 }
  async saveAll(photos) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);

      // Clear existing
      store.clear();

      // Add each photo
      photos.forEach((photo, idx) => {
        store.add({
          idx,
          dataUrl: photo.dataUrl,
          resizedBase64: photo.resizedBase64,
          zone: photo.zone || 'exterior'
        });
      });

      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(new Error('Save failed: ' + e.target.error));
    });
  },

  // Load all photos, returns array of { dataUrl, resizedBase64 }
  async loadAll() {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const results = request.result || [];
        // Sort by idx to preserve order
        results.sort((a, b) => a.idx - b.idx);
        resolve(results.map(r => ({
          dataUrl: r.dataUrl,
          resizedBase64: r.resizedBase64,
          zone: r.zone || 'exterior'
        })));
      };

      request.onerror = (e) => reject(new Error('Load failed: ' + e.target.error));
    });
  },

  // Clear all photos (for "New Vehicle" / reset)
  async clear() {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(new Error('Clear failed: ' + e.target.error));
    });
  },

  // Get count
  async count() {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(0);
    });
  }
};

if (typeof window !== 'undefined') {
  window.PhotoDB = PhotoDB;
}
