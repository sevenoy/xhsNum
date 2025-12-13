// data.js - 数据操作模块（IndexedDB、视图配置、分类配置）

import { DB_NAME, VIEW_KEY, CATS_KEY, DEFAULT_VIEW, DEFAULT_CATS } from './config.js';
import { uid } from './utils.js';

/* =========================
 * Dexie 数据库初始化
 * ========================= */

const db = new Dexie(DB_NAME);
db.version(1).stores({
  rows: "id,order,phone,owner,wx_real,wx_name,xhs_name,note1,row_color,updated_at",
});

// ✅ 优化：删除重复的数据库连接检查，只保留一个
let dbReadyPromise = db.open().then(() => {
  console.log('✅ IndexedDB 数据库连接已就绪');
  return true;
}).catch((err) => {
  console.error('❌ IndexedDB 数据库连接失败:', err);
  // 即使连接失败，也返回 true，避免阻塞应用
  return true;
});

/**
 * 确保数据库已打开
 */
export async function ensureDbReady() {
  if (!db.isOpen()) {
    await dbReadyPromise;
  }
  return db;
}

/**
 * 获取数据库实例
 */
export function getDb() {
  return db;
}

/* =========================
 * 视图配置
 * ========================= */

/**
 * 读取视图配置
 */
export function readView() {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return { ...DEFAULT_VIEW };
    const obj = JSON.parse(raw);
    if (!obj || obj.viewVersion !== DEFAULT_VIEW.viewVersion) {
      saveView(DEFAULT_VIEW);
      return { ...DEFAULT_VIEW };
    }
    return { ...DEFAULT_VIEW, ...obj };
  } catch {
    saveView(DEFAULT_VIEW);
    return { ...DEFAULT_VIEW };
  }
}

/**
 * 保存视图配置
 */
export function saveView(v) {
  localStorage.setItem(VIEW_KEY, JSON.stringify(v));
}

/**
 * 应用视图配置到DOM
 */
export function applyView(v) {
  const root = document.documentElement;
  root.style.setProperty("--pad", `${v.pad}px`);
  root.style.setProperty("--colScale", `${v.colScale}`);
  root.style.setProperty("--zebra", v.zebraOn ? v.zebraColor : "transparent");
  root.style.setProperty("--font-main", v.fontFamily);
  root.style.setProperty("--font-weight", v.fontWeight || "normal");
  root.style.setProperty("--btn-default", v.btnColor || "#639BD5");

  const h1 = document.getElementById("appTitle");
  if (h1) {
    // ✅ 版本号已在状态栏显示，不再在标题中显示
    h1.textContent = v.titleText;
    h1.style.color = v.titleColor || "#208BEE";
  }
}

/* =========================
 * 分类配置
 * ========================= */

/**
 * 读取分类配置
 */
export function readCats() {
  try {
    const raw = localStorage.getItem(CATS_KEY);
    console.log('📦 读取分类数据:', { key: CATS_KEY, raw: raw ? '有数据' : '无数据' });
    if (!raw) {
      console.log('⚠️ 分类数据为空，返回默认分类');
      const defaultCats = DEFAULT_CATS.slice();
      saveCats(defaultCats);
      return defaultCats;
    }
    const obj = JSON.parse(raw);
    console.log('📦 解析后的分类数据:', obj);
    if (Array.isArray(obj) && obj.length > 0) {
      console.log('📋 分类详情:', obj.map(cat => ({
        id: cat.id,
        name: cat.name,
        color: cat.color
      })));
    }
    if (Array.isArray(obj) && obj.length) {
      // 修复旧分类数据：确保所有分类都有id字段
      const fixed = obj.map(cat => {
        if (!cat.id) {
          return { ...cat, id: uid() };
        }
        return cat;
      });
      if (fixed.some((cat, idx) => cat.id !== obj[idx]?.id)) {
        saveCats(fixed);
      }
      console.log('✅ 返回分类数据:', fixed);
      console.log('📋 返回的分类详情:', fixed.map(cat => ({
        id: cat.id,
        name: cat.name,
        color: cat.color
      })));
      return fixed;
    }
    console.log('⚠️ 分类数据格式不正确，返回默认分类');
    const defaultCats = DEFAULT_CATS.slice();
    saveCats(defaultCats);
    return defaultCats;
  } catch (err) {
    console.error('❌ 读取分类数据失败:', err);
    const defaultCats = DEFAULT_CATS.slice();
    saveCats(defaultCats);
    return defaultCats;
  }
}

/**
 * 保存分类配置
 */
