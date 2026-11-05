// IndexedDB persistence for the demo vault and the plugin settings.
// Every call is wrapped: without IndexedDB (private mode, blocked storage) the demo simply runs in memory.

const DB_NAME = 'hw-demo';
const DB_VERSION = 1;
export const FILES = 'files';
export const KV = 'kv';

export interface StoredEntry { path: string; folder?: boolean; data?: string | ArrayBuffer; mtime: number; ctime: number; }

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase | null>(resolve => {
        try {
            if (typeof indexedDB === 'undefined') { resolve(null); return; }
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'path' });
                if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
            req.onblocked = () => resolve(null);
        } catch { resolve(null); }
    });
    return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
    return new Promise(resolve => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
    });
}

export async function loadAllFiles(): Promise<StoredEntry[] | null> {
    try {
        const db = await openDb();
        if (!db) return null;
        return await new Promise<StoredEntry[] | null>(resolve => {
            const req = db.transaction(FILES, 'readonly').objectStore(FILES).getAll();
            req.onsuccess = () => resolve(req.result as StoredEntry[]);
            req.onerror = () => resolve(null);
        });
    } catch { return null; }
}

export async function saveFiles(put: StoredEntry[], del: string[]): Promise<void> {
    try {
        const db = await openDb();
        if (!db) return;
        const tx = db.transaction(FILES, 'readwrite');
        const st = tx.objectStore(FILES);
        for (const p of del) st.delete(p);
        for (const e of put) st.put(e);
        await done(tx);
    } catch { /* storage not available – the demo keeps working in memory */ }
}

export async function kvGet<T>(key: string): Promise<T | null> {
    try {
        const db = await openDb();
        if (!db) return null;
        return await new Promise<T | null>(resolve => {
            const req = db.transaction(KV, 'readonly').objectStore(KV).get(key);
            req.onsuccess = () => resolve((req.result ?? null) as T | null);
            req.onerror = () => resolve(null);
        });
    } catch { return null; }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
    try {
        const db = await openDb();
        if (!db) return;
        const tx = db.transaction(KV, 'readwrite');
        tx.objectStore(KV).put(value, key);
        await done(tx);
    } catch { /* ignore */ }
}

/** Removes everything (Reset demo). */
export async function clearAll(): Promise<void> {
    try {
        const db = await openDb();
        if (!db) return;
        const tx = db.transaction([FILES, KV], 'readwrite');
        tx.objectStore(FILES).clear();
        tx.objectStore(KV).clear();
        await done(tx);
    } catch { /* ignore */ }
}
