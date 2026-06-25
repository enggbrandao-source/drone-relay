const fs = require('fs');
const path = require('path');

const STORE_SCHEMA_VERSION = 1;

function createEmptyStore() {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    users: [],
    companies: [],
    drones: [],
    farms: [],
    operations: [],
    operationStates: {}
  };
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function migrateStoreData(rawStore) {
  const base = createEmptyStore();
  const safeStore = rawStore && typeof rawStore === 'object' ? rawStore : {};
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    users: normalizeArray(safeStore.users),
    companies: normalizeArray(safeStore.companies),
    drones: normalizeArray(safeStore.drones),
    farms: normalizeArray(safeStore.farms),
    operations: normalizeArray(safeStore.operations),
    operationStates: safeStore.operationStates && typeof safeStore.operationStates === 'object' && !Array.isArray(safeStore.operationStates)
      ? safeStore.operationStates
      : base.operationStates
  };
}

function ensureDirectory(filePath) {
  const dirPath = path.dirname(filePath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function loadStore(filePath) {
  ensureDirectory(filePath);
  if (!fs.existsSync(filePath)) {
    const initial = createEmptyStore();
    fs.writeFileSync(filePath, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    return migrateStoreData(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return createEmptyStore();
  }
}

function saveStore(filePath, store) {
  ensureDirectory(filePath);
  fs.writeFileSync(filePath, JSON.stringify(migrateStoreData(store), null, 2));
}

module.exports = {
  STORE_SCHEMA_VERSION,
  createEmptyStore,
  loadStore,
  migrateStoreData,
  saveStore
};