export function saveCats(cats) {
  console.log('💾 保存分类数据:', { key: CATS_KEY, cats: cats });
  localStorage.setItem(CATS_KEY, JSON.stringify(cats));
  console.log('✅ 分类数据已保存');
}

/**
 * 根据ID获取分类名称
 */
export function catNameOf(cats, id) {
  const found = cats.find((c) => c.id === id);
  return found ? found.name : "";
}

/**
 * 根据ID获取分类颜色
 */
export function catColorOf(cats, id) {
  const found = cats.find((c) => c.id === id);
  return found ? found.color : "transparent";
}

/* =========================
 * IndexedDB 数据操作
 * ========================= */

/**
 * 获取所有行数据
 */
export async function getAllRows() {
  await ensureDbReady();
  const all = await db.rows.toArray();
  all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return all;
}

/**
 * 更新行数据
 * @param {string} id - 行ID
 * @param {object} patch - 要更新的字段
 * @param {object} options - 选项 { getCurrentUserId, getCurrentUserName, renderTable }
 */
export async function updateRow(id, patch, options = {}) {
  await ensureDbReady();
  const row = await db.rows.get(id);
  if (!row) return;
  
  // 如果提供了冲突检测函数，执行冲突检测
  if (options.getCurrentUserId && options.getCurrentUserName) {
    const currentUserId = await options.getCurrentUserId() || 'unknown';
    const currentUserName = options.getCurrentUserName();
    
    // 冲突检测：检查是否有人在最近30秒内修改过
    const now = Date.now();
    const timeSinceUpdate = now - (row.updated_at || 0);
    const differentUser = row.updated_by !== currentUserId;
    
    if (timeSinceUpdate < 30000 && differentUser && row.updated_by_name) {
      // 可能有冲突
      const userName = row.updated_by_name || '其他用户';
      const shouldContinue = confirm(
        `⚠️ 注意：${userName} 刚刚修改了此记录（${Math.floor(timeSinceUpdate/1000)}秒前）\n\n` +
        `是否继续保存您的修改？\n` +
        `点击【确定】将覆盖对方的修改\n` +
        `点击【取消】将放弃您的修改`
      );
      
      if (!shouldContinue) {
        // 用户选择取消，如果提供了重新渲染函数则调用
        if (options.renderTable) {
          await options.renderTable();
        }
        return;
      }
    }
    
    // 添加用户信息到更新数据
    patch.updated_by = currentUserId;
    patch.updated_by_name = currentUserName;
  }
  
  const next = { 
    ...row, 
    ...patch, 
    updated_at: Date.now()
  };
  await db.rows.put(next);
  
  // 如果提供了重新渲染函数则调用
  if (options.renderTable) {
    await options.renderTable();
  }
}

/**
 * 删除行数据
 */
export async function deleteRowById(id) {
  await ensureDbReady();
  await db.rows.delete(id);
}

/**
 * 移动行（上移/下移）
 * @param {string} id - 行ID
 * @param {string} dir - 方向 ('up' 或 'down')
 * @param {array} filteredRows - 已筛选的数据（可选，如果不提供则使用全部数据）
 */
export async function moveRow(id, dir, filteredRows = null) {
  await ensureDbReady();
  const all = await db.rows.toArray();
  // 如果提供了已筛选的数据，使用筛选后的数据；否则使用全部数据
  const filtered = filteredRows || all;
  const idx = filtered.findIndex((r) => r.id === id);
  if (idx === -1) return;
  const targetIdx = dir === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= filtered.length) return;
  const a = filtered[idx];
  const b = filtered[targetIdx];
  const ao = a.order ?? 0;
  const bo = b.order ?? 0;
  await db.transaction("rw", db.rows, async () => {
    await db.rows.update(a.id, { order: bo, updated_at: Date.now() });
    await db.rows.update(b.id, { order: ao, updated_at: Date.now() });
  });
}

/**
 * 添加新行
 */
export async function addRow(rowData) {
  await ensureDbReady();
  await db.rows.add(rowData);
}

/**
 * 批量添加行
 */
export async function bulkAddRows(rows) {
  await ensureDbReady();
  if (rows.length) {
    await db.rows.bulkAdd(rows);
  }
}

/**
 * 清空所有行
 */
export async function clearAllRows() {
  await ensureDbReady();
  await db.rows.clear();
}

/**
 * 批量删除行
 */
export async function bulkDeleteRows(ids) {
  await ensureDbReady();
  await db.rows.bulkDelete(ids);
}
