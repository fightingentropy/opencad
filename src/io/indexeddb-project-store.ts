const DATABASE_NAME = 'opencad-single-player';
const DATABASE_VERSION = 1;
const SNAPSHOT_STORE = 'snapshots';
const JOURNAL_STORE = 'journal';
const MAX_JOURNAL_ENTRIES = 100;

interface SnapshotRecord {
  slot: 'current' | 'backup';
  raw: string;
  projectId: string;
  modified: number;
  savedAt: number;
}

interface JournalRecord {
  sequence?: number;
  projectId: string;
  modified: number;
  savedAt: number;
  bytes: number;
}

export interface ProjectSnapshots {
  current: SnapshotRecord | null;
  backup: SnapshotRecord | null;
}

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    reject(new Error('IndexedDB is unavailable'));
    return;
  }
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
      db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'slot' });
    }
    if (!db.objectStoreNames.contains(JOURNAL_STORE)) {
      db.createObjectStore(JOURNAL_STORE, { keyPath: 'sequence', autoIncrement: true });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
  request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked by another OpenCAD tab'));
});

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });

export const saveIndexedDbProjectSnapshot = async (
  raw: string,
  projectId: string,
  modified: number,
): Promise<void> => {
  const db = await openDatabase();
  try {
    const transaction = db.transaction([SNAPSHOT_STORE, JOURNAL_STORE], 'readwrite');
    const snapshots = transaction.objectStore(SNAPSHOT_STORE);
    const journal = transaction.objectStore(JOURNAL_STORE);
    const now = Date.now();
    const previousRequest = snapshots.get('current');
    previousRequest.onsuccess = () => {
      const previous = previousRequest.result as SnapshotRecord | undefined;
      if (previous) snapshots.put({ ...previous, slot: 'backup' } satisfies SnapshotRecord);
      snapshots.put({
        slot: 'current',
        raw,
        projectId,
        modified,
        savedAt: now,
      } satisfies SnapshotRecord);
      journal.add({
        projectId,
        modified,
        savedAt: now,
        bytes: new TextEncoder().encode(raw).byteLength,
      } satisfies JournalRecord);
    };

    const countRequest = journal.count();
    countRequest.onsuccess = () => {
      let toDelete = Math.max(0, countRequest.result - MAX_JOURNAL_ENTRIES + 1);
      if (toDelete === 0) return;
      const cursorRequest = journal.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || toDelete === 0) return;
        cursor.delete();
        toDelete--;
        cursor.continue();
      };
    };
    await transactionDone(transaction);
  } finally {
    db.close();
  }
};

export const loadIndexedDbProjectSnapshots = async (): Promise<ProjectSnapshots> => {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(SNAPSHOT_STORE, 'readonly');
    const store = transaction.objectStore(SNAPSHOT_STORE);
    const currentRequest = store.get('current');
    const backupRequest = store.get('backup');
    await transactionDone(transaction);
    return {
      current: (currentRequest.result as SnapshotRecord | undefined) ?? null,
      backup: (backupRequest.result as SnapshotRecord | undefined) ?? null,
    };
  } finally {
    db.close();
  }
};

export const clearIndexedDbProjects = async (): Promise<void> => {
  const db = await openDatabase();
  try {
    const transaction = db.transaction([SNAPSHOT_STORE, JOURNAL_STORE], 'readwrite');
    transaction.objectStore(SNAPSHOT_STORE).clear();
    transaction.objectStore(JOURNAL_STORE).clear();
    await transactionDone(transaction);
  } finally {
    db.close();
  }
};

export const indexedDbJournalLength = async (): Promise<number> => {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(JOURNAL_STORE, 'readonly');
    const request = transaction.objectStore(JOURNAL_STORE).count();
    await transactionDone(transaction);
    return request.result;
  } finally {
    db.close();
  }
};
