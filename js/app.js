// app.js — 本地 Dexie + Supabase 快照 + 桌面表格 + 手机版折叠列表

/* =========================
 * 0. 基础配置 & 常量
 * ========================= */

const VIEW_KEY = "xhs_view_v7";
const CATS_KEY = "xhs_cats_v7";
const DB_NAME = "xhs_phone_sheet_v7";
const SUPABASE_TABLE = "xhsphone_snapshot";
const SUPABASE_DEFAULT_KEY = "default";

// ✅ 如果本地还没有 Supabase 配置，则自动写入你提供的参数
if (!localStorage.getItem("xhs_supabase_url")) {
  localStorage.setItem(
    "xhs_supabase_url",
    "https://tmeqccupnsvxexbrlflo.supabase.co"
  );
}
if (!localStorage.getItem("xhs_supabase_anon_key")) {
  localStorage.setItem(
    "xhs_supabase_anon_key",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtZXFjY3VwbnN2eGV4YnJsZmxvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0OTg2MjAsImV4cCI6MjA3ODA3NDYyMH0.9ZJz6Cwpjo5HLGXRNMBtj-J57gX47Aj42_0ILmkxbho"
  );
}

// 优先从 window / localStorage 读取已有配置
const SUPABASE_URL =
  (window.SUPABASE_URL || localStorage.getItem("xhs_supabase_url") || "").trim();
const SUPABASE_ANON_KEY =
  (window.SUPABASE_ANON_KEY ||
    localStorage.getItem("xhs_supabase_anon_key") ||
    "").trim();

// 动态加载 Supabase，避免 import 失败把整份脚本搞挂
let supabase = null;
let hasSupabase = false;

async function initSupabase() {
  hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  if (!hasSupabase) return;

  try {
    const { createClient } = await import(
      "https://esm.sh/@supabase/supabase-js@2"
    );
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    await cloudHealthCheck();
  } catch (err) {
    console.error("Supabase 初始化失败：", err);
    supabase = null;
  }
}

// 默认视图
const DEFAULT_VIEW = Object.freeze({
  viewVersion: 8,
  pad: 6,
  colScale: 1,
  zebraOn: true,
  zebraColor: "#e2f0ff",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"SF Pro Text",Helvetica,Arial,sans-serif',
  titleText: "XHSPHONE",
  titleColor: "#1990FF",
  btnColor: "#E2F0FF",
});

// 默认分类
const DEFAULT_CATS = Object.freeze([
  { id: "enterprise", name: "企业号", color: "#007aff" },
  { id: "olina", name: "Olina用", color: "#34c759" },
  { id: "jasper", name: "嘉用", color: "#ff9f0a" },
  { id: "usable", name: "可用", color: "#8e8e93" },
]);

// 全局筛选状态
const state = {
  q: "",
  owner: "all",
  wxReal: "all",
  sortBy: "order",
  precise: false,
  activeFunction: null,
};

/* =========================
 * 1. Dexie 初始化
 * ========================= */

const db = new Dexie(DB_NAME);
db.version(1).stores({
  rows: "id,order,phone,owner,wx_real,wx_name,xhs_name,note1,row_color,updated_at",
});

/* =========================
 * 2. 视图配置
 * ========================= */

