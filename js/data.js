// js/data.js
import Dexie from 'https://esm.sh/dexie@4.0.8';
import { DB_NAME, VIEW_KEY, CATS_KEY, DEFAULT_VIEW, DEFAULT_CATS } from './config.js';

/* --- 编辑状态管理 --- */
let isDirty = false;

export function markDirty() {
  if (!isDirty) {
    isDirty = true;
    console.log('✏️ 本地有未保存修改 (Dirty)');
    const btn = document.querySelector('#btnSaveCloud');
    if (btn) {
      if (!btn.dataset.cleanText) {
        btn.dataset.cleanText = btn.textContent.replace(' *', '').replace('⏳ ', '');
      }
      btn.textContent = btn.dataset.cleanText + ' *';
    }
  }
}

export function clearDirty() {
  isDirty = false;
  console.log('✨ 本地状态已同步 (Clean)');
  const btn = document.querySelector('#btnSaveCloud');
  if (btn && btn.dataset.cleanText) {
    btn.textContent = btn.dataset.cleanText;
  }
}

export function isLocalDirty() { return isDirty; }

/* --- 数据库 --- */
const db = new Dexie(DB_NAME);
db.version(2).stores({
  rows: "id,order,phone,owner,wx_real,wx_name,xhs_name,note1,row_color,updated_at",
  meta: "key"
});

export async function ensureDbReady() {
  if (!db.isOpen()) await db.open().catch(console.error);
  return db;
}
export function getDb() { return db; }

/* --- 核心：事务覆盖写入 (加固点) --- */
export async function overwriteAllRows(rows) {
  await ensureDbReady();
  await db.transaction('rw', db.rows, async () => {
    await db.rows.clear();
    if (rows?.length) await db.rows.bulkAdd(rows);
  });
}

/* --- 视图 & 分类 --- */
export function saveView(v, silent = false) {
  if (!silent) markDirty();
  localStorage.setItem(VIEW_KEY, JSON.stringify(v));
}
export function saveCats(cats, silent = false) {
  if (!silent) markDirty();
  localStorage.setItem(CATS_KEY, JSON.stringify(cats));
}
export function readView() { try { const r = localStorage.getItem(VIEW_KEY); return r ? { ...DEFAULT_VIEW, ...JSON.parse(r) } : { ...DEFAULT_VIEW }; } catch { return { ...DEFAULT_VIEW }; } }
export function applyView(v) { 
  const root = document.documentElement; 
  root.style.setProperty("--pad", `${v.pad}px`);
  root.style.setProperty("--colScale", `${v.colScale}`);
  root.style.setProperty("--zebra", v.zebraOn ? v.zebraColor : "transparent");
  root.style.setProperty("--font-main", v.fontFamily);
  root.style.setProperty("--font-weight", v.fontWeight || "normal");
  root.style.setProperty("--btn-default", v.btnColor || "#639BD5");
  const h1 = document.getElementById("appTitle");
  if(h1){ h1.textContent = v.titleText; h1.style.color = v.titleColor||"#208BEE"; }
}
export function readCats() { try { const r = localStorage.getItem(CATS_KEY); return r ? JSON.parse(r) : DEFAULT_CATS.slice(); } catch { return DEFAULT_CATS.slice(); } }
export function catNameOf(cats, id) { const f = cats.find(c=>c.id===id); return f?f.name:""; }
export function catColorOf(cats, id) { const f = cats.find(c=>c.id===id); return f?f.color:"transparent"; }

/* --- 写操作 (埋点) --- */
export async function updateRow(id, patch, options = {}) {
  markDirty();
  await ensureDbReady();
  const row = await db.rows.get(id);
  if (!row) return;
  await db.rows.put({ ...row, ...patch, updated_at: Date.now() });
  if (options.renderTable) await options.renderTable();
}
export async function deleteRowById(id) { markDirty(); await ensureDbReady(); await db.rows.delete(id); }
export async function addRow(rowData) { markDirty(); await ensureDbReady(); await db.rows.add(rowData); }
export async function bulkAddRows(rows) { markDirty(); await ensureDbReady(); if (rows.length) await db.rows.bulkAdd(rows); }
export async function clearAllRows() { markDirty(); await ensureDbReady(); await db.rows.clear(); }
export async function bulkDeleteRows(ids) { markDirty(); await ensureDbReady(); await db.rows.bulkDelete(ids); }
export async function moveRow(id, dir, filteredRows = null) {
  markDirty();
  await ensureDbReady();
  const all = await db.rows.toArray();
  const filtered = filteredRows || all;
  const idx = filtered.findIndex((r) => r.id === id);
  if (idx === -1) return;
  const targetIdx = dir === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= filtered.length) return;
  const a = filtered[idx], b = filtered[targetIdx];
  const ao = a.order ?? 0, bo = b.order ?? 0;
  await db.transaction("rw", db.rows, async () => {
    await db.rows.update(a.id, { order: bo, updated_at: Date.now() });
    await db.rows.update(b.id, { order: ao, updated_at: Date.now() });
  });
}
export async function getAllRows() { await ensureDbReady(); const all = await db.rows.toArray(); all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); return all; }

export { db };
