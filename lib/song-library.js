/** @typedef {import('./song').LibrarySong} LibrarySong */
/** @typedef {import('./song').SongAudio} SongAudio */
/** @typedef {import('./song').SongChart} SongChart */

function openDatabase() {
  if (!globalThis.indexedDB) return undefined;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("lockstep", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("songs", { keyPath: "id" });
      // Listing songs must not load their audio.
      request.result.createObjectStore("pcm");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Owns the browser library. Mutations resolve only after commit.
 * The database promise is injectable so transaction failures can be tested.
 * @param {Promise<IDBDatabase> | undefined} database
 */
export function createSongLibrary(database = openDatabase()) {
  /**
   * @template T
   * @param {string | string[]} stores
   * @param {IDBTransactionMode} mode
   * @param {(transaction: IDBTransaction) => IDBRequest<T> | void} run
   * @returns {Promise<T | undefined>}
   */
  async function transact(stores, mode, run) {
    const db = await database;
    if (!db) throw new Error("Browser library storage is unavailable");
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(stores, mode);
      /** @type {IDBRequest<T> | void} */
      let request;
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onabort = () =>
        reject(transaction.error || new Error("Library transaction aborted"));
      try {
        request = run(transaction);
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
  }

  return {
    available: Boolean(database),
    /** @returns {Promise<LibrarySong[]>} */
    async list() {
      return (
        (await transact("songs", "readonly", (tx) =>
          tx.objectStore("songs").getAll(),
        )) || []
      );
    },
    /** @param {string} id @returns {Promise<SongAudio>} */
    async loadAudio(id) {
      const audio = await transact("pcm", "readonly", (tx) =>
        tx.objectStore("pcm").get(id),
      );
      if (!audio) throw new Error("Saved audio is missing");
      return audio;
    },
    /** @param {LibrarySong} song @param {SongAudio} audio */
    save(song, audio) {
      return transact(["songs", "pcm"], "readwrite", (tx) => {
        tx.objectStore("pcm").put(audio, song.id);
        tx.objectStore("songs").put(song);
      });
    },
    /** @param {string} id @param {SongChart} chart */
    updateChart(id, chart) {
      return transact("songs", "readwrite", (tx) => {
        const store = tx.objectStore("songs");
        const request = store.get(id);
        request.onsuccess = () => {
          // A deleted song must not be recreated by an earlier background re-chart.
          if (request.result) store.put({ ...request.result, song: chart });
        };
      });
    },
    /** @param {string} id */
    remove(id) {
      return transact(["songs", "pcm"], "readwrite", (tx) => {
        tx.objectStore("pcm").delete(id);
        tx.objectStore("songs").delete(id);
      });
    },
  };
}