function readView() {
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

function saveView(v) {
  localStorage.setItem(VIEW_KEY, JSON.stringify(v));
}

function applyView(v) {
  const root = document.documentElement;
  root.style.setProperty("--pad", `${v.pad}px`);
  root.style.setProperty("--colScale", `${v.colScale}`);
  root.style.setProperty("--zebra", v.zebraOn ? v.zebraColor : "transparent");
  root.style.setProperty("--font-main", v.fontFamily);
  root.style.setProperty("--btn-default", v.btnColor || "#E2F0FF");

  const h1 = document.getElementById("appTitle");
  if (h1) {
    h1.textContent = v.titleText;
    h1.style.color = v.titleColor || "#1990FF";
  }
}

/* =========================
 * 3. 分类配置
 * ========================= */

function readCats() {
  try {
    const raw = localStorage.getItem(CATS_KEY);
    if (!raw) return DEFAULT_CATS.slice();
    const obj = JSON.parse(raw);
    if (Array.isArray(obj) && obj.length) {
      // ✅ 修复旧分类数据：确保所有分类都有id字段
      const fixed = obj.map(cat => {
        if (!cat.id) {
          // 如果没有id，根据name生成一个唯一id
          return { ...cat, id: uid() };
        }
        return cat;
      });
      // 如果有任何分类被修复，保存回localStorage
      if (fixed.some((cat, idx) => cat.id !== obj[idx]?.id)) {
        saveCats(fixed);
      }
      return fixed;
    }
    return DEFAULT_CATS.slice();
  } catch {
    return DEFAULT_CATS.slice();
  }
}

function saveCats(cats) {
  localStorage.setItem(CATS_KEY, JSON.stringify(cats));
}

function catNameOf(cats, id) {
  const found = cats.find((c) => c.id === id);
  return found ? found.name : "";
}

function catColorOf(cats, id) {
  const found = cats.find((c) => c.id === id);
  return found ? found.color : "transparent";
}

/* =========================
 * 4. 工具函数
 * ========================= */

const $ = (sel) => document.querySelector(sel);

function fmtTime(ts) {
  try {
    const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, "0");
    const D = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${Y}-${M}-${D} ${h}:${m}`;
  } catch {
    return "";
  }
}

function uid() {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
  ).toUpperCase();
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function unescapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

// ✅ 使用原始版本的 hexToRgba 函数
function hexToRgba(hex, alpha) {
  if (!hex) return "transparent";
  hex = (hex || "").replace("#", "");
  if (hex.length === 3) hex = hex.split("").map((x) => x + x).join("");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ✅ 截断字符串显示前10个字符
function truncateText(text, maxChars = 10) {
  if (!text) return "";
  const str = String(text);
  if (str.length <= maxChars) return str;
  return str.slice(0, maxChars) + "...";
}

/* =========================
 * 4.2. 用户相关辅助函数
 * ========================= */

function getCurrentUserId() {
  return window.currentUser?.id || localStorage.getItem('xhs_user_id') || 'anonymous';
}

function getCurrentUserName() {
  return window.currentUser?.name || localStorage.getItem('xhs_user_name') || '匿名用户';
}

function getCurrentUserEmail() {
  return window.currentUser?.email || localStorage.getItem('xhs_user_email') || '';
}

/* =========================
 * 4.3. 权限验证函数
 * ========================= */

// 检查用户是否有权限访问资源
async function checkPermission(resourceId, resourceType, permissionType = 'view') {
  if (!supabase) return false;
  
  const userId = getCurrentUserId();
  
  try {
    // 1. 检查是否是资源所有者
    if (resourceType === 'snapshot') {
      const { data: snapshot } = await supabase
        .from(SUPABASE_TABLE)
        .select('owner_id')
        .eq('key', resourceId)
        .maybeSingle();
      
      if (snapshot && snapshot.owner_id === userId) {
        return true; // 所有者有所有权限
      }
    }
    
    // 2. 检查是否被授予权限
    const { data: permission, error: permError } = await supabase
      .from('permissions')
      .select('*')
      .eq('resource_id', resourceId)
      .eq('resource_type', resourceType)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    
    if (permError) {
      console.error('查询权限失败:', permError);
      return false;
    }
    
    if (!permission) {
      console.log('❌ 未找到权限记录', { resourceId, resourceType, userId });
      return false;
    }
    
    console.log('✅ 找到权限记录:', permission);
    
    // 3. 检查权限是否过期
    if (permission.expired_at && new Date(permission.expired_at) < new Date()) {
      // 自动标记为过期
      await supabase
        .from('permissions')
        .update({ status: 'expired' })
        .eq('id', permission.id);
      return false;
    }
    
    // 4. 检查权限类型
    if (permissionType === 'view') {
      const hasView = permission.permission_type === 'view' || permission.permission_type === 'edit';
      console.log('✅ 查看权限检查:', hasView, '权限类型:', permission.permission_type);
      return hasView;
    } else if (permissionType === 'edit') {
      const hasEdit = permission.permission_type === 'edit';
      console.log('✅ 编辑权限检查:', hasEdit, '权限类型:', permission.permission_type);
      return hasEdit;
    }
    
    return false;
    
  } catch (err) {
    console.error('权限检查失败:', err);
    return false;
  }
}

// 检查是否是管理员
function isAdmin() {
  return window.isAdmin || localStorage.getItem('xhs_is_admin') === 'true';
}

/* =========================
 * 4.5. 功能按钮激活状态管理
 * ========================= */

function setActiveFunction(functionName) {
  state.activeFunction = functionName;
  document.querySelectorAll(".function-btn").forEach((btn) => {
    btn.classList.remove("active");
  });
  if (functionName) {
    const btn = document.querySelector(`[data-function="${functionName}"]`);
    if (btn) {
      btn.classList.add("active");
      console.log(`✅ 激活功能按钮: ${functionName}`);
    }
  }
}

function clearActiveFunction() {
  state.activeFunction = null;
  document.querySelectorAll(".function-btn").forEach((btn) => {
    btn.classList.remove("active");
  });
}

/* =========================
 * 5. 本地数据封装
 * ========================= */

async function getAllRows() {
  const all = await db.rows.toArray();
  all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return all;
}

async function addRow() {
  const all = await getAllRows();
  const now = Date.now();
  
  // ✅ 从顶部新增：新行的 order 设为 0，其他所有行的 order + 1
  if (all.length > 0) {
    // 更新所有现有行的 order，让它们下移
    const updates = all.map(r => ({
      ...r,
      order: (r.order || 0) + 1,
      updated_at: now,
      updated_by: getCurrentUserId(),
      updated_by_name: getCurrentUserName()
    }));
    await db.rows.bulkPut(updates);
  }
  
  // 创建新行，order 为 0（顶部）
  const row = {
    id: uid(),
    order: 0,
    phone: "",
    owner: "",
    wx_real: "",
    wx_name: "",
    xhs_name: "",
    note1: "",
    row_color: "",
    created_at: now,
    created_by: getCurrentUserId(),
    created_by_name: getCurrentUserName(),
    updated_at: now,
    updated_by: getCurrentUserId(),
    updated_by_name: getCurrentUserName(),
  };
  await db.rows.add(row);
  await refreshFilters();
  await renderTable();
}

// ✅ 简化 updateRow，参考原始版本
async function updateRow(id, patch) {
  const row = await db.rows.get(id);
  if (!row) return;
  
  // ✅ 冲突检测：检查是否有人在最近30秒内修改过
  const now = Date.now();
  const timeSinceUpdate = now - (row.updated_at || 0);
  const differentUser = row.updated_by !== getCurrentUserId();
  
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
      // 用户选择取消，重新加载数据
      await renderTable();
      return;
    }
  }
  
  const next = { 
    ...row, 
    ...patch, 
    updated_at: now,
    updated_by: getCurrentUserId(),
    updated_by_name: getCurrentUserName()
  };
  await db.rows.put(next);
  // ✅ 关键：直接重新渲染，不要手动更新UI
  await renderTable();
}

async function deleteRowById(id) {
  await db.rows.delete(id);
  await refreshFilters();
  await renderTable();
}

async function moveRow(id, dir) {
  const all = await getAllRows();
  const filtered = applyFilters(all);
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
  await renderTable();
}

/* =========================
 * 6. 筛选 / 搜索 / 排序
 * ========================= */

async function refreshFilters() {
  const owners = new Set();
  const wxreals = new Set();
  const all = await getAllRows();
  for (const r of all) {
    if (r.owner) owners.add(r.owner);
    if (r.wx_real) wxreals.add(r.wx_real);
  }
  const ownerSel = $("#filterOwner");
  const realSel = $("#filterWxReal");
  const ownerVal = ownerSel.value;
  const realVal = realSel.value;

  ownerSel.innerHTML =
    `<option value="all">所属人：全部</option>` +
    Array.from(owners)
      .sort((a, b) => a.localeCompare(b, "zh"))
      .map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`)
      .join("");
  realSel.innerHTML =
    `<option value="all">微信实名人：全部</option>` +
    Array.from(wxreals)
      .sort((a, b) => a.localeCompare(b, "zh"))
      .map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`)
      .join("");

  ownerSel.value = ownerVal || "all";
  realSel.value = realVal || "all";
}

function tokenize(s) {
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function matchDigitsSubstr(phone, queryDigits) {
  const digits = String(phone || "").replace(/\D+/g, "");
  return digits.includes(queryDigits);
}

function applySearchFilter(rows) {
  if (!state.q) return rows;
  const q = state.q.trim();
  if (!q) return rows;

  if (state.precise) {
    const hasNum = /\d/.test(q);
    if (hasNum) {
      const digits = q.replace(/\D+/g, "");
      return rows.filter((r) => matchDigitsSubstr(r.phone, digits));
    } else {
      const target = q;
      return rows.filter(
        (r) =>
          r.phone === target ||
          r.owner === target ||
          r.wx_real === target ||
          r.wx_name === target ||
          r.xhs_name === target ||
          r.note1 === target
      );
    }
  } else {
    const tokens = tokenize(q);
    return rows.filter((r) => {
      const bag = [
        r.phone,
        r.owner,
        r.wx_real,
        r.wx_name,
        r.xhs_name,
        r.note1,
        catNameOf(readCats(), r.row_color),
      ]
        .map((s) => String(s || "").toLowerCase())
        .join(" ");
      return tokens.every((t) => bag.includes(t.toLowerCase()));
    });
  }
}

function applyFilters(rows) {
  let out = rows.slice();
  if (state.owner !== "all") {
    out = out.filter((r) => r.owner === state.owner);
  }
  if (state.wxReal !== "all") {
    out = out.filter((r) => r.wx_real === state.wxReal);
  }
  out = applySearchFilter(out);
  switch (state.sortBy) {
    case "owner":
      out.sort((a, b) => (a.owner || "").localeCompare(b.owner || "", "zh"));
      break;
    case "wx_real":
      out.sort((a, b) => (a.wx_real || "").localeCompare(b.wx_real || "", "zh"));
      break;
    case "phone":
      out.sort((a, b) => (a.phone || "").localeCompare(b.phone || "", "zh"));
      break;
    case "xhs_name":
      out.sort((a, b) => (a.xhs_name || "").localeCompare(b.xhs_name || "", "zh"));
      break;
    case "row_color": {
      const cats = readCats();
      out.sort((a, b) =>
        catNameOf(cats, a.row_color).localeCompare(
          catNameOf(cats, b.row_color),
          "zh"
        )
      );
      break;
    }
    default:
      out.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  return out;
}

/* =========================
 * 7. 渲染（桌面 + 手机版）
 * ========================= */

function tdEditable(cls, text, field, rowId) {
  return `<td class="${cls}" contenteditable="true" data-field="${field}" data-id="${rowId}">${escapeHtml(
    text || ""
  )}</td>`;
}

function tdSelectCat(cls, value, rowId) {
  const cats = readCats();
  const opts = [`<option value="">未分类</option>`]
    .concat(
      cats.map(
        (c) =>
          `<option value="${escapeHtml(c.id)}"${
            c.id === value ? " selected" : ""
          }>${escapeHtml(c.name)}</option>`
      )
    )
    .join("");
  return `<td class="${cls}"><select data-field="row_color" data-id="${rowId}">${opts}</select></td>`;
}

function tdActions(rowId) {
  return `<td class="col-act">
    <div class="actions-container">
      <button class="btn-mini ghost" data-act="up" data-id="${rowId}">上移</button>
      <button class="btn-mini ghost" data-act="down" data-id="${rowId}">下移</button>
      <button class="btn-mini btn-danger" data-act="del" data-id="${rowId}">删除</button>
    </div>
  </td>`;
}

function makeRowTr(r) {
  const cats = readCats();
  // ✅ 使用原始版本的背景色计算方式
  const bg = r.row_color ? hexToRgba(catColorOf(cats, r.row_color) || "#ffffff", 0.18) : "";
  const xhsDisplay = truncateText(r.xhs_name, 10);
  
  return `<tr data-id="${r.id}">
    ${tdEditable("col-phone", r.phone, "phone", r.id)}
    ${tdEditable("col-owner", r.owner, "owner", r.id)}
    ${tdEditable("col-real", r.wx_real, "wx_real", r.id)}
    ${tdEditable("col-wx", r.wx_name, "wx_name", r.id)}
    <td class="col-xhs" contenteditable="true" data-field="xhs_name" data-id="${r.id}" 
        style="${bg ? `background:${bg};` : ""} text-align:right;" 
        title="${escapeHtml(r.xhs_name || "")}">${escapeHtml(xhsDisplay)}</td>
    ${tdEditable("col-note", r.note1, "note1", r.id)}
    ${tdSelectCat("col-cat", r.row_color, r.id)}
    ${tdActions(r.id)}
  </tr>`;
}

async function renderTable() {
  console.log("🎨 renderTable 被调用");
  const tbody = $("#gridBody");
  const all = await getAllRows();
  console.log(`📊 总共 ${all.length} 行数据`);
  const rows = applyFilters(all);
  console.log(`📊 过滤后 ${rows.length} 行数据`);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#888;padding:14px 0;">暂无数据，点击"新增一行"开始录入</td></tr>`;
  } else {
    console.log("🔧 开始生成 HTML");
    tbody.innerHTML = rows.map((r) => makeRowTr(r)).join("");
    console.log("✅ HTML 生成完成");
    
    // 验证 select 元素
    const selects = tbody.querySelectorAll('select[data-field="row_color"]');
    console.log(`🔍 表格中共有 ${selects.length} 个分类选择器`);
  }

  // ✅ 注意：所有事件都通过 bindEvents() 中的事件委托处理，这里不需要绑定任何事件
  
  renderMobileList(rows);
}

