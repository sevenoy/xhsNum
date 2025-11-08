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
  viewVersion: 7,
  pad: 6,
  colScale: 1,
  zebraOn: true,
  zebraColor: "#e2f0ff",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"SF Pro Text",Helvetica,Arial,sans-serif',
  titleText: "XHSPHONE",
  titleColor: "#111111",
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

  const h1 = document.getElementById("appTitle");
  if (h1) {
    h1.textContent = v.titleText;
    h1.style.color = v.titleColor;
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
    if (Array.isArray(obj) && obj.length) return obj;
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

// ✅ 截断字符串显示前10个字符
function truncateText(text, maxChars = 10) {
  if (!text) return "";
  const str = String(text);
  if (str.length <= maxChars) return str;
  return str.slice(0, maxChars) + "...";
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
  const maxOrder = all.length ? Math.max(...all.map((r) => r.order || 0)) : 0;
  const row = {
    id: uid(),
    order: maxOrder + 1,
    phone: "",
    owner: "",
    wx_real: "",
    wx_name: "",
    xhs_name: "",
    note1: "",
    row_color: "",
    updated_at: Date.now(),
  };
  await db.rows.add(row);
  await refreshFilters();
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
  const xhsDisplay = truncateText(r.xhs_name, 10);
  // ✅ 使用 data-cat 属性代替内联样式（遵循 frontend.mdc 规则）
  const catAttr = r.row_color ? `data-cat="${escapeHtml(r.row_color)}"` : "";
  
  return `<tr data-id="${r.id}">
    ${tdEditable("col-phone", r.phone, "phone", r.id)}
    ${tdEditable("col-owner", r.owner, "owner", r.id)}
    ${tdEditable("col-real", r.wx_real, "wx_real", r.id)}
    ${tdEditable("col-wx", r.wx_name, "wx_name", r.id)}
    <td class="col-xhs" contenteditable="true" data-field="xhs_name" data-id="${r.id}" ${catAttr} title="${escapeHtml(r.xhs_name || "")}">${escapeHtml(xhsDisplay)}</td>
    ${tdEditable("col-note", r.note1, "note1", r.id)}
    ${tdSelectCat("col-cat", r.row_color, r.id)}
    ${tdActions(r.id)}
  </tr>`;
}

async function renderTable() {
  const tbody = $("#gridBody");
  const all = await getAllRows();
  const rows = applyFilters(all);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">暂无数据，点击"新增一行"开始录入</td></tr>`;
  } else {
    tbody.innerHTML = rows.map((r) => makeRowTr(r)).join("");
  }

  renderMobileList(rows);
}

