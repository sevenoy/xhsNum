// app.js — 本地 Dexie + Supabase 快照 + 桌面表格 + 手机版折叠列表

/* =========================
 * 1. 常量 & 工具函数
 * ========================= */

const DB_NAME = "xhs_phone_db_v7";
const DB_VERSION = 7;

// 本地存储 key
const STORAGE_KEY = "xhs_phone_rows_v7"; // 已弃用，只为旧版本兼容
const SNAPSHOT_KEY = "xhs_phone_snapshots_v7";
const VIEW_KEY = "xhs_phone_view_v7";
const CATS_KEY = "xhs_phone_cats_v7";

// Dexie 表名
const TABLE_ROWS = "rows";
const TABLE_SNAPSHOTS = "snapshots";

// 默认视图配置
const DEFAULT_VIEW = Object.freeze({
  viewVersion: 7,
  pad: 6,
  colScale: 1,
  zebraOn: true,
  zebraColor: "#e2f0ff",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"SF Pro Text",Helvetica,Arial,sans-serif',
  titleText: "XHSPHONE",
  titleColor: "#1990FF",
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

function uid() {
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
  );
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 简单节流：防止频繁触发
 */
function throttle(fn, delay) {
  let timer = null;
  return function (...args) {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, delay);
  };
}

/**
 * 安全绑定事件：元素不存在就跳过
 */
function safeBind(selector, event, handler) {
  const el =
    typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;
  el.addEventListener(event, handler);
}

/**
 * 统一设置激活的功能按钮
 */
function setActiveFunction(name) {
  state.activeFunction = name;
  document.querySelectorAll(".function-btn").forEach((btn) => {
    const fn = btn.dataset.function;
    if (fn === name) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

function clearActiveFunction() {
  state.activeFunction = null;
  document.querySelectorAll(".function-btn").forEach((btn) => {
    btn.classList.remove("active");
  });
}

/* =========================
 * 2. 视图配置（标题、行高、字体等）
 * ========================= */

function readView() {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) {
      saveView(DEFAULT_VIEW);
      return { ...DEFAULT_VIEW };
    }

    const obj = JSON.parse(raw);
    if (obj.viewVersion !== DEFAULT_VIEW.viewVersion) {
      const merged = {
        ...DEFAULT_VIEW,
        ...obj,
        viewVersion: DEFAULT_VIEW.viewVersion,
      };
      saveView(merged);
      return merged;
    }

    if (typeof obj.pad !== "number") obj.pad = DEFAULT_VIEW.pad;
    if (typeof obj.colScale !== "number") obj.colScale = DEFAULT_VIEW.colScale;
    if (typeof obj.zebraOn !== "boolean") obj.zebraOn = DEFAULT_VIEW.zebraOn;
    if (!obj.zebraColor) obj.zebraColor = DEFAULT_VIEW.zebraColor;
    if (!obj.fontFamily) obj.fontFamily = DEFAULT_VIEW.fontFamily;
    if (!obj.titleText) obj.titleText = DEFAULT_VIEW.titleText;
    if (!obj.titleColor) obj.titleColor = DEFAULT_VIEW.titleColor;

    return obj;
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
    if (Array.isArray(obj) && obj.length) {
      let needSave = false;
      const normalized = obj.map((c, index) => {
        if (c && !c.id) {
          needSave = true;
          return {
            ...c,
            id: c.id || c.key || `legacy_${index}_${uid()}`,
          };
        }
        return c;
      });
      if (needSave) saveCats(normalized);
      return normalized;
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
  const found = cats.find((c) => c.id === id || c.color === id);
  return found ? found.name : "";
}

/* =========================
 * 4. Dexie 初始化
 * ========================= */

const db = new Dexie(DB_NAME);

db.version(DB_VERSION).stores({
  [TABLE_ROWS]:
    "id, order, phone, xhs_name, owner, wx_real, wx_name, xhs_link, note, row_color, created_at, updated_at",
  [TABLE_SNAPSHOTS]: "id, created_at",
});

/* =========================
 * 5. 本地数据封装
 * ========================= */

/**
 * 读取所有行
 */
async function loadAllRows() {
  return await db.rows.orderBy("order").toArray();
}

/**
 * 新增一行
 */
async function addRow() {
  const all = await loadAllRows();
  const maxOrder = all.length ? Math.max(...all.map((r) => r.order || 0)) : 0;
  const now = Date.now();
  const row = {
    id: uid(),
    order: maxOrder + 1,
    phone: "",
    xhs_name: "",
    owner: "",
    wx_real: "",
    wx_name: "",
    xhs_link: "",
    note: "",
    row_color: "",
    created_at: now,
    updated_at: now,
  };
  await db.rows.add(row);
  return row;
}

/**
 * 更新某行
 */
async function updateRow(id, patch) {
  const row = await db.rows.get(id);
  if (!row) return;
  patch.updated_at = Date.now();
  await db.rows.put({ ...row, ...patch });
}

/**
 * 删除某行
 */
async function deleteRow(id) {
  await db.rows.delete(id);
}

/* =========================
 * 6. 旧 localStorage 数据迁移（一次性）
 * ========================= */

async function migrateFromLocalStorage() {
  const old = localStorage.getItem(STORAGE_KEY);
  if (!old) return;
  try {
    const arr = JSON.parse(old);
    if (!Array.isArray(arr) || !arr.length) return;

    const existing = await db.rows.count();
    if (existing > 0) return;

    const now = Date.now();
    const toAdd = arr.map((r, idx) => ({
      id: r.id || uid(),
      order: r.order || idx + 1,
      phone: r.phone || "",
      xhs_name: r.xhs_name || "",
      owner: r.owner || "",
      wx_real: r.wx_real || "",
      wx_name: r.wx_name || "",
      xhs_link: r.xhs_link || "",
      note: r.note || "",
      row_color: r.row_color || "",
      created_at: r.created_at || now,
      updated_at: r.updated_at || now,
    }));
    await db.rows.bulkAdd(toAdd);
  } catch (e) {
    console.error("迁移旧数据失败:", e);
  } finally {
    localStorage.removeItem(STORAGE_KEY);
  }
}

/* =========================
 * 7. Supabase 接入
 * ========================= */

// 默认提供一份可用的配置（只在本地还没存过的情况下自动写入一次）
if (!localStorage.getItem("xhs_supabase_url")) {
  localStorage.setItem(
    "xhs_supabase_url",
    "https://tmeqccupnsvxexbrlflo.supabase.co"
  );
}
if (!localStorage.getItem("xhs_supabase_anon_key")) {
  localStorage.setItem(
    "xhs_supabase_anon_key",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtZXFjY3VwbnN2eGV4YnJsZmxvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzA2MDM2MjIsImV4cCI6MjA2MjE2OTYyMn0.9ZJz6Cwpjo5HLGXRNMBtj-J57gX47Aj42_0ILmkxbho"
  );
}

// 优先从 window / localStorage 读取已有配置
const SUPABASE_URL =
  (window.SUPABASE_URL || localStorage.getItem("xhs_supabase_url") || "").trim();
const SUPABASE_ANON_KEY =
  (window.SUPABASE_ANON_KEY ||
    localStorage.getItem("xhs_supabase_anon_key") ||
    "").trim();

let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = window.supabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;
} else {
  console.warn("⚠ 未配置 Supabase URL/KEY，云端功能不可用");
}

/* =========================
 * 8. 表格渲染（桌面端）
 * ========================= */

function normalizeText(str) {
  return (str || "").toString().trim().toLowerCase();
}

function matchRow(row, q, precise) {
  if (!q) return true;
  const fields = [
    row.phone,
    row.xhs_name,
    row.owner,
    row.wx_real,
    row.wx_name,
    row.xhs_link,
    row.note,
  ];
  const target = normalizeText(q);
  if (!precise) {
    return fields.some((f) => normalizeText(f).includes(target));
  }
  return fields.some((f) => normalizeText(f) === target);
}

function applyFilters(rows) {
  return rows.filter((r) => {
    if (!matchRow(r, state.q, state.precise)) return false;
    if (state.owner !== "all" && (r.owner || "") !== state.owner) return false;
    if (state.wxReal !== "all" && (r.wx_real || "") !== state.wxReal)
      return false;
    return true;
  });
}

function sortRows(rows) {
  if (state.sortBy === "order") {
    return rows.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  if (state.sortBy === "created") {
    return rows.slice().sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  }
  if (state.sortBy === "updated") {
    return rows.slice().sort((a, b) => (a.updated_at || 0) - (b.updated_at || 0));
  }
  return rows;
}

function truncateText(str, maxLen) {
  if (!str) return "";
  const s = String(str);
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}

/* 根据 row_color 设置 CSS 变量，让 zebra 不被覆盖 */
function setCategoryBg(el, rowColor) {
  const color = rowColor || "";
  if (!color) {
    el.style.removeProperty("--cat-pill-bg");
    return;
  }
  const m = color.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    el.style.setProperty("--cat-pill-bg", color);
    return;
  }
  el.style.setProperty(
    "--cat-pill-bg",
    color.replace(")", ", 0.15)").replace("rgb", "rgba")
  );
}

async function renderTable() {
  const gridBody = document.getElementById("gridBody");
  const mobileList = document.getElementById("mobileList");
  if (!gridBody || !mobileList) return;

  const allRows = await loadAllRows();
  const filtered = applyFilters(allRows);
  const sorted = sortRows(filtered);

  const cats = readCats();
  const v = readView();

  gridBody.innerHTML = sorted
    .map((r, idx) => {
      const zebraClass = v.zebraOn && idx % 2 === 1 ? "zebra-even" : "";
      const catName = catNameOf(cats, r.row_color);
      const catAttr = r.row_color
        ? `data-cat="${escapeHtml(r.row_color)}"`
        : "";
      return `<tr class="${zebraClass}" data-id="${r.id}">
        <td class="cell-order">${r.order || ""}</td>
        <td class="cell-phone" data-id="${r.id}" data-field="phone" contenteditable="true">${escapeHtml(
          r.phone || ""
        )}</td>
        <td class="cell-xhs" data-id="${r.id}" data-field="xhs_name" contenteditable="true">
          ${escapeHtml(r.xhs_name || "")}
        </td>
        <td class="cell-owner" data-id="${r.id}" data-field="owner" contenteditable="true">
          ${escapeHtml(r.owner || "")}
        </td>
        <td class="cell-wx-real" data-id="${r.id}" data-field="wx_real" contenteditable="true">
          ${escapeHtml(r.wx_real || "")}
        </td>
        <td class="cell-wx-name" data-id="${r.id}" data-field="wx_name" contenteditable="true">
          ${escapeHtml(r.wx_name || "")}
        </td>
        <td class="cell-xhs-link" data-id="${r.id}" data-field="xhs_link" contenteditable="true">
          ${escapeHtml(r.xhs_link || "")}
        </td>
        <td class="cell-note" data-id="${r.id}" data-field="note" contenteditable="true">
          ${escapeHtml(r.note || "")}
        </td>
        <td class="cell-cat">
          <span class="cat-pill" ${catAttr}>${escapeHtml(catName || "未分类")}</span>
        </td>
        <td class="cell-actions">
          <button class="btn-danger" data-id="${r.id}" data-act="delete">删除</button>
        </td>
      </tr>`;
    })
    .join("");

  renderMobileList(sorted);
  await refreshFilters();
}

/* =========================
 * 9. 移动端折叠列表渲染
 * ========================= */

function renderMobileList(rows) {
  const container = document.getElementById("mobileList");
  const v = readView();

  if (!container) return;

  if (!rows.length) {
    container.innerHTML = `<div class="empty-state">暂无数据</div>`;
    return;
  }

  const cats = readCats();

  container.innerHTML = rows
    .map((r, idx) => {
      const zebraClass = v.zebraOn && idx % 2 === 1 ? "zebra-even" : "";
      const catAttr = r.row_color
        ? `data-cat="${escapeHtml(r.row_color)}"`
        : "";
      const catName = catNameOf(cats, r.row_color);
      const xhsDisplay = truncateText(r.xhs_name, 10);

      return `<div class="m-row ${zebraClass}" data-id="${r.id}">
        <button class="m-row-header" data-id="${r.id}">
          <div class="m-main-line">
            <span class="m-phone">${escapeHtml(r.phone || "")}</span>
            <span class="m-xhs" title="${escapeHtml(
              r.xhs_name || ""
            )}">${escapeHtml(xhsDisplay)}</span>
            <span class="m-arrow">▾</span>
          </div>
          <div class="m-meta-line">
            <span class="m-owner">所属人：${escapeHtml(
              r.owner || "-"
            )}</span>
            <span class="m-cat-pill" ${catAttr}>${escapeHtml(
              catName || "未分类"
            )}</span>
          </div>
        </button>
        <div class="m-row-details">
          ${mobileDetail("微信实名人", r.wx_real, "wx_real", r.id)}
          ${mobileDetail("对应微信名", r.wx_name, "wx_name", r.id)}
          ${mobileDetail("小红书链接", r.xhs_link, "xhs_link", r.id)}
          ${mobileDetail("备注", r.note, "note", r.id)}
          ${mobileColorPicker(r.row_color, r.id)}
          <button class="m-delete" data-id="${r.id}">删除本条</button>
        </div>
      </div>`;
    })
    .join("");

  // 为每个移动端 pill 设置 CSS 变量（动态分类底色）
  rows.forEach((r) => {
    const card = container.querySelector(`.m-row[data-id="${r.id}"]`);
    if (card) {
      const pill = card.querySelector(".m-cat-pill");
      if (pill) {
        setCategoryBg(pill, r.row_color);
      }
    }
  });

  function mobileDetail(label, text, field, id) {
    const safe = escapeHtml(text || "");
    return `<div class="m-detail">
      <div class="m-detail-label">${escapeHtml(label)}</div>
      <div class="m-detail-value" contenteditable="true" data-id="${id}" data-field="${field}">
        ${safe}
      </div>
    </div>`;
  }

  function mobileColorPicker(color, id) {
    const safe = escapeHtml(color || "");
    return `<div class="m-detail">
      <div class="m-detail-label">分类颜色</div>
      <div class="m-detail-value">
        <input type="color" value="${safe}" data-id="${id}" class="m-color-input" />
      </div>
    </div>`;
  }
}

/* =========================
 * 10. 筛选下拉刷新
 * ========================= */

async function refreshFilters() {
  const allRows = await loadAllRows();
  const owners = Array.from(
    new Set(allRows.map((r) => r.owner || "").filter(Boolean))
  );
  const wxReals = Array.from(
    new Set(allRows.map((r) => r.wx_real || "").filter(Boolean))
  );

  const ownerSelect = document.getElementById("filterOwner");
  const wxRealSelect = document.getElementById("filterWxReal");

  if (ownerSelect) {
    const current = ownerSelect.value || "all";
    ownerSelect.innerHTML =
      `<option value="all">所属人：全部</option>` +
      owners
        .map(
          (o) =>
            `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`
        )
        .join("");
    ownerSelect.value = current;
  }

  if (wxRealSelect) {
    const current = wxRealSelect.value || "all";
    wxRealSelect.innerHTML =
      `<option value="all">微信实名人：全部</option>` +
      wxReals
        .map(
          (o) =>
            `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`
        )
        .join("");
    wxRealSelect.value = current;
  }
}

/* =========================
 * 11. 事件绑定 & 初始化
 * ========================= */

const $ = (sel) => document.querySelector(sel);

function bindEvents() {
  const gridBody = document.getElementById("gridBody");
  const mobileList = document.getElementById("mobileList");

  if (!gridBody) {
    console.error("❌ 找不到 #gridBody 元素");
    return;
  }
  if (!mobileList) {
    console.error("❌ 找不到 #mobileList 元素");
    return;
  }

  // 新增一行
  safeBind("#btnAddRow", "click", async () => {
    setActiveFunction("add");
    await addRow();
    await renderTable();
  });

  // 导入数据
  safeBind("#btnImport", "click", () => {
    setActiveFunction("import");
    const input = document.getElementById("fileInput");
    if (input) input.click();
  });

  safeBind("#fileInput", "change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) {
        alert("导入文件格式不正确");
        return;
      }
      await db.rows.clear();
      const now = Date.now();
      const toAdd = arr.map((r, idx) => ({
        id: r.id || uid(),
        order: r.order || idx + 1,
        phone: r.phone || "",
        xhs_name: r.xhs_name || "",
        owner: r.owner || "",
        wx_real: r.wx_real || "",
        wx_name: r.wx_name || "",
        xhs_link: r.xhs_link || "",
        note: r.note || "",
        row_color: r.row_color || "",
        created_at: r.created_at || now,
        updated_at: r.updated_at || now,
      }));
      await db.rows.bulkAdd(toAdd);
      await renderTable();
      alert("导入成功");
    } catch (err) {
      console.error(err);
      alert("导入失败：JSON 解析错误");
    } finally {
      e.target.value = "";
    }
  });

  // 导出数据
  safeBind("#btnExport", "click", async () => {
    setActiveFunction("export");
    const rows = await loadAllRows();
    const blob = new Blob([JSON.stringify(rows, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "xhs_phone_export.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  // 保存云端快照
  safeBind("#btnSaveCloud", "click", async () => {
    setActiveFunction("save");
    if (!supabase) {
      alert("未配置 Supabase，无法保存到云端");
      return;
    }
    const rows = await loadAllRows();
    if (!rows.length) {
      alert("当前没有任何数据可保存");
      return;
    }
    const now = Date.now();
    const payload = {
      id: uid(),
      created_at: now,
      rows,
      view: readView(),
      cats: readCats(),
    };
    const res = await supabase.from("snapshots").insert(payload);
    if (res.error) {
      console.error(res.error);
      alert("保存云端失败：" + res.error.message);
      return;
    }
    alert("已保存到云端");
  });

  // 云端加载快照列表
  safeBind("#btnLoadCloud", "click", async () => {
    setActiveFunction("load");
    if (!supabase) {
      alert("未配置 Supabase，无法从云端加载");
      return;
    }
    const res = await supabase
      .from("snapshots")
      .select("id, created_at")
      .order("created_at", { ascending: false });
    if (res.error) {
      console.error(res.error);
      alert("加载云端快照失败：" + res.error.message);
      return;
    }
    const list = res.data || [];
    const panel = document.getElementById("cloudPanel");
    if (!panel) return;
    if (!list.length) {
      panel.innerHTML = "<p>云端暂无任何快照</p>";
      return;
    }
    panel.innerHTML =
      "<h3>云端快照列表</h3>" +
      list
        .map((s) => {
          const t = new Date(s.created_at).toLocaleString();
          return `<div class="cloud-item">
            <span>${escapeHtml(t)}</span>
            <button data-id="${s.id}" class="ghost">加载</button>
          </div>`;
        })
        .join("");

    panel
      .querySelectorAll("button[data-id]")
      .forEach((btn) =>
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-id");
          const detail = await supabase
            .from("snapshots")
            .select("*")
            .eq("id", id)
            .single();
          if (detail.error) {
            console.error(detail.error);
            alert("加载快照失败：" + detail.error.message);
            return;
          }
          const snap = detail.data;
          if (!snap || !snap.rows || !Array.isArray(snap.rows)) {
            alert("云端快照数据格式不正确");
            return;
          }
          await db.rows.clear();
          await db.rows.bulkAdd(snap.rows);
          if (snap.view) {
            saveView(snap.view);
            applyView(snap.view);
          }
          if (snap.cats) {
            saveCats(snap.cats);
          }
          await renderTable();
          alert("已从云端快照恢复");
        })
      );
  });

  // 清空所有数据
  safeBind("#btnClearAll", "click", async () => {
    setActiveFunction("clear");
    if (!confirm("确定清空本地所有数据？此操作不可恢复。")) return;
    await db.rows.clear();
    await refreshFilters();
    await renderTable();
  });

  // 分类设置：与「显示设置」互斥展开
  safeBind("#btnCategories", "click", () => {
    const panelCat = $("#panelCategories");
    const panelView = $("#panelView");
    if (!panelCat) return;

    const willOpen = panelCat.classList.contains("panel-hidden");

    // 先全部收起
    panelCat.classList.add("panel-hidden");
    if (panelView) panelView.classList.add("panel-hidden");
    clearActiveFunction();

    if (willOpen) {
      setActiveFunction("categories");
      panelCat.classList.remove("panel-hidden");
      renderCatList();
    }
  });

  // 新增分类
  safeBind("#btnCatAdd", "click", () => {
    const nameEl = $("#catName");
    const colorEl = $("#catColor");
    if (!nameEl || !colorEl) return;

    const name = (nameEl.value || "").trim();
    const color = (colorEl.value || "#007aff").trim();
    if (!name) {
      alert("请填写分类名称");
      return;
    }

    const cats = readCats();
    cats.push({ id: uid(), name, color });
    saveCats(cats);

    nameEl.value = "";
    renderCatList();
    renderTable();
  });

  // 显示设置：与「分类设置」互斥展开
  safeBind("#btnView", "click", () => {
    const panelView = $("#panelView");
    const panelCat = $("#panelCategories");
    if (!panelView) return;

    const willOpen = panelView.classList.contains("panel-hidden");

    // 先全部收起
    panelView.classList.add("panel-hidden");
    if (panelCat) panelCat.classList.add("panel-hidden");
    clearActiveFunction();

    if (willOpen) {
      setActiveFunction("view");
      panelView.classList.remove("panel-hidden");

      const v = readView();
      const titleText = $("#titleText");
      const titleColor = $("#titleColor");
      const fontFamily = $("#fontFamily");
      const rowPad = $("#rowPad");
      const colScale = $("#colScale");
      const zebraOn = $("#zebraOn");
      const zebraColor = $("#zebraColor");

      if (titleText) titleText.value = v.titleText;
      if (titleColor) titleColor.value = v.titleColor;
      if (fontFamily) fontFamily.value = v.fontFamily;
      if (rowPad) rowPad.value = v.pad;
      if (colScale) colScale.value = v.colScale;
      if (zebraOn) zebraOn.checked = v.zebraOn;
      if (zebraColor) zebraColor.value = v.zebraColor;
    }
  });

  // 视图设置控件
  safeBind("#titleText", "input", () => {
    const v = readView();
    const el = $("#titleText");
    if (el) v.titleText = el.value || "XHSPHONE";
    saveView(v);
    applyView(v);
  });

  safeBind("#titleColor", "input", () => {
    const v = readView();
    const el = $("#titleColor");
    if (el) v.titleColor = el.value || "#1990FF";
    saveView(v);
    applyView(v);
  });

  safeBind("#fontFamily", "change", () => {
    const v = readView();
    const el = $("#fontFamily");
    if (el) v.fontFamily = el.value;
    saveView(v);
    applyView(v);
  });

  safeBind("#rowPad", "input", () => {
    const v = readView();
    const el = $("#rowPad");
    if (el) v.pad = Number(el.value) || 6;
    saveView(v);
    applyView(v);
  });

  safeBind("#colScale", "input", () => {
    const v = readView();
    const el = $("#colScale");
    if (el) v.colScale = Number(el.value) || 1;
    saveView(v);
    applyView(v);
  });

  safeBind("#zebraOn", "change", () => {
    const v = readView();
    const el = $("#zebraOn");
    if (el) v.zebraOn = el.checked;
    saveView(v);
    applyView(v);
    renderTable();
  });

  safeBind("#zebraColor", "input", () => {
    const v = readView();
    const el = $("#zebraColor");
    if (el) v.zebraColor = el.value || "#e2f0ff";
    saveView(v);
    applyView(v);
    renderTable();
  });

  // 搜索
  const doSearch = throttle(async () => {
    const input = document.getElementById("q");
    state.q = (input?.value || "").trim();
    await renderTable();
  }, 300);

  safeBind("#q", "input", doSearch);

  // 精准/模糊切换
  safeBind("#btnSearchMode", "click", async () => {
    state.precise = !state.precise;
    const btn = document.getElementById("btnSearchMode");
    if (btn) {
      btn.textContent = state.precise
        ? "当前：精准搜索"
        : "当前：模糊搜索";
    }
    await renderTable();
  });

  // 筛选
  safeBind("#filterOwner", "change", async (e) => {
    state.owner = e.target.value;
    await renderTable();
  });

  safeBind("#filterWxReal", "change", async (e) => {
    state.wxReal = e.target.value;
    await renderTable();
  });

  // 排序
  safeBind("#sortBy", "change", async (e) => {
    state.sortBy = e.target.value;
    await renderTable();
  });

  // 桌面表格修改
  gridBody.addEventListener(
    "blur",
    async (e) => {
      const td = e.target.closest("td[data-id][data-field]");
      if (!td) return;

      const id = td.getAttribute("data-id");
      const field = td.getAttribute("data-field");
      const val = td.innerText.trim();

      const row = await db.rows.get(id);
      if (!row) return;

      const patch = {};
      patch[field] = val;
      patch.updated_at = Date.now();
      await db.rows.put({ ...row, ...patch });

      if (field === "owner" || field === "wx_real") {
        await refreshFilters();
      }
    },
    true
  );

  // 桌面删除按钮
  gridBody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-id][data-act='delete']");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    if (!id) return;
    if (!confirm("确定删除该条记录？")) return;
    await deleteRow(id);
    await renderTable();
  });

  // 移动端 header 展开/收起
  const mobileListEl = document.getElementById("mobileList");
  if (mobileListEl) {
    mobileListEl.addEventListener("click", (e) => {
      const header = e.target.closest(".m-row-header");
      if (!header) return;
      const rowEl = header.closest(".m-row");
      if (!rowEl) return;
      const detail = rowEl.querySelector(".m-row-details");
      if (!detail) return;
      const open = rowEl.classList.contains("open");
      if (open) {
        rowEl.classList.remove("open");
        detail.style.maxHeight = "0px";
      } else {
        rowEl.classList.add("open");
        detail.style.maxHeight = detail.scrollHeight + "px";
      }
    });

    // 移动端删除按钮
    mobileListEl.addEventListener("click", async (e) => {
      const btn = e.target.closest(".m-delete");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      if (!id) return;
      if (!confirm("确定删除该条记录？")) return;
      await deleteRow(id);
      await renderTable();
    });

    // 移动端内容编辑
    mobileListEl.addEventListener(
      "blur",
      async (e) => {
        const el = e.target.closest(
          ".m-detail-value[contenteditable][data-id][data-field]"
        );
        if (!el) return;
        const id = el.getAttribute("data-id");
        const field = el.getAttribute("data-field");
        const val = el.innerText.trim();
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
      },
      true
    );

    // 移动端 color picker
    mobileListEl.addEventListener("change", async (e) => {
      const input = e.target.closest("input.m-color-input[data-id]");
      if (!input) return;
      const id = input.getAttribute("data-id");
      const color = input.value;
      const row = await db.rows.get(id);
      if (!row) return;
      const patch = { row_color: color, updated_at: Date.now() };
      await db.rows.put({ ...row, ...patch });
      await renderTable();
    });
  }
}