function renderMobileList(rows) {
  const container = $("#mobileList");
  const v = readView();

  if (!rows.length) {
    container.innerHTML = `<div style="text-align:center;color:#888;padding:10px 0;">暂无数据</div>`;
    return;
  }
  
  const cats = readCats();
  
  container.innerHTML = rows
    .map((r, idx) => {
      const zebraBg = v.zebraOn && idx % 2 === 1 ? v.zebraColor : "#fff";
      // ✅ 使用 hexToRgba 计算pill背景色
      const pillBg = r.row_color ? hexToRgba(catColorOf(cats, r.row_color) || "#ffffff", 0.18) : "rgba(0, 122, 255, 0.09)";
      const catName = catNameOf(cats, r.row_color);
      const xhsDisplay = truncateText(r.xhs_name, 10);
      
      return `<div class="m-row" data-id="${r.id}" data-original-data='${JSON.stringify(r)}' style="--card-bg:${zebraBg}">
        <button class="m-row-header" data-id="${r.id}">
          <div class="m-main-line">
            <span class="m-phone">${escapeHtml(r.phone || "")}</span>
            <span class="m-xhs" title="${escapeHtml(r.xhs_name || "")}">${escapeHtml(xhsDisplay)}</span>
            <span class="m-arrow">▾</span>
          </div>
          <div class="m-meta-line">
            <span class="m-owner">所属人：${escapeHtml(r.owner || "-")}</span>
            <span class="m-cat-pill" style="background:${pillBg}">${escapeHtml(catName || "未分类")}</span>
          </div>
        </button>
        <div class="m-row-details">
          ${mobileDetailInput("电话号", r.phone, "phone", r.id)}
          ${mobileDetailInput("所属人", r.owner, "owner", r.id)}
          ${mobileDetailInput("微信实名人", r.wx_real, "wx_real", r.id)}
          ${mobileDetailInput("对应微信名", r.wx_name, "wx_name", r.id)}
          ${mobileDetailInput("小红书名称", r.xhs_name, "xhs_name", r.id)}
          ${mobileDetailTextarea("备注", r.note1, "note1", r.id)}
          ${mobileCat(r.row_color, r.id)}
          <div class="m-edit-actions" style="display:flex;justify-content:space-between;gap:8px;padding:12px 0 6px;border-top:1px solid #f0f0f0;margin-top:10px;">
            <button class="primary" data-mact="save" data-id="${r.id}" style="flex:1;">💾 保存修改</button>
            <button class="ghost" data-mact="cancel" data-id="${r.id}" style="flex:1;">取消</button>
          </div>
          <div class="m-actions">
            <button class="ghost" data-mact="up" data-id="${r.id}">上移</button>
            <button class="ghost" data-mact="down" data-id="${r.id}">下移</button>
            <button class="btn-danger" data-mact="del" data-id="${r.id}">删除</button>
          </div>
        </div>
      </div>`;
    })
    .join("");

  // ✅ 注意：所有移动端事件都通过 bindEvents() 中的事件委托处理，这里不需要绑定任何事件

  function mobileDetailInput(label, text, field, id) {
    const inputType = field === 'phone' ? 'tel' : 'text';
    const placeholder = field === 'phone' ? '输入电话号' : `输入${label}`;
    return `<div class="m-detail-row">
      <div class="m-detail-label">${escapeHtml(label)}</div>
      <div class="m-detail-value">
        <input type="${inputType}" 
               class="m-input" 
               data-field="${field}" 
               data-id="${id}" 
               value="${escapeHtml(text || '')}"
               placeholder="${placeholder}">
      </div>
    </div>`;
  }

  function mobileDetailTextarea(label, text, field, id) {
    return `<div class="m-detail-row">
      <div class="m-detail-label">${escapeHtml(label)}</div>
      <div class="m-detail-value">
        <textarea class="m-textarea" 
                  data-field="${field}" 
                  data-id="${id}" 
                  placeholder="输入${label}"
                  rows="2">${escapeHtml(text || '')}</textarea>
      </div>
    </div>`;
  }

  function mobileCat(value, id) {
    const cats = readCats();
    const opts = [`<option value="">未分类</option>`]
      .concat(
        cats.map(
          (c) =>
            `<option value="${escapeHtml(c.id)}"${
              c.id === value ? " selected" : ""
            }>${escapeHtml(c.name)}</option>`
        )
      )
      .join("");
    return `<div class="m-detail-row">
      <div class="m-detail-label">分类</div>
      <div class="m-detail-value">
        <select data-field="row_color" data-id="${id}" style="width:100%;">
          ${opts}
        </select>
      </div>
    </div>`;
  }
}

/* =========================
 * 7.1. 移动端编辑保存函数
 * ========================= */