function renderMobileList(rows) {
  const container = $("#mobileList");
  const v = readView();

  if (!rows.length) {
    container.innerHTML = `<div class="empty-state">暂无数据</div>`;
    return;
  }
  
  const cats = readCats();
  
  container.innerHTML = rows
    .map((r, idx) => {
      const zebraClass = v.zebraOn && idx % 2 === 1 ? "zebra-even" : "";
      const catAttr = r.row_color ? `data-cat="${escapeHtml(r.row_color)}"` : "";
      const catName = catNameOf(cats, r.row_color);
      const xhsDisplay = truncateText(r.xhs_name, 10);
      
      return `<div class="m-row ${zebraClass}" data-id="${r.id}">
        <button class="m-row-header" data-id="${r.id}">
          <div class="m-main-line">
            <span class="m-phone">${escapeHtml(r.phone || "")}</span>
            <span class="m-xhs" title="${escapeHtml(r.xhs_name || "")}">${escapeHtml(xhsDisplay)}</span>
            <span class="m-arrow">▾</span>
          </div>
          <div class="m-meta-line">
            <span class="m-owner">所属人：${escapeHtml(r.owner || "-")}</span>
            <span class="m-cat-pill" ${catAttr}>${escapeHtml(catName || "未分类")}</span>
          </div>
        </button>
        <div class="m-row-details">
          ${mobileDetail("微信实名人", r.wx_real, "wx_real", r.id)}
          ${mobileDetail("对应微信名", r.wx_name, "wx_name", r.id)}
          ${mobileDetail("小红书名称", r.xhs_name, "xhs_name", r.id)}
          ${mobileDetail("备注", r.note1, "note1", r.id)}
          ${mobileCat(r.row_color, r.id)}
          <div class="m-actions">
            <button class="ghost" data-mact="up" data-id="${r.id}">上移</button>
            <button class="ghost" data-mact="down" data-id="${r.id}">下移</button>
            <button class="btn-danger" data-mact="del" data-id="${r.id}">删除</button>
          </div>
        </div>
      </div>`;
    })
    .join("");

  function mobileDetail(label, text, field, id) {
    return `<div class="m-detail-row">
      <div class="m-detail-label">${escapeHtml(label)}</div>
      <div class="m-detail-value" contenteditable="true" data-field="${field}" data-id="${id}">${escapeHtml(
      text || ""
    )}</div>
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
        <select data-field="row_color" data-id="${id}">
          ${opts}
        </select>
      </div>
    </div>`;
  }
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
    rows: all,
    cats,
    view,
  };

  const { error: err1 } = await supabase.from(SUPABASE_TABLE).upsert({
    key: SUPABASE_DEFAULT_KEY,
    payload,
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

  alert("已保存到云端。");
  await renderCloudHistory();
}

async function cloudLoad(key = SUPABASE_DEFAULT_KEY) {
  if (!supabase) {
    alert("未配置 Supabase，无法从云端加载。");
    return;
  }
  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
    .select("payload")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) {
    alert("云端读取失败。");
    return;
  }
  const payload = data.payload || {};
  const rows = payload.rows || [];
  const cats = payload.cats || DEFAULT_CATS;
  const view = payload.view || DEFAULT_VIEW;

  await db.rows.clear();
  if (rows.length) await db.rows.bulkAdd(rows);

  saveCats(cats);
  saveView({ ...DEFAULT_VIEW, ...view });

  await refreshFilters();
  applyView(readView());
  await renderTable();
  alert("云端数据已加载。");
}

