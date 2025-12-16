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
  if (!db.isOpen()) {
    try {
      await db.open();
      console.log('✅ IndexedDB 已打开');
    } catch (err) {
      console.error('❌ IndexedDB 打开失败:', err);
      // iOS Safari 可能需要重新初始化
      if (err.name === 'InvalidStateError' || err.name === 'UnknownError') {
        console.log('⚠️ 检测到数据库状态错误，尝试重新打开...');
        try {
          await db.close();
          await db.open();
          console.log('✅ 重新打开成功');
        } catch (retryErr) {
          console.error('❌ 重新打开也失败:', retryErr);
          throw retryErr;
        }
      } else {
        throw err;
      }
    }
  }
  return db;
}
export function getDb() { return db; }

/* --- 核心：事务覆盖写入 (加固点) --- */
export async function overwriteAllRows(rows) {
  await ensureDbReady();
  
  // iOS Safari 兼容性：使用更明确的错误处理和重试机制
  try {
    await db.transaction('rw', db.rows, async (tx) => {
      // 先清空
      await tx.rows.clear();
      
      // 如果有数据，批量添加
      if (rows && rows.length > 0) {
        // iOS Safari 可能需要分批处理大量数据
        const batchSize = 100;
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          await tx.rows.bulkAdd(batch);
        }
      }
    });
    
    console.log('✅ 数据写入成功，条数:', rows?.length || 0);
  } catch (err) {
    console.error('❌ 数据写入失败:', err);
    // iOS Safari 可能需要重试
    if (err.name === 'QuotaExceededError' || err.name === 'UnknownError') {
      console.log('⚠️ 检测到存储错误，尝试清理后重试...');
      try {
        // 先清理，再重试
        await db.rows.clear();
        if (rows && rows.length > 0) {
          await db.rows.bulkAdd(rows);
        }
        console.log('✅ 重试成功');
      } catch (retryErr) {
        console.error('❌ 重试也失败:', retryErr);
        throw retryErr;
      }
    } else {
      throw err;
    }
  }
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