// 保存移动端卡片的编辑
async function saveMobileCardEdit(id) {
  const card = document.querySelector(`.m-row[data-id="${id}"]`);
  if (!card) return;
  
  try {
    // 获取所有输入值
    const inputs = card.querySelectorAll('.m-input, .m-textarea');
    const select = card.querySelector('select[data-field="row_color"]');
    
    // 收集数据
    const updates = {};
    let hasChanges = false;
    
    inputs.forEach(input => {
      const field = input.getAttribute('data-field');
      const value = input.value.trim();
      updates[field] = value;
    });
    
    if (select) {
      updates['row_color'] = select.value;
    }
    
    // 验证电话号格式（如果有输入）
    if (updates.phone && updates.phone.length > 0) {
      // 简单验证：只允许数字、空格、短横线、括号
      if (!/^[\d\s\-()]+$/.test(updates.phone)) {
        alert('❌ 电话号格式不正确\n\n只能包含数字、空格、短横线和括号');
        return;
      }
    }
    
    // 获取原始数据
    const row = await db.rows.get(id);
    if (!row) {
      alert('❌ 数据不存在');
      return;
    }
    
    // 检查是否有变化
    for (const [field, value] of Object.entries(updates)) {
      if (row[field] !== value) {
        hasChanges = true;
        break;
      }
    }
    
    if (!hasChanges) {
      showMobileToast('ℹ️ 没有修改');
      card.classList.remove('open');
      return;
    }
    
    // 保存到数据库
    updates.updated_at = Date.now();
    updates.updated_by = getCurrentUserId();
    updates.updated_by_name = getCurrentUserName();
    
    await db.rows.put({ ...row, ...updates });
    
    // 如果是所属人或微信实名人，刷新筛选器
    if (updates.owner !== row.owner || updates.wx_real !== row.wx_real) {
      await refreshFilters();
    }
    
    // 重新渲染
    await renderTable();
    
    showMobileToast('✅ 保存成功');
    
  } catch (err) {
    console.error('❌ 保存失败:', err);
    alert('❌ 保存失败：' + err.message);
  }
}

// 取消移动端卡片的编辑
async function cancelMobileCardEdit(id) {
  const card = document.querySelector(`.m-row[data-id="${id}"]`);
  if (!card) return;
  
  // 检查是否有修改
  if (card.classList.contains('modified')) {
    if (!confirm('有未保存的修改，确定要取消吗？')) {
      return;
    }
  }
  
  // 关闭卡片
  card.classList.remove('open');
  card.classList.remove('modified');
  
  // 重新渲染以恢复原始数据
  await renderTable();
}

// 显示移动端提示
function showMobileToast(message) {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.85);
    color: white;
    padding: 12px 24px;
    border-radius: 999px;
    font-size: 14px;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: toastFadeIn 0.3s ease;
  `;
  
  // 添加动画
  const style = document.createElement('style');
  style.textContent = `
    @keyframes toastFadeIn {
      from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    @keyframes toastFadeOut {
      from { opacity: 1; transform: translateX(-50%) translateY(0); }
      to { opacity: 0; transform: translateX(-50%) translateY(-20px); }
    }
  `;
  if (!document.querySelector('style[data-mobile-toast]')) {
    style.setAttribute('data-mobile-toast', 'true');
    document.head.appendChild(style);
  }
  
  document.body.appendChild(toast);
  
  // 2.5秒后淡出
  setTimeout(() => {
    toast.style.animation = 'toastFadeOut 0.3s ease';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 2500);
}

/* =========================
 * 8. CSV 导入/导出
 * ========================= */

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const obj = {};
    headers.forEach((h, idx) => (obj[h] = cols[idx] || ""));
    rows.push(obj);
  }
  return rows;
}

function toCSV(rows) {
  const headers = [
    "phone",
    "owner",
    "wx_real",
    "wx_name",
    "xhs_name",
    "note1",
    "row_color",
    "order",
  ];
  const out = [headers.join(",")];
  for (const r of rows) {
    const line = headers
      .map((h) => {
        const s = String(r[h] ?? "");
        return `"${s.replaceAll('"', '""')}"`;
      })
      .join(",");
    out.push(line);
  }
  return out.join("\n");
}

/* =========================
 * 9. Supabase 云端快照
 * ========================= */

async function cloudHealthCheck() {
  const dot = $("#cloudDot");
  const text = $("#cloudText");
  if (!supabase) {
    dot.style.background = "#ffcc00";
    text.textContent = "Base 数据连接：未配置";
    return;
  }
  try {
    const { error } = await supabase
      .from(SUPABASE_TABLE)
      .select("updated_at")
      .eq("key", SUPABASE_DEFAULT_KEY)
      .maybeSingle();
    if (error) throw error;
    dot.style.background = "#30d158";
    text.textContent = "Base 数据连接：已连接";
  } catch (e) {
    dot.style.background = "#ff3b30";
    text.textContent = "Base 数据连接：失败";
    console.error(e);
  }
}

async function cloudSave() {
  if (!supabase) {
    alert("未配置 Supabase，无法保存云端；本地仍可正常使用。");
    return;
  }
  
  // ✅ 权限检查：检查是否有权限保存（默认快照）
  const hasPermission = await checkPermission(SUPABASE_DEFAULT_KEY, 'snapshot', 'edit');
  if (!hasPermission && !isAdmin()) {
    // 如果不是所有者且没有编辑权限，检查是否是默认快照的所有者
    const { data: snapshot } = await supabase
      .from(SUPABASE_TABLE)
      .select('owner_id')
      .eq('key', SUPABASE_DEFAULT_KEY)
      .maybeSingle();
    
    if (snapshot && snapshot.owner_id !== getCurrentUserId()) {
      alert("❌ 您没有权限修改此资源\n\n只有资源所有者或有编辑权限的用户可以保存");
      return;
    }
  }
  
  const all = await getAllRows();
  const cats = readCats();
  const view = readView();

  const label = prompt("输入快照名称（只保存名称，时间将显示在右侧）", "快照");
  if (label == null) return;
  const snapshotName = (label || "快照").trim();
  const now = Date.now();

  const payload = {
    ver: 1,
    snapshot_label: snapshotName,
    updated_at: now,
    updated_by: getCurrentUserId(),
    updated_by_name: getCurrentUserName(),
    rows: all,
    cats,
    view,
  };

  // ✅ 获取当前快照的 owner_id，保持原有所有者
  const { data: existingSnapshot } = await supabase
    .from(SUPABASE_TABLE)
    .select('owner_id')
    .eq('key', SUPABASE_DEFAULT_KEY)
    .maybeSingle();
  
  // 如果是所有者，保持 owner_id；如果有编辑权限但不是所有者，保持原有 owner_id
  const ownerId = existingSnapshot?.owner_id || getCurrentUserId();
  
  const { error: err1 } = await supabase.from(SUPABASE_TABLE).upsert({
    key: SUPABASE_DEFAULT_KEY,
    payload,
    owner_id: ownerId, // ✅ 保持原有所有者，不改变
    updated_at: new Date(now).toISOString(),
  });
  if (err1) {
    alert("保存失败：" + err1.message);
    return;
  }

  const histKey = `snap_${now}`;
  const { error: err2 } = await supabase.from(SUPABASE_TABLE).insert({
    key: histKey,
    payload,
    owner_id: getCurrentUserId(),
    updated_at: new Date(now).toISOString(),
  });
  if (err2) {
    alert("保存历史失败：" + err2.message);
    return;
  }

  const { data: snaps, error: err3 } = await supabase
    .from(SUPABASE_TABLE)
    .select("key,updated_at")
    .like("key", "snap_%")
    .order("updated_at", { ascending: false });
  if (!err3 && Array.isArray(snaps) && snaps.length > 5) {
    const toDelete = snaps.slice(5).map((s) => s.key);
    if (toDelete.length) {
      await supabase.from(SUPABASE_TABLE).delete().in("key", toDelete);
    }
  }

  alert(`✅ 已保存到云端\n操作人：${getCurrentUserName()}`);
  await renderCloudHistory();
}