async function renderCloudHistory() {
  const panel = $("#cloudHistoryPanel");
  if (!panel) return;
  if (!supabase) {
    panel.innerHTML = `<div class="cloud-msg">未配置 Supabase</div>`;
    return;
  }
  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
    .select("key,payload,updated_at")
    .like("key", "snap_%")
    .order("updated_at", { ascending: false })
    .limit(5);
  if (error) {
    panel.innerHTML = `<div class="cloud-msg error">加载历史失败</div>`;
    return;
  }
  if (!Array.isArray(data) || !data.length) {
    panel.innerHTML = `<div class="cloud-msg">暂无历史快照</div>`;
    return;
  }
  panel.innerHTML = data
    .map((row) => {
      const name = (row.payload?.snapshot_label || "快照").trim();
      const t = fmtTime(row.updated_at);
      const metaCount = Array.isArray(row.payload?.rows)
        ? `${row.payload.rows.length} 条`
        : "";
      return `<div class="cloud-item" data-key="${row.key}">
        <div class="cloud-item-main">
          <div class="cloud-item-name">${escapeHtml(name)}</div>
          <div class="cloud-item-meta">${escapeHtml(metaCount)}</div>
        </div>
        <div class="cloud-item-time">${escapeHtml(t)}</div>
      </div>`;
    })
    .join("");

  panel.querySelectorAll(".cloud-item").forEach((el) => {
    el.addEventListener("click", async () => {
      const key = el.getAttribute("data-key");
      if (!key) return;
      if (confirm("确定用该快照覆盖本地数据？")) {
        await cloudLoad(key);
      }
    });
  });
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
        <span class="cat-color-preview" data-color="${escapeHtml(c.color)}"></span>
        <div class="cat-name" contenteditable="true">${escapeHtml(c.name)}</div>
        <div class="cat-actions">
          <button class="ghost" data-act="up" ${i === 0 ? "disabled" : ""}>上移</button>
          <button class="ghost" data-act="down" ${
            i === cats.length - 1 ? "disabled" : ""
          }>下移</button>
          <input type="color" value="${escapeHtml(c.color)}" data-act="color" class="cat-color-input">
          <button class="btn-danger" data-act="del">删除</button>
        </div>
      </div>`
    )
    .join("");

  // 使用CSS变量设置颜色预览
  list.querySelectorAll(".cat-color-preview").forEach((el) => {
    const color = el.getAttribute("data-color");
    if (color) el.style.background = color;
  });

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
  const gridBody = $("#gridBody");
  const mobileList = $("#mobileList");

  // ✅✅✅ 桌面端：使用事件委托监听 contenteditable 的 blur 事件
  gridBody.addEventListener("blur", async (e) => {
    const td = e.target.closest('td[contenteditable="true"]');
    if (!td) return;
    
    const id = td.getAttribute("data-id");
    const field = td.getAttribute("data-field");
    const val = td.innerText.trim(); // ✅ 使用 innerText 而不是 textContent
    
    const row = await db.rows.get(id);
    if (!row) return;
    
    const patch = {};
    patch[field] = val;
    patch.updated_at = Date.now();
    await db.rows.put({ ...row, ...patch });
    
    if (field === "owner" || field === "wx_real") {
      await refreshFilters();
    }
    
    await renderTable();
  }, true);
  
  // ✅✅✅ 桌面端：监听 contenteditable 的 focus 事件
  gridBody.addEventListener("focus", (e) => {
    const td = e.target.closest('td[contenteditable="true"]');
    if (!td) return;
    
    if (td.classList.contains("col-xhs")) {
      const id = td.getAttribute("data-id");
      db.rows.get(id).then(row => {
        if (row) td.textContent = row.xhs_name || "";
      });
    }
  }, true);
  
  // ✅✅✅ 桌面端：监听分类选择器的 change 事件（关键修复）
  gridBody.addEventListener("change", async (e) => {
    const sel = e.target.closest('select[data-field="row_color"]');
    if (!sel) return;
    
    const tr = sel.closest("tr");
    const id = tr.getAttribute("data-id");
    const newColor = sel.value;
    
    const row = await db.rows.get(id);
    if (!row) return;
    
    await db.rows.put({
      ...row,
      row_color: newColor,
      updated_at: Date.now()
    });
    
    // ✅ 立即更新对应单元格的 data-cat 属性
    const xhsCell = tr.querySelector(".col-xhs");
    if (xhsCell) {
      if (newColor) {
        xhsCell.setAttribute("data-cat", newColor);
      } else {
        xhsCell.removeAttribute("data-cat");
      }
    }
  });
  
  // ✅✅✅ 桌面端：监听操作按钮的 click 事件
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
  
  // ✅✅✅ 移动端：监听卡片头部点击和操作按钮
  mobileList.addEventListener("click", async (e) => {
    const header = e.target.closest(".m-row-header");
    if (header) {
      const card = header.closest(".m-row");
      if (card) card.classList.toggle("open");
      return;
    }
    
    const btn = e.target.closest("button[data-mact]");
    if (btn) {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      const act = btn.getAttribute("data-mact");
      
      if (act === "up") await moveRow(id, "up");
      else if (act === "down") await moveRow(id, "down");
      else if (act === "del") {
        if (confirm("确定删除该行？")) await deleteRowById(id);
      }
    }
  });
  
  // ✅✅✅ 移动端：监听 contenteditable 的 blur 事件
  mobileList.addEventListener("blur", async (e) => {
    const el = e.target.closest('.m-detail-value[contenteditable="true"]');
    if (!el) return;
    
    const id = el.getAttribute("data-id");
    const field = el.getAttribute("data-field");
    const val = el.innerText.trim(); // ✅ 使用 innerText
    
    const row = await db.rows.get(id);
    if (!row) return;
    
    const patch = {};
    patch[field] = val;
    patch.updated_at = Date.now();
    await db.rows.put({ ...row, ...patch });
    
    if (field === "owner" || field === "wx_real") {
      await refreshFilters();
    }
    
    await renderTable();
  }, true);
  
  // ✅✅✅ 移动端：监听分类选择器的 change 事件（关键修复）
  mobileList.addEventListener("change", async (e) => {
    const sel = e.target.closest('select[data-field="row_color"]');
    if (!sel) return;
    
    const card = sel.closest(".m-row");
    const id = sel.getAttribute("data-id");
    const newColor = sel.value;
    
    const row = await db.rows.get(id);
    if (!row) return;
    
    await db.rows.put({
      ...row,
      row_color: newColor,
      updated_at: Date.now()
    });
    
    // ✅ 立即更新对应 pill 的 data-cat 属性
    const pill = card.querySelector(".m-cat-pill");
    if (pill) {
      if (newColor) {
        pill.setAttribute("data-cat", newColor);
        const cats = readCats();
        pill.textContent = catNameOf(cats, newColor) || "未分类";
      } else {
        pill.removeAttribute("data-cat");
        pill.textContent = "未分类";
      }
    }
  });

  // 搜索
  $("#q").addEventListener("input", async (e) => {
    state.q = e.target.value || "";
    await renderTable();
  });

  // 搜索模式切换
  $("#btnSearchMode").addEventListener("click", async () => {
    setActiveFunction("search");
    state.precise = !state.precise;
    $("#btnSearchMode").textContent = state.precise
      ? "当前：精准搜索"
      : "当前：模糊搜索";
    await renderTable();
  });

  // 筛选
  $("#filterOwner").addEventListener("change", async (e) => {
    state.owner = e.target.value;
    await renderTable();
  });

  $("#filterWxReal").addEventListener("change", async (e) => {
    state.wxReal = e.target.value;
    await renderTable();
  });

  // 排序
  $("#sortBy").addEventListener("change", async (e) => {
    state.sortBy = e.target.value;
    await renderTable();
  });

  // 新增一行
  $("#btnAdd").addEventListener("click", async () => {
    setActiveFunction("add");
    await addRow();
  });

  // CSV 导入
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

  // CSV 导出
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

  // 保存云端
  $("#btnSaveCloud").addEventListener("click", async () => {
    setActiveFunction("saveCloud");
    await cloudSave();
  });

  // 云端加载
  $("#btnLoadCloud").addEventListener("click", async () => {
    setActiveFunction("loadCloud");
    const panel = $("#cloudHistoryPanel");
    if (panel.classList.contains("show")) {
      panel.classList.remove("show");
    } else {
      panel.classList.add("show");
      await renderCloudHistory();
    }
  });

  // 清空全部
  $("#btnClearAll").addEventListener("click", async () => {
    setActiveFunction("clear");
    if (!confirm("确定清空本地所有数据？此操作不可恢复。")) return;
    await db.rows.clear();
    await refreshFilters();
    await renderTable();
  });

  // 分类设置
  $("#btnCategories").addEventListener("click", () => {
    setActiveFunction("categories");
    const p = $("#panelCategories");
    p.classList.toggle("panel-hidden");
    if (!p.classList.contains("panel-hidden")) {
      renderCatList();
    }
  });

  // 新增分类
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

  // 显示设置
  $("#btnView").addEventListener("click", () => {
    setActiveFunction("view");
    const p = $("#panelView");
    p.classList.toggle("panel-hidden");
    if (!p.classList.contains("panel-hidden")) {
      const v = readView();
      $("#titleText").value = v.titleText;
      $("#titleColor").value = v.titleColor;
      $("#fontFamily").value = v.fontFamily;
      $("#rowPad").value = v.pad;
      $("#colScale").value = v.colScale;
      $("#zebraOn").checked = v.zebraOn;
      $("#zebraColor").value = v.zebraColor;
    }
  });

  // 视图设置控件
  $("#titleText").addEventListener("input", () => {
    const v = readView();
    v.titleText = $("#titleText").value || "XHSPHONE";
    saveView(v);
    applyView(v);
  });

  $("#titleColor").addEventListener("input", () => {
    const v = readView();
    v.titleColor = $("#titleColor").value || "#111111";
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
}

/* =========================
 * 12. 启动
 * ========================= */

document.addEventListener("DOMContentLoaded", async () => {
  applyView(readView());
  bindEvents();
  await refreshFilters();
  await renderTable();
  
  await initSupabase();
});