/* =========================
 * 12. 分类列表渲染
 * ========================= */

function renderCatList() {
  const list = document.getElementById("catList");
  if (!list) return;
  const cats = readCats();

  list.innerHTML = cats
    .map(
      (c, i) => `<div class="cat-row" data-id="${c.id}">
        <span class="cat-color-preview" data-color="${escapeHtml(
          c.color
        )}"></span>
        <div class="cat-name" contenteditable="true">${escapeHtml(
          c.name
        )}</div>
        <div class="cat-actions">
          <button class="ghost" data-act="up" ${
            i === 0 ? "disabled" : ""
          }>上移</button>
          <button class="ghost" data-act="down" ${
            i === cats.length - 1 ? "disabled" : ""
          }>下移</button>
          <input type="color" value="${escapeHtml(
            c.color
          )}" data-act="color" class="cat-color-input">
          <button class="btn-danger" data-act="del">删除</button>
        </div>
      </div>`
    )
    .join("");

  // 颜色预览
  list.querySelectorAll(".cat-color-preview").forEach((el) => {
    const color = el.getAttribute("data-color");
    if (color) el.style.background = color;
  });

  // 名称编辑
  list.querySelectorAll(".cat-name").forEach((el) => {
    el.addEventListener("blur", () => {
      const row = el.closest(".cat-row");
      const id = row.getAttribute("data-id");
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

  // 上移/下移/删除
  list.querySelectorAll(".cat-actions button").forEach((el) => {
    el.addEventListener("click", () => {
      const row = el.closest(".cat-row");
      const id = row.getAttribute("data-id");
      const act = el.getAttribute("data-act");
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

  // 颜色选择
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
 * 13. 启动逻辑
 * ========================= */

async function main() {
  const view = readView();
  applyView(view);

  await migrateFromLocalStorage();
  await renderTable();
  bindEvents();
}

document.addEventListener("DOMContentLoaded", main);
