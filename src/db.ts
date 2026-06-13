import type { Outfit, WardrobeItem } from "./types";

const DB_NAME = "yida-wardrobe";
const DB_VERSION = 1;
const ITEM_STORE = "items";
const OUTFIT_STORE = "outfits";

type StoreName = typeof ITEM_STORE | typeof OUTFIT_STORE;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ITEM_STORE)) {
        db.createObjectStore(ITEM_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(OUTFIT_STORE)) {
        db.createObjectStore(OUTFIT_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAll<T>(storeName: StoreName): Promise<T[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

async function putValue<T>(storeName: StoreName, value: T): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

async function deleteValue(storeName: StoreName, id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(id);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

async function clearStore(storeName: StoreName): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).clear();
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

export const wardrobeDb = {
  getItems: () => getAll<WardrobeItem>(ITEM_STORE),
  saveItem: (item: WardrobeItem) => putValue(ITEM_STORE, item),
  deleteItem: (id: string) => deleteValue(ITEM_STORE, id),
  getOutfits: () => getAll<Outfit>(OUTFIT_STORE),
  saveOutfit: (outfit: Outfit) => putValue(OUTFIT_STORE, outfit),
  deleteOutfit: (id: string) => deleteValue(OUTFIT_STORE, id),
  replaceAll: async (items: WardrobeItem[], outfits: Outfit[]) => {
    await clearStore(ITEM_STORE);
    await clearStore(OUTFIT_STORE);
    await Promise.all(items.map((item) => putValue(ITEM_STORE, item)));
    await Promise.all(outfits.map((outfit) => putValue(OUTFIT_STORE, outfit)));
  },
};
