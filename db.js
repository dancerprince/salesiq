/**
 * db.js — Persistent User Database Layer
 * =======================================
 * Stores all user account information and per-user application data
 * in IndexedDB (primary) with localStorage fallback.
 *
 * This file is SEPARATE from the main app code so that pushing updates
 * to index.html never affects stored user data.
 *
 * IndexedDB is durable across page reloads, code deployments, and
 * GitHub Pages updates — it lives in the browser's origin storage.
 *
 * Stores:
 *   - User accounts (signup info, hashed passwords)
 *   - Active session
 *   - Per-user data: agents, agent map, API config, API tokens,
 *     daily state, update logs
 */

const DB_NAME = 'AgentTrackerDB';
const DB_VERSION = 2;
const STORES = {
  users: 'users',         // All registered user accounts
  sessions: 'sessions',   // Active session (single record, key='active')
  userData: 'userData'     // Per-user app data (key = `${userId}_${dataType}`)
};

/* ====== IndexedDB Setup ====== */
let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) { resolve(_db); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORES.users)) {
        db.createObjectStore(STORES.users, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.sessions)) {
        db.createObjectStore(STORES.sessions, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.userData)) {
        db.createObjectStore(STORES.userData, { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = (e) => { console.warn('IndexedDB open failed, using localStorage fallback', e); resolve(null); };
  });
}

/* Generic IDB helpers */
async function idbPut(storeName, record) {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch (e) { resolve(false); }
  });
}

async function idbGet(storeName, key) {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
}

async function idbGetAll(storeName) {
  const db = await openDB();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (e) { resolve([]); }
  });
}

async function idbDelete(storeName, key) {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch (e) { resolve(false); }
  });
}

/* ====== MIGRATION: localStorage → IndexedDB ====== */
async function migrateFromLocalStorage() {
  // Migrate users
  try {
    const lsUsers = JSON.parse(localStorage.getItem('agt_tracker_users') || '[]');
    if (lsUsers.length > 0) {
      const existingUsers = await idbGetAll(STORES.users);
      const existingIds = new Set(existingUsers.map(u => u.id));
      for (const u of lsUsers) {
        if (!existingIds.has(u.id)) {
          await idbPut(STORES.users, u);
        }
      }
    }
  } catch (e) { /* ignore */ }

  // Migrate session
  try {
    const lsSession = JSON.parse(localStorage.getItem('agt_tracker_session') || 'null');
    if (lsSession) {
      await idbPut(STORES.sessions, { key: 'active', ...lsSession });
    }
  } catch (e) { /* ignore */ }

  // Migrate per-user data keys
  const dataKeys = [
    'agt_tracker_v6_daily', 'agt_tracker_v5_daily', 'agt_tracker_agents',
    'agt_tracker_agent_map', 'agt_tracker_api_config', 'agt_tracker_api_tokens',
    'agt_tracker_update_logs'
  ];
  for (const base of dataKeys) {
    // Check both global and per-user variants
    for (let i = 0; i < localStorage.length; i++) {
      const lsKey = localStorage.key(i);
      if (lsKey && lsKey.startsWith(base)) {
        try {
          const val = localStorage.getItem(lsKey);
          if (val) {
            await idbPut(STORES.userData, { key: lsKey, value: val });
          }
        } catch (e) { /* ignore */ }
      }
    }
  }
}

/* ====== USER ACCOUNTS ====== */
async function dbGetUsers() {
  try {
    const users = await idbGetAll(STORES.users);
    if (users.length > 0) return users;
  } catch (e) { /* fallback */ }
  // Fallback to localStorage
  try { return JSON.parse(localStorage.getItem('agt_tracker_users') || '[]'); } catch (e) { return []; }
}

async function dbSaveUser(user) {
  // Save to IndexedDB
  await idbPut(STORES.users, user);
  // Also save to localStorage as backup
  try {
    const allUsers = await dbGetUsers();
    localStorage.setItem('agt_tracker_users', JSON.stringify(allUsers));
  } catch (e) { /* ignore */ }
}

async function dbSaveAllUsers(users) {
  for (const u of users) {
    await idbPut(STORES.users, u);
  }
  try { localStorage.setItem('agt_tracker_users', JSON.stringify(users)); } catch (e) { /* ignore */ }
}

/* ====== SESSION ====== */
async function dbGetSession() {
  try {
    const rec = await idbGet(STORES.sessions, 'active');
    if (rec) { const { key, ...session } = rec; return session; }
  } catch (e) { /* fallback */ }
  try { return JSON.parse(localStorage.getItem('agt_tracker_session') || 'null'); } catch (e) { return null; }
}

async function dbSetSession(user) {
  const session = { id: user.id, name: user.name, email: user.email, role: user.role };
  await idbPut(STORES.sessions, { key: 'active', ...session });
  try { localStorage.setItem('agt_tracker_session', JSON.stringify(session)); } catch (e) { /* ignore */ }
  return session;
}

async function dbClearSession() {
  await idbDelete(STORES.sessions, 'active');
  try { localStorage.removeItem('agt_tracker_session'); } catch (e) { /* ignore */ }
}

/* ====== PER-USER DATA ====== */
async function dbGetUserData(userId, dataType) {
  const key = dataType + '_' + userId;
  try {
    const rec = await idbGet(STORES.userData, key);
    if (rec && rec.value) return rec.value;
  } catch (e) { /* fallback */ }
  // Fallback to localStorage
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

async function dbSetUserData(userId, dataType, value) {
  const key = dataType + '_' + userId;
  const strVal = typeof value === 'string' ? value : JSON.stringify(value);
  await idbPut(STORES.userData, { key, value: strVal });
  // Also save to localStorage as backup
  try { localStorage.setItem(key, strVal); } catch (e) { /* ignore */ }
}

/* ====== EXPORT / IMPORT (for manual backup) ====== */
async function dbExportAll() {
  const users = await dbGetUsers();
  const session = await dbGetSession();
  const allUserData = await idbGetAll(STORES.userData);
  return {
    exportedAt: new Date().toISOString(),
    version: DB_VERSION,
    users,
    session,
    userData: allUserData
  };
}

async function dbImportAll(data) {
  if (!data || !data.users) throw new Error('Invalid backup data');
  // Import users
  for (const u of data.users) {
    await idbPut(STORES.users, u);
  }
  // Import user data
  if (data.userData) {
    for (const rec of data.userData) {
      await idbPut(STORES.userData, rec);
    }
  }
  // Import session if present
  if (data.session) {
    await idbPut(STORES.sessions, { key: 'active', ...data.session });
  }
  // Also sync to localStorage
  try { localStorage.setItem('agt_tracker_users', JSON.stringify(data.users)); } catch (e) { /* ignore */ }
  return { usersImported: data.users.length, dataRecords: (data.userData || []).length };
}

/* ====== INITIALIZATION ====== */
async function dbInit() {
  await openDB();
  await migrateFromLocalStorage();
}

/* Export for use in index.html */
window.DB = {
  init: dbInit,
  getUsers: dbGetUsers,
  saveUser: dbSaveUser,
  saveAllUsers: dbSaveAllUsers,
  getSession: dbGetSession,
  setSession: dbSetSession,
  clearSession: dbClearSession,
  getUserData: dbGetUserData,
  setUserData: dbSetUserData,
  exportAll: dbExportAll,
  importAll: dbImportAll
};