async function cloudLoad(key = SUPABASE_DEFAULT_KEY) {
  if (!supabase) {
    alert("未配置 Supabase，无法从云端加载。");
    return;
  }
  
  // ✅ 权限检查：检查是否有权限访问此资源
  console.log('🔍 开始权限检查，key:', key);
  const hasPermission = await checkPermission(key, 'snapshot', 'view');
  console.log('✅ 权限检查结果:', hasPermission, 'isAdmin:', isAdmin());
  
  if (!hasPermission && !isAdmin()) {
    console.error('❌ 权限检查失败，没有权限访问资源');
    alert("❌ 您没有权限访问此资源\n\n请联系资源所有者授予权限\n\n如果已授权，请确保已执行 fix-snapshot-rls.sql 文件");
    return;
  }
  
  console.log('✅ 权限检查通过，继续加载数据');
  
  // 检查本地是否有未保存的修改
  const localRows = await getAllRows();
  const hasRecentChanges = localRows.some(row => {
    return (Date.now() - (row.updated_at || 0)) < 300000; // 5分钟内
  });
  
  if (hasRecentChanges) {
    const shouldContinue = confirm(
      "⚠️ 警告：您有最近的本地修改尚未保存到云端\n\n" +
      "如果现在加载云端数据，本地修改将被覆盖！\n\n" +
      "建议：\n" +
      "1. 点击【取消】，先点击【保存云端】按钮\n" +
      "2. 如果确定要放弃本地修改，点击【确定】\n\n" +
      "是否继续加载云端数据？"
    );
    
    if (!shouldContinue) return;
  }
  
  console.log('🔍 开始查询云端数据，key:', key);
  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
    .select("payload, owner_id")
    .eq("key", key)
    .maybeSingle();
  
  if (error) {
    console.error('❌ 云端读取失败:', error);
    alert(`❌ 云端读取失败：${error.message}\n\n如果提示权限错误，请确保已执行 fix-snapshot-rls.sql 文件`);
    return;
  }
  
  if (!data) {
    console.error('❌ 未找到云端数据，key:', key);
    alert(`❌ 未找到云端数据（key: ${key}）\n\n可能原因：\n1. 数据不存在\n2. 没有访问权限（请检查 RLS 策略）`);
    return;
  }
  
  console.log('✅ 成功查询到云端数据:', data);
  const payload = data.payload || {};
  const rows = payload.rows || [];
  const cats = payload.cats || DEFAULT_CATS;
  const view = payload.view || DEFAULT_VIEW;
  const savedBy = payload.updated_by_name || '未知用户';

  await db.rows.clear();
  if (rows.length) await db.rows.bulkAdd(rows);

  saveCats(cats);
  saveView({ ...DEFAULT_VIEW, ...view });

  await refreshFilters();
  applyView(readView());
  await renderTable();
  alert(`✅ 云端数据已加载\n最后保存人：${savedBy}`);
}

async function renderCloudHistory() {
  const panel = $("#cloudHistoryPanel");
  if (!panel) return;
  if (!supabase) {
    panel.innerHTML =
      `<div style="padding:8px 10px;color:#888;">未配置 Supabase</div>`;
    return;
  }
  
  const currentUserId = getCurrentUserId();
  
  try {
    // ✅ 改进：查询所有可访问的快照（包括授权的快照）
    // RLS策略会自动过滤出有权限的快照
  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
      .select("key,payload,updated_at,owner_id")
    .order("updated_at", { ascending: false })
      .limit(20); // 增加数量以包含更多快照
    
  if (error) {
      console.error('❌ 加载历史失败:', error);
    panel.innerHTML =
        `<div style="padding:8px 10px;color:#ff3b30;">加载历史失败: ${escapeHtml(error.message)}</div>`;
    return;
  }
    
  if (!Array.isArray(data) || !data.length) {
    panel.innerHTML =
      `<div style="padding:8px 10px;color:#888;">暂无历史快照</div>`;
    return;
  }
    
    // ✅ 获取所有快照所有者的用户信息
    const ownerIds = [...new Set(data.map(s => s.owner_id).filter(Boolean))];
    let ownerMap = {};
    
    if (ownerIds.length > 0) {
      const { data: ownerProfiles } = await supabase
        .from('user_profiles')
        .select('user_id, username')
        .in('user_id', ownerIds);
      
      if (ownerProfiles) {
        ownerProfiles.forEach(profile => {
          ownerMap[profile.user_id] = profile.username;
        });
      }
    }
    
    // ✅ 分组显示：我的快照 和 授权快照
    const mySnapshots = data.filter(s => s.owner_id === currentUserId);
    const sharedSnapshots = data.filter(s => s.owner_id !== currentUserId);
    
    let html = '';
    
    // 显示我的快照
    if (mySnapshots.length > 0) {
      html += `<div style="padding:8px 10px;font-weight:600;color:#1990FF;font-size:13px;border-bottom:1px solid #e5e5ea;">📁 我的快照</div>`;
      html += mySnapshots.map((row) => {
        const name = (row.payload?.snapshot_label || row.key).trim();
      const t = fmtTime(row.updated_at);
        const userName = row.payload?.updated_by_name || ownerMap[row.owner_id] || '未知';
      const metaCount = Array.isArray(row.payload?.rows)
        ? `${row.payload.rows.length} 条`
        : "";
        const isDefault = row.key === 'default';
        const displayName = isDefault ? '📌 默认快照' : name;
        
      return `<div class="cloud-item" data-key="${row.key}">
        <div class="cloud-item-main">
            <div class="cloud-item-name">${escapeHtml(displayName)}</div>
          <div class="cloud-item-meta">${escapeHtml(metaCount)} · 修改人：${escapeHtml(userName)}</div>
        </div>
        <div class="cloud-item-time">${escapeHtml(t)}</div>
      </div>`;
      }).join("");
    }
    
    // 显示授权给我的快照
    if (sharedSnapshots.length > 0) {
      html += `<div style="padding:8px 10px;font-weight:600;color:#34c759;font-size:13px;border-bottom:1px solid #e5e5ea;margin-top:10px;">🔓 授权快照</div>`;
      html += sharedSnapshots.map((row) => {
        const name = (row.payload?.snapshot_label || row.key).trim();
        const t = fmtTime(row.updated_at);
        const ownerName = ownerMap[row.owner_id] || '未知';
        const userName = row.payload?.updated_by_name || ownerName;
        const metaCount = Array.isArray(row.payload?.rows)
          ? `${row.payload.rows.length} 条`
          : "";
        const isDefault = row.key === 'default';
        const displayName = isDefault ? `📌 ${ownerName}的默认快照` : name;
        
        return `<div class="cloud-item" data-key="${row.key}" style="background:#f0fff4;">
          <div class="cloud-item-main">
            <div class="cloud-item-name">${escapeHtml(displayName)}</div>
            <div class="cloud-item-meta">所有者：${escapeHtml(ownerName)} · ${escapeHtml(metaCount)} · 修改人：${escapeHtml(userName)}</div>
          </div>
          <div class="cloud-item-time">${escapeHtml(t)}</div>
        </div>`;
      }).join("");
    }
    
    if (html === '') {
      panel.innerHTML = `<div style="padding:8px 10px;color:#888;">暂无历史快照</div>`;
      return;
    }
    
    panel.innerHTML = html;
    
    // 绑定点击事件
  panel.querySelectorAll(".cloud-item").forEach((el) => {
    el.addEventListener("click", async () => {
      const key = el.getAttribute("data-key");
      if (!key) return;
        
        // 检查权限
        const hasPermission = await checkPermission(key, 'snapshot', 'view');
        if (!hasPermission && !isAdmin()) {
          alert("❌ 您没有权限访问此快照");
          return;
        }
        
      if (confirm("确定用该快照覆盖本地数据？")) {
        await cloudLoad(key);
      }
    });
  });
    
    console.log(`✅ 云端历史加载成功: ${mySnapshots.length} 个我的快照, ${sharedSnapshots.length} 个授权快照`);
    
  } catch (err) {
    console.error('❌ 渲染云端历史失败:', err);
    panel.innerHTML =
      `<div style="padding:8px 10px;color:#ff3b30;">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

/* =========================
 * 10. 分类设置 UI
 * ========================= */

function renderCatList() {
  const list = $("#catList");
  const cats = readCats();
  list.innerHTML = cats
    .map(
      (c, i) => `<div class="cat-row" data-id="${c.id}">
        <span class="cat-color-preview" style="background:${escapeHtml(
          c.color
        )}"></span>
        <div class="cat-name" contenteditable="true">${escapeHtml(c.name)}</div>
        <div class="cat-actions">
          <button class="ghost" data-act="up" ${i === 0 ? "disabled" : ""}>上移</button>
          <button class="ghost" data-act="down" ${
            i === cats.length - 1 ? "disabled" : ""
          }>下移</button>
          <input type="color" value="${escapeHtml(
            c.color
          )}" data-act="color" style="height:28px;border-radius:8px;border:1px solid #e5e5ea;padding:0 2px;">
          <button class="btn-danger" data-act="del">删除</button>
        </div>
      </div>`
    )
    .join("");

  list.querySelectorAll(".cat-name").forEach((el) => {
    el.addEventListener("blur", () => {
      const id = el.closest(".cat-row").getAttribute("data-id");
      const v = el.textContent.trim();
      const cats = readCats();
      const idx = cats.findIndex((x) => x.id === id);
      if (idx >= 0) {
        cats[idx] = { ...cats[idx], name: v || cats[idx].name };
        saveCats(cats);
        renderTable();
      }
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        el.blur();
      }
    });
  });

  list.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.closest(".cat-row");
      const id = row.getAttribute("data-id");
      const act = btn.getAttribute("data-act");
      const cats = readCats();
      const idx = cats.findIndex((x) => x.id === id);
      if (idx < 0) return;

      if (act === "up" && idx > 0) {
        [cats[idx - 1], cats[idx]] = [cats[idx], cats[idx - 1]];
      } else if (act === "down" && idx < cats.length - 1) {
        [cats[idx + 1], cats[idx]] = [cats[idx], cats[idx + 1]];
      } else if (act === "del") {
        if (!confirm("确定删除该分类？")) return;
        cats.splice(idx, 1);
      }
      saveCats(cats);
      renderCatList();
      renderTable();
    });
  });

  list
    .querySelectorAll('input[type="color"][data-act="color"]')
    .forEach((el) => {
      el.addEventListener("change", () => {
        const row = el.closest(".cat-row");
        const id = row.getAttribute("data-id");
        const cats = readCats();
        const idx = cats.findIndex((x) => x.id === id);
        if (idx < 0) return;
        cats[idx] = { ...cats[idx], color: el.value };
        saveCats(cats);
        renderCatList();
        renderTable();
      });
    });
}

/* =========================
 * 11. 事件绑定 & 初始化
 * ========================= */

function bindEvents() {
  // ✅✅✅ 关键：使用事件委托在 tbody 上监听，避免重复绑定
  const gridBody = $("#gridBody");
  
  // 监听 contenteditable 元素的 focus 事件（事件委托）
  gridBody.addEventListener("focus", (e) => {
    const td = e.target.closest('td[contenteditable="true"]');
    if (!td) return;
    
    // 如果是小红书名称列，显示完整文本
    if (td.classList.contains("col-xhs")) {
      const id = td.getAttribute("data-id");
      // 从数据库获取完整文本
      db.rows.get(id).then(row => {
        if (row) td.textContent = row.xhs_name || "";
      });
    }
  }, true); // 使用捕获阶段
  
  // 监听 contenteditable 元素的 blur 事件（事件委托）
  gridBody.addEventListener("blur", async (e) => {
    const td = e.target.closest('td[contenteditable="true"]');
    if (!td) return;
    
    const id = td.getAttribute("data-id");
    const field = td.getAttribute("data-field");
    const val = td.textContent.trim();
    
    console.log(`📝 blur 事件: field=${field}, value=${val}`);
    
    // 更新数据库
    const row = await db.rows.get(id);
    if (row) {
      const patch = {};
      patch[field] = val;
      patch.updated_at = Date.now();
      await db.rows.put({ ...row, ...patch });
    }
    
    // 如果是所属人或微信实名人，刷新筛选器
    if (field === "owner" || field === "wx_real") {
      await refreshFilters();
    }
    
    // 重新渲染
    await renderTable();
  }, true); // 使用捕获阶段
  
  // 监听 contenteditable 元素的 keydown 事件（事件委托）
  gridBody.addEventListener("keydown", (e) => {
    const td = e.target.closest('td[contenteditable="true"]');
    if (!td) return;
    
    if (e.key === "Enter") {
      e.preventDefault();
      td.blur();
    }
  });
  
  // 监听分类选择器的 change 事件（事件委托）
  gridBody.addEventListener("change", async (e) => {
    console.log("🔔 change 事件触发，目标：", e.target.tagName, e.target);
    
    const sel = e.target.closest('select[data-field="row_color"]');
    console.log("🔍 找到的 select 元素：", sel);
    
    if (!sel) {
      console.log("❌ 未找到匹配的 select 元素");
      return;
    }
    
    const id = sel.getAttribute("data-id");
    const newColor = sel.value;
    console.log(`✅ 分类改变: ID=${id}, 新分类=${newColor}`);
    
    // 更新数据库
    const row = await db.rows.get(id);
    console.log("📖 读取的行数据：", row);
    
    if (row) {
      const updated = { 
        ...row, 
        row_color: newColor, 
        updated_at: Date.now() 
      };
      console.log("💾 准备更新数据库：", updated);
      await db.rows.put(updated);
      console.log("✅ 数据库更新成功");
    }
    
    // 重新渲染整个表格
    console.log("🎨 开始重新渲染表格");
    await renderTable();
    console.log("✅ 渲染完成");
  });
  
  // 监听操作按钮的 click 事件（事件委托）
  gridBody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    
    const id = btn.getAttribute("data-id");
    const act = btn.getAttribute("data-act");
    
    if (act === "up") {
      await moveRow(id, "up");
    } else if (act === "down") {
      await moveRow(id, "down");
    } else if (act === "del") {
      if (confirm("确定删除该行？")) {
        await deleteRowById(id);
      }
    }
  });
  
  // ✅✅✅ 移动端事件委托
  const mobileList = $("#mobileList");
  
  // 监听移动端卡片头部的点击（展开/折叠）
  mobileList.addEventListener("click", async (e) => {
    const header = e.target.closest(".m-row-header");
    if (header) {
      const card = header.closest(".m-row");
      if (card) {
        // 如果卡片有未保存的修改，提示用户
        if (card.classList.contains('open') && card.classList.contains('modified')) {
          if (!confirm('有未保存的修改，确定要关闭吗？')) {
            return;
          }
          card.classList.remove('modified');
          await renderTable();
        }
        card.classList.toggle("open");
      }
      return;
    }
    
    // 处理操作按钮
    const btn = e.target.closest("button[data-mact]");
    if (btn) {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      const act = btn.getAttribute("data-mact");
      
      if (act === "up") {
        await moveRow(id, "up");
      } else if (act === "down") {
        await moveRow(id, "down");
      } else if (act === "del") {
        if (confirm("确定删除该行？")) {
          await deleteRowById(id);
        }
      } else if (act === "save") {
        // ✅ 保存修改
        await saveMobileCardEdit(id);
      } else if (act === "cancel") {
        // ✅ 取消修改
        await cancelMobileCardEdit(id);
      }
    }
  });
  
  // ✅ 监听移动端输入变化（标记为已修改，不自动保存）
  mobileList.addEventListener("input", (e) => {
    const input = e.target.closest('.m-input, .m-textarea');
    if (!input) return;
    
    const card = input.closest('.m-row');
    if (card) {
      card.classList.add('modified');
    }
  });
  
  // 监听移动端分类选择器的 change 事件（标记为已修改，不自动保存）
  mobileList.addEventListener("change", (e) => {
    const sel = e.target.closest('select[data-field="row_color"]');
    if (!sel) return;
    
    const card = sel.closest('.m-row');
    if (card) {
      card.classList.add('modified');
    }
  });
  
  $("#q").addEventListener("input", async (e) => {
    state.q = e.target.value || "";
    await renderTable();
  });

  $("#btnSearchMode").addEventListener("click", async () => {
    setActiveFunction("search");
    state.precise = !state.precise;
    $("#btnSearchMode").textContent = state.precise
      ? "当前：精准搜索"
      : "当前：模糊搜索";
    await renderTable();
  });

  $("#filterOwner").addEventListener("change", async (e) => {
    state.owner = e.target.value;
    await renderTable();
  });

  $("#filterWxReal").addEventListener("change", async (e) => {
    state.wxReal = e.target.value;
    await renderTable();
  });

  $("#sortBy").addEventListener("change", async (e) => {
    state.sortBy = e.target.value;
    await renderTable();
  });

  $("#btnAdd").addEventListener("click", async () => {
    setActiveFunction("add");
    await addRow();
  });

  $("#btnImportCSV").addEventListener("click", () => {
    setActiveFunction("import");
    $("#csvFile").click();
  });

  $("#csvFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const items = parseCSV(text);
    if (!items.length) {
      alert("CSV 为空或格式不符合简单导入要求。");
      return;
    }
    const all = await getAllRows();
    let maxOrder = all.length ? Math.max(...all.map((r) => r.order || 0)) : 0;
    const rows = items.map((it) => ({
      id: uid(),
      order: ++maxOrder,
      phone: it.phone || "",
      owner: it.owner || "",
      wx_real: it.wx_real || "",
      wx_name: it.wx_name || "",
      xhs_name: it.xhs_name || "",
      note1: it.note1 || "",
      row_color: it.row_color || "",
      updated_at: Date.now(),
    }));
    await db.rows.bulkAdd(rows);
    await refreshFilters();
    await renderTable();
    alert("导入成功！");
  });

  $("#btnExportCSV").addEventListener("click", async () => {
    setActiveFunction("export");
    const all = await getAllRows();
    const csv = toCSV(all);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "xhsphone.csv";
    a.click();
    URL.revokeObjectURL(url);
  });

  $("#btnSaveCloud").addEventListener("click", async () => {
    setActiveFunction("saveCloud");
    await cloudSave();
  });

  $("#btnLoadCloud").addEventListener("click", async () => {
    setActiveFunction("loadCloud");
    const panel = $("#cloudHistoryPanel");
    if (panel.style.display === "none") {
      panel.style.display = "block";
      await renderCloudHistory();
    } else {
      panel.style.display = "none";
    }
  });

  $("#btnClearAll").addEventListener("click", async () => {
    setActiveFunction("clear");
    if (!confirm("确定清空本地所有数据？此操作不可恢复。")) return;
    await db.rows.clear();
    await refreshFilters();
    await renderTable();
  });

  $("#btnCategories").addEventListener("click", () => {
    setActiveFunction("categories");
    const p = $("#panelCategories");
    const pView = $("#panelView");
    
    // ✅ 互斥展开：关闭显示设置面板
    if (p.style.display === "none") {
      p.style.display = "block";
      pView.style.display = "none";
      renderCatList();
    } else {
      p.style.display = "none";
    }
  });

  $("#btnCatAdd").addEventListener("click", () => {
    const name = ($("#catName").value || "").trim();
    const color = ($("#catColor").value || "#007aff").trim();
    if (!name) {
      alert("请填写分类名称");
      return;
    }
    const cats = readCats();
    cats.push({ id: uid(), name, color });
    saveCats(cats);
    $("#catName").value = "";
    renderCatList();
    renderTable();
  });

  $("#btnView").addEventListener("click", () => {
    setActiveFunction("view");
    const p = $("#panelView");
    const pCat = $("#panelCategories");
    
    // ✅ 互斥展开：关闭分类设置面板
    if (p.style.display === "none") {
      p.style.display = "block";
      pCat.style.display = "none";
      const v = readView();
      $("#titleText").value = v.titleText;
      $("#titleColor").value = v.titleColor || "#1990FF";
      $("#fontFamily").value = v.fontFamily;
      $("#rowPad").value = v.pad;
      $("#colScale").value = v.colScale;
      $("#zebraOn").checked = v.zebraOn;
      $("#zebraColor").value = v.zebraColor;
      $("#btnColor").value = v.btnColor || "#E2F0FF";
    } else {
      p.style.display = "none";
    }
  });

  $("#titleText").addEventListener("input", () => {
    const v = readView();
    v.titleText = $("#titleText").value || "XHSPHONE";
    saveView(v);
    applyView(v);
  });

  $("#titleColor").addEventListener("input", () => {
    const v = readView();
    v.titleColor = $("#titleColor").value || "#1990FF";
    saveView(v);
    applyView(v);
  });

  $("#btnColor").addEventListener("input", () => {
    const v = readView();
    v.btnColor = $("#btnColor").value || "#E2F0FF";
    saveView(v);
    applyView(v);
  });

  $("#fontFamily").addEventListener("change", () => {
    const v = readView();
    v.fontFamily = $("#fontFamily").value;
    saveView(v);
    applyView(v);
  });

  $("#rowPad").addEventListener("input", () => {
    const v = readView();
    v.pad = Number($("#rowPad").value) || 6;
    saveView(v);
    applyView(v);
  });

  $("#colScale").addEventListener("input", () => {
    const v = readView();
    v.colScale = Number($("#colScale").value) || 1;
    saveView(v);
    applyView(v);
  });

  $("#zebraOn").addEventListener("change", () => {
    const v = readView();
    v.zebraOn = $("#zebraOn").checked;
    saveView(v);
    applyView(v);
    renderTable();
  });

  $("#zebraColor").addEventListener("input", () => {
    const v = readView();
    v.zebraColor = $("#zebraColor").value || "#e2f0ff";
    saveView(v);
    applyView(v);
    renderTable();
  });

  $("#btnCompact").addEventListener("click", () => {
    const v = readView();
    v.pad = 5;
    v.colScale = 0.95;
    saveView(v);
    applyView(v);
  });

  $("#btnResetSize").addEventListener("click", () => {
    saveView({
      ...DEFAULT_VIEW,
      titleText: readView().titleText,
      titleColor: readView().titleColor,
    });
    applyView(readView());
    renderTable();
  });
  
  // ✅ 用户相关功能
  // 显示当前用户名
  const currentUserName = $("#currentUserName");
  if (currentUserName && window.currentUser) {
    currentUserName.textContent = `👤 ${window.currentUser.name}`;
  }
  
  // 退出登录
  const btnLogout = $("#btnLogout");
  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      if (!confirm("确定要退出登录吗？")) return;
      
      if (supabase) {
        await supabase.auth.signOut();
      }
      
      // 清除本地数据
      localStorage.removeItem('xhs_remember_me');
      
      // 跳转到登录页
      window.location.href = 'login.html';
    });
  }
  
  // 审核管理按钮（仅管理员可见）
  const btnApprovalManagement = $("#btnApprovalManagement");
  if (btnApprovalManagement) {
    // 检查是否是管理员（从 localStorage 或 window.isAdmin）
    const isAdmin = window.isAdmin || localStorage.getItem('xhs_is_admin') === 'true';
    console.log('🔍 检查管理员权限:', { 
      windowIsAdmin: window.isAdmin, 
      localStorageIsAdmin: localStorage.getItem('xhs_is_admin'),
      finalIsAdmin: isAdmin 
    });
    
    if (isAdmin) {
      btnApprovalManagement.style.display = 'inline-block';
      btnApprovalManagement.addEventListener("click", () => {
        window.location.href = 'approval-management.html';
      });
    } else {
      btnApprovalManagement.style.display = 'none';
    }
  }
  
  // 用户管理按钮（仅管理员可见）
  const btnUserManagement = $("#btnUserManagement");
  if (btnUserManagement) {
    // 检查是否是管理员（从 localStorage 或 window.isAdmin）
    const isAdmin = window.isAdmin || localStorage.getItem('xhs_is_admin') === 'true';
    
    if (isAdmin) {
      btnUserManagement.style.display = 'inline-block';
      btnUserManagement.addEventListener("click", () => {
        window.location.href = 'user-management.html';
      });
    } else {
      btnUserManagement.style.display = 'none';
    }
  }
  
  // 权限管理按钮（所有用户可见）
  const btnPermissionManagement = $("#btnPermissionManagement");
  if (btnPermissionManagement) {
    btnPermissionManagement.style.display = 'inline-block';
    btnPermissionManagement.addEventListener("click", () => {
      window.location.href = 'permission-management.html';
    });
  }
  
  // 快照浏览器按钮（所有用户可见）
  const btnSnapshotBrowser = $("#btnSnapshotBrowser");
  if (btnSnapshotBrowser) {
    btnSnapshotBrowser.addEventListener("click", () => {
      window.location.href = 'snapshot-browser.html';
    });
  }
}

/* =========================
 * 11.5. 在线状态管理
 * ========================= */

const ONLINE_STATUS_KEY = 'xhs_online_users';
const HEARTBEAT_INTERVAL = 5000; // 5秒心跳

class OnlineStatusManager {
  constructor() {
    this.userId = getCurrentUserId();
    this.userName = getCurrentUserName();
    this.startHeartbeat();
    this.updateUI();
    
    // 监听 storage 变化
    window.addEventListener('storage', (e) => {
      if (e.key === ONLINE_STATUS_KEY) {
        this.updateUI();
      }
    });
  }
  
  startHeartbeat() {
    // 立即更新一次
    this.updateOnlineStatus();
    
    // 定时更新
    this.heartbeatTimer = setInterval(() => {
      this.updateOnlineStatus();
    }, HEARTBEAT_INTERVAL);
    
    // 页面关闭时清除
    window.addEventListener('beforeunload', () => {
      this.removeOnlineStatus();
    });
  }
  
  updateOnlineStatus() {
    const now = Date.now();
    const onlineUsers = this.getOnlineUsers();
    
    onlineUsers[this.userId] = {
      name: this.userName,
      lastSeen: now
    };
    
    // 清理超过30秒未更新的用户
    for (const [id, user] of Object.entries(onlineUsers)) {
      if (now - user.lastSeen > 30000) {
        delete onlineUsers[id];
      }
    }
    
    localStorage.setItem(ONLINE_STATUS_KEY, JSON.stringify(onlineUsers));
  }
  
  removeOnlineStatus() {
    const onlineUsers = this.getOnlineUsers();
    delete onlineUsers[this.userId];
    localStorage.setItem(ONLINE_STATUS_KEY, JSON.stringify(onlineUsers));
  }
  
  getOnlineUsers() {
    try {
      const data = localStorage.getItem(ONLINE_STATUS_KEY);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }
  
  updateUI() {
    const onlineUsers = this.getOnlineUsers();
    const otherUsers = Object.entries(onlineUsers)
      .filter(([id]) => id !== this.userId)
      .map(([_, user]) => user.name);
    
    const statusEl = document.getElementById('onlineStatus');
    if (statusEl && otherUsers.length > 0) {
      statusEl.textContent = `🟢 ${otherUsers.join(', ')} 在线`;
      statusEl.style.display = 'inline-block';
    } else if (statusEl) {
      statusEl.style.display = 'none';
    }
  }
}

/* =========================
 * 12. 启动
 * ========================= */

document.addEventListener("DOMContentLoaded", async () => {
  console.log("✅ 应用启动");
  
  // ✅ 等待一下，确保 window.isAdmin 已经设置（增加等待时间）
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // ✅ 再次检查管理员权限（如果还没有设置）
  if (!window.isAdmin && localStorage.getItem('xhs_is_admin') === 'true') {
    window.isAdmin = true;
    console.log('✅ 从 localStorage 恢复管理员权限');
  }
  
  // ✅ 确保管理员权限已设置（再次检查）
  const finalIsAdmin = window.isAdmin || localStorage.getItem('xhs_is_admin') === 'true';
  if (finalIsAdmin && !window.isAdmin) {
    window.isAdmin = true;
    console.log('✅ 最终确认：设置管理员权限');
  }
  
  // 初始化在线状态管理
  if (window.currentUser) {
    window.onlineStatusManager = new OnlineStatusManager();
  }
  
  applyView(readView());
  bindEvents();
  await refreshFilters();
  await renderTable();
  
  await initSupabase();
  
  const panel = $("#cloudHistoryPanel");
  if (panel) panel.style.display = "none";
  
  // ✅ 检查是否从快照浏览器返回，自动加载快照
  const loadSnapshotKey = localStorage.getItem('xhs_load_snapshot_key');
  if (loadSnapshotKey && supabase) {
    console.log(`📥 检测到待加载快照: ${loadSnapshotKey}`);
    localStorage.removeItem('xhs_load_snapshot_key');
    
    // 延迟加载，确保UI已完全初始化
    setTimeout(async () => {
      try {
        await cloudLoad(loadSnapshotKey);
        console.log(`✅ 自动加载快照成功: ${loadSnapshotKey}`);
      } catch (err) {
        console.error('❌ 自动加载快照失败:', err);
        alert(`❌ 自动加载快照失败：${err.message}`);
      }
    }, 1000);
  }
  
  console.log("✅ 应用初始化完成", { 
    currentUser: window.currentUser, 
    isAdmin: window.isAdmin,
    localStorageIsAdmin: localStorage.getItem('xhs_is_admin')
  });
  
  // ✅ 页面加载完成后，再次检查并显示管理员按钮（确保显示）
  setTimeout(() => {
    const btnApproval = document.getElementById('btnApprovalManagement');
    const btnUser = document.getElementById('btnUserManagement');
    const btnPermission = document.getElementById('btnPermissionManagement');
    const isAdmin = window.isAdmin || localStorage.getItem('xhs_is_admin') === 'true';
    
    if (isAdmin) {
      if (btnApproval) {
        btnApproval.style.display = 'inline-block';
        console.log('✅ 延迟检查：显示审核管理按钮');
      }
      if (btnUser) {
        btnUser.style.display = 'inline-block';
        console.log('✅ 延迟检查：显示用户管理按钮');
      }
    }
    
    // 权限管理按钮所有用户可见
    if (btnPermission) {
      btnPermission.style.display = 'inline-block';
      console.log('✅ 延迟检查：显示权限管理按钮');
    }
  }, 500);
});
