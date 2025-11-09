// app.js — 本地 Dexie + Supabase 快照 + 桌面表格 + 手机版折叠列表

/* =========================================================
 * 0. 小工具函数
 * ========================================================= */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function uid() {
  return (
    "id_" +
    Math.random().toString(16).slice(2) +
    "_" +
    Date.now().toString(16)
  );
}

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    " " +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes())
  );
}

// 简单节流
function throttle(fn, delay = 120) {
  let last = 0;
  let timer = null;
  return function (...args) {
    const now = Date.now();
    if (now - last < delay) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        last = Date.now();
        fn.apply(this, args);
      }, delay);
    } else {
      last = now;
      fn.apply(this, args);
    }
  };
}

// 文本截断（用于手机版小红书名）
function truncateText(str, maxLen = 16) {
  if (!str) return "";
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "…";
}

/* =========================================================
 * 1. Dexie 数据库
 * ========================================================= */

const db = new Dexie("xhsphone_db_v7");
db.version(1).stores({
  rows: "id, phone, owner, wx_real, wx_name, xhs_name, note1, row_color, order, updated_at",
});

/** 表结构：
 *  {
 *    id: string,
 *    phone: string,
 *    owner: string,
 *    wx_real: string,
 *    wx_name: string,
 *    xhs_name: string,
 *    note1: string,
 *    row_color: string,  // 存分类 ID
 *    order: number,
 *    updated_at: number
 *  }
 */

/* =========================================================
 * 2. Supabase 云端快照
 * ========================================================= */

const SUPABASE_URL = (localStorage.getItem("xhs_supabase_url") || "").trim();
const SUPABASE_ANON_KEY = (localStorage.getItem("xhs_supabase_key") || "").trim();
const SUPABASE_TABLE = "xhsphone_snapshots";
const SUPABASE_DEFAULT_KEY = "default";

let supabase = null;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  try {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    console.error("创建 Supabase 客户端失败", e);
    supabase = null;
  }
} else {
  console.warn("未配置 Supabase URL / Key，将只使用本地存储。");
}

/* =========================================================
 * 3. 视图状态：标题 / 字体 / 行高 / 列宽 / 隔行颜色
 * ========================================================= */

const VIEW_KEY = "xhs_view_v3";
const CATS_KEY = "xhs_cats_v3";

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
  precise: false, // false=模糊搜索  true=精准搜索
};

/* =========================================================
 * 4. 视图 / 分类 的本地存取
 * ========================================================= */

function readView() {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return { ...DEFAULT_VIEW };
    const obj = JSON.parse(raw);
    // 合并默认值，支持后续升级
    return { ...DEFAULT_VIEW, ...(obj || {}) };
  } catch {
    return { ...DEFAULT_VIEW };
  }
}

function saveView(v) {
  localStorage.setItem(VIEW_KEY, JSON.stringify(v));
}

function applyView(v) {
  // 设置 CSS 变量
  const root = document.documentElement;
  root.style.setProperty("--row-pad", (v.pad || 6) + "px");
  root.style.setProperty("--col-scale", String(v.colScale || 1));
  root.style.setProperty("--zebra-on", v.zebraOn ? "1" : "0");
  root.style.setProperty("--zebra", v.zebraColor || "#e2f0ff");
  root.style.setProperty("--font-family", v.fontFamily || DEFAULT_VIEW.fontFamily);
  root.style.setProperty("--title-color", v.titleColor || "#1990FF");

  // 应用标题
  const titleEl = $("#appTitle");
  if (titleEl) {
    titleEl.textContent = v.titleText || "XHSPHONE";
    titleEl.style.color = v.titleColor || "#1990FF";
  }
}

/**
 * 分类读写（修复旧分类没有 id 导致按钮失效的问题）
 */
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
  if (!id) return "";
  const c = cats.find((x) => x.id === id);
  return c ? c.name : "";
}

function catColorOf(cats, id) {
  if (!id) return "";
  const c = cats.find((x) => x.id === id);
  return c ? c.color || "#007aff" : "";
}

/* =========================================================
 * 5. 数据层：增 / 删 / 改 / 查
 * ========================================================= */

async function getAllRows() {
  const rows = await db.rows.toArray();
  // 缺少 order 的补上
  let maxOrder = rows.length
    ? Math.max(...rows.map((r) => (typeof r.order === "number" ? r.order : 0)))
    : 0;
  let changed = false;
  const fixed = rows.map((r) => {
    if (typeof r.order !== "number") {
      changed = true;
      maxOrder += 1;
      return { ...r, order: maxOrder };
    }
    return r;
  });
  if (changed) {
    await db.rows.bulkPut(fixed);
    return fixed;
  }
  return rows;
}

async function addRow() {
  const rows = await getAllRows();
  const maxOrder = rows.length
    ? Math.max(...rows.map((r) => (typeof r.order === "number" ? r.order : 0)))
    : 0;
  const r = {
    id: uid(),
    phone: "",
    owner: "",
    wx_real: "",
    wx_name: "",
    xhs_name: "",
    note1: "",
    row_color: "",
    order: maxOrder + 1,
    updated_at: Date.now(),
  };
  await db.rows.add(r);
  await refreshFilters();
  await renderTable();
}

/* =========================================================
 * 6. 筛选 & 排序逻辑
 * ========================================================= */

function normalizeText(str) {
  return (str || "").toLowerCase();
}

function includesAll(haystack, keywords) {
  return keywords.every((kw) => haystack.includes(kw));
}

function preciseMatch(row, q) {
  const text = [
    row.phone,
    row.owner,
    row.wx_real,
    row.wx_name,
    row.xhs_name,
    row.note1,
  ]
    .map((x) => normalizeText(x))
    .join(" ");
  const qNorm = normalizeText(q);
  if (!qNorm) return true;
  // 精准 = 分词后全部包含
  const parts = qNorm.split(/\s+/).filter(Boolean);
  return includesAll(text, parts);
}

function fuzzyMatch(row, q) {
  const text = [
    row.phone,
    row.owner,
    row.wx_real,
    row.wx_name,
    row.xhs_name,
    row.note1,
  ]
    .map((x) => normalizeText(x))
    .join(" ");
  const qNorm = normalizeText(q);
  if (!qNorm) return true;
  return text.includes(qNorm);
}

function filterAndSort(rows) {
  const cats = readCats();
  const { q, owner, wxReal, sortBy, precise } = state;

  let result = rows.filter((r) => {
    // 筛选所属人
    if (owner !== "all" && (r.owner || "") !== owner) return false;
    // 筛选微信实名人
    if (wxReal !== "all" && (r.wx_real || "") !== wxReal) return false;
    // 搜索
    if (q && q.trim()) {
      if (precise) {
        if (!preciseMatch(r, q)) return false;
      } else {
        if (!fuzzyMatch(r, q)) return false;
      }
    }
    return true;
  });

  result.sort((a, b) => {
    if (sortBy === "owner") {
      return (a.owner || "").localeCompare(b.owner || "") || a.order - b.order;
    }
    if (sortBy === "wx_real") {
      return (
        (a.wx_real || "").localeCompare(b.wx_real || "") || a.order - b.order
      );
    }
    if (sortBy === "phone") {
      return (a.phone || "").localeCompare(b.phone || "") || a.order - b.order;
    }
    if (sortBy === "xhs_name") {
      return (
        (a.xhs_name || "").localeCompare(b.xhs_name || "") ||
        a.order - b.order
      );
    }
    if (sortBy === "row_color") {
      const ca = catNameOf(cats, a.row_color);
      const cb = catNameOf(cats, b.row_color);
      return ca.localeCompare(cb) || a.order - b.order;
    }
    // 默认按 order
    return a.order - b.order;
  });

  return result;
}

/* =========================================================
 * 7. 桌面版表格渲染
 * ========================================================= */

function setCategoryBg(el, catId) {
  const cats = readCats();
  const color = catColorOf(cats, catId);
  if (!el) return;
  if (color) {
    el.style.setProperty("--cat-pill-bg", color);
    el.style.backgroundColor = color;
  } else {
    el.style.setProperty("--cat-pill-bg", "rgba(0,122,255,0.09)");
    el.style.backgroundColor = "";
  }
}

function renderDesktopTable(rows) {
  const tbody = $("#gridBody");
  if (!tbody) return;

  const cats = readCats();
  const v = readView();
  const zebraColor = v.zebraColor || "#e2f0ff";
  const zebraOn = v.zebraOn !== false;

  tbody.innerHTML = rows
    .map((r, idx) => {
      const zebraClass = zebraOn && idx % 2 === 1 ? "zebra-row" : "";
      const catOptions = cats
        .map(
          (c) =>
            `<option value="${escapeHtml(
              c.id
            )}" data-color="${escapeHtml(c.color || "")}" ${
              r.row_color === c.id ? "selected" : ""
            }>${escapeHtml(c.name)}</option>`
        )
        .join("");

      const catSelectHtml = `<select data-field="row_color" data-id="${escapeHtml(
        r.id
      )}">
        <option value="">未分类</option>
        ${catOptions}
      </select>`;

      return `<tr class="${zebraClass}" data-id="${escapeHtml(r.id)}">
        <td class="col-phone" contenteditable="true" data-id="${escapeHtml(
          r.id
        )}" data-field="phone">${escapeHtml(r.phone || "")}</td>
        <td class="col-owner" contenteditable="true" data-id="${escapeHtml(
          r.id
        )}" data-field="owner">${escapeHtml(r.owner || "")}</td>
        <td class="col-real" contenteditable="true" data-id="${escapeHtml(
          r.id
        )}" data-field="wx_real">${escapeHtml(r.wx_real || "")}</td>
        <td class="col-wx" contenteditable="true" data-id="${escapeHtml(
          r.id
        )}" data-field="wx_name">${escapeHtml(r.wx_name || "")}</td>
        <td class="col-xhs" contenteditable="true" data-id="${escapeHtml(
          r.id
        )}" data-field="xhs_name">${escapeHtml(r.xhs_name || "")}</td>
        <td class="col-note" contenteditable="true" data-id="${escapeHtml(
          r.id
        )}" data-field="note1">${escapeHtml(r.note1 || "")}</td>
        <td class="col-cat">${catSelectHtml}</td>
        <td class="col-act">
          <button data-act="up" data-id="${escapeHtml(
            r.id
          )}">上移</button>
          <button data-act="down" data-id="${escapeHtml(
            r.id
          )}">下移</button>
          <button data-act="del" data-id="${escapeHtml(r.id)}">删除</button>
        </td>
      </tr>`;
    })
    .join("");

  // 应用分类背景色（xhs 列）
  tbody.querySelectorAll(".col-xhs").forEach((td) => {
    const id = td.getAttribute("data-id");
    if (!id) return;
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    setCategoryBg(td, row.row_color);
  });

  // 隔行着色
  if (zebraOn) {
    tbody.querySelectorAll("tr").forEach((tr, i) => {
      if (i % 2 === 1) {
        tr.style.backgroundColor = zebraColor;
      } else {
        tr.style.backgroundColor = "";
      }
    });
  } else {
    tbody.querySelectorAll("tr").forEach((tr) => {
      tr.style.backgroundColor = "";
    });
  }
}

/* =========================================================
 * 8. 手机版折叠列表渲染
 * ========================================================= */

function mobileDetail(label, text, field, id) {
  return `<div class="m-detail-row">
    <div class="m-detail-label">${escapeHtml(label)}</div>
    <div class="m-detail-value" data-field="${escapeHtml(
      field
    )}" data-id="${escapeHtml(id)}" contenteditable="true">${escapeHtml(
    text || ""
  )}</div>
  </div>`;
}

function renderMobileList(rows) {
  const list = $("#mobileList");
  if (!list) return;

  const cats = readCats();
  const v = readView();
  const zebraColor = v.zebraColor || "#e2f0ff";
  const zebraOn = v.zebraOn !== false;

  list.innerHTML = rows
    .map((r, idx) => {
      const zebraClass = zebraOn && idx % 2 === 1 ? "zebra-even" : "";
      const catName = catNameOf(cats, r.row_color);
      const xhsDisplay = truncateText(r.xhs_name, 10);

      return `<div class="m-row ${zebraClass}" data-id="${escapeHtml(r.id)}">
        <button class="m-row-header" data-id="${escapeHtml(r.id)}">
          <div class="m-main-line">
            <span class="m-phone">${escapeHtml(r.phone || "")}</span>
            <span class="m-xhs" title="${escapeHtml(
              r.xhs_name || ""
            )}">${escapeHtml(xhsDisplay)}</span>
            <span class="m-arrow">▾</span>
          </div>
          <div class="m-meta-line">
            <span class="m-owner">所属人：${escapeHtml(r.owner || "-")}</span>
            <span class="m-cat-pill">${escapeHtml(
              catName || "未分类"
            )}</span>
          </div>
        </button>
        <div class="m-row-details">
          ${mobileDetail("微信实名人", r.wx_real, "wx_real", r.id)}
          ${mobileDetail("对应微信名", r.wx_name, "wx_name", r.id)}
          ${mobileDetail("小红书名称", r.xhs_name, "xhs_name", r.id)}
          ${mobileDetail("备注", r.note1, "note1", r.id)}
          <div class="m-detail-row">
            <div class="m-detail-label">分类</div>
            <div class="m-detail-value">
              <select data-field="row_color" data-id="${escapeHtml(r.id)}">
                <option value="">未分类</option>
                ${cats
                  .map(
                    (c) =>
                      `<option value="${escapeHtml(
                        c.id
                      )}" data-color="${escapeHtml(c.color || "")}" ${
                        r.row_color === c.id ? "selected" : ""
                      }>${escapeHtml(c.name)}</option>`
                  )
                  .join("")}
              </select>
            </div>
          </div>
        </div>
      </div>`;
    })
    .join("");

  // 应用分类颜色到 pill
  list.querySelectorAll(".m-row").forEach((card) => {
    const id = card.getAttribute("data-id");
    if (!id) return;
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const pill = card.querySelector(".m-cat-pill");
    if (pill) {
      setCategoryBg(pill, row.row_color);
      pill.textContent = catNameOf(cats, row.row_color) || "未分类";
    }
  });
}

/* =========================================================
 * 9. 表格整体渲染
 * ========================================================= */

async function renderTable() {
  const rows = await getAllRows();
  const filtered = filterAndSort(rows);
  renderDesktopTable(filtered);
  renderMobileList(filtered);
}

/* =========================================================
 * 10. Supabase 云端快照
 * ========================================================= */

async function initSupabase() {
  if (!supabase) return;
  console.log("Supabase 已初始化。");
}

async function cloudSave(snapshotLabel = "") {
  if (!supabase) {
    alert("未配置 Supabase，无法保存到云端。");
    return;
  }
  const rows = await getAllRows();
  const cats = readCats();
  const view = readView();

  const payload = {
    rows,
    cats,
    view,
    snapshot_label: snapshotLabel || "手动快照",
  };

  const key = snapshotLabel
    ? `snap_${Date.now()}`
    : SUPABASE_DEFAULT_KEY;

  const { error } = await supabase.from(SUPABASE_TABLE).upsert(
    {
      key,
      payload,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "key",
    }
  );

  if (error) {
    console.error("云端保存失败", error);
    alert("保存到云端失败。");
    return;
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

/* =========================================================
 * 10. 分类设置 UI
 * ========================================================= */

function renderCatList() {
  const list = $("#catList");
  if (!list) return;
  const cats = readCats();
  list.innerHTML = cats
    .map(
      (c) => `<div class="cat-row" data-id="${escapeHtml(c.id)}">
      <span class="cat-color" style="background:${escapeHtml(
        c.color || "#007aff"
      )}"></span>
      <span class="cat-name" contenteditable="true">${escapeHtml(
        c.name || ""
      )}</span>
      <span class="cat-ops">
        <button data-act="up">上移</button>
        <button data-act="down">下移</button>
        <button data-act="del">删除</button>
        <input type="color" value="${escapeHtml(
          c.color || "#007aff"
        )}" data-act="color" />
      </span>
    </div>`
    )
    .join("");

  // 分类名称编辑
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

  // 上移/下移/删除
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

  // 颜色调整
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

/* =========================================================
 * 11. 事件绑定 & 分类 / 显示面板互斥展开
 * ========================================================= */

async function refreshFilters() {
  const rows = await getAllRows();
  const owners = Array.from(new Set(rows.map((r) => r.owner || ""))).filter(
    Boolean
  );
  const wxRealList = Array.from(
    new Set(rows.map((r) => r.wx_real || ""))
  ).filter(Boolean);

  const ownerSel = $("#filterOwner");
  const wxSel = $("#filterWxReal");

  if (ownerSel) {
    const cur = ownerSel.value || "all";
    ownerSel.innerHTML =
      `<option value="all">所属人：全部</option>` +
      owners.map(
        (o) =>
          `<option value="${escapeHtml(o)}">${
            "所属人：" + escapeHtml(o)
          }</option>`
      );
    if ([...ownerSel.options].some((x) => x.value === cur)) {
      ownerSel.value = cur;
    }
  }

  if (wxSel) {
    const cur = wxSel.value || "all";
    wxSel.innerHTML =
      `<option value="all">微信实名人：全部</option>` +
      wxRealList.map(
        (o) =>
          `<option value="${escapeHtml(o)}">${
            "实名人：" + escapeHtml(o)
          }</option>`
      );
    if ([...wxSel.options].some((x) => x.value === cur)) {
      wxSel.value = cur;
    }
  }
}

/* =========================
 * 11. 事件绑定 & 初始化
 * ========================= */

function bindEvents() {
  const gridBody = $("#gridBody");
  const mobileList = $("#mobileList");

  // 关键元素检查
  if (!gridBody) {
    console.error("❌ 找不到 #gridBody 元素");
    return;
  }
  if (!mobileList) {
    console.error("❌ 找不到 #mobileList 元素");
    return;
  }

  // 安全绑定函数
  const safeBind = (selector, event, handler, useCapture = false) => {
    const el = $(selector);
    if (!el) {
      console.warn(`⚠️ 元素不存在，跳过事件绑定: ${selector}`);
      return;
    }
    try {
      el.addEventListener(event, handler, useCapture);
    } catch (error) {
      console.error(`❌ 绑定事件失败 [${selector}]:`, error);
    }
  };

  // 桌面端：单元格 blur 保存修改
  gridBody.addEventListener(
    "blur",
    async (e) => {
      const td = e.target.closest('td[contenteditable="true"]');
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

      await renderTable();
    },
    true
  );

  // 桌面端：focus 时恢复小红书全名（避免被截断）
  gridBody.addEventListener(
    "focus",
    (e) => {
      const td = e.target.closest('td[contenteditable="true"]');
      if (!td) return;

      if (td.classList.contains("col-xhs")) {
        const id = td.getAttribute("data-id");
        db.rows.get(id).then((row) => {
          if (row) td.textContent = row.xhs_name || "";
        });
      }
    },
    true
  );

  // 桌面端：监听分类选择器 change（修复分类下拉无效）
  gridBody.addEventListener("change", async (e) => {
    console.log("🔍 Change事件触发:", e.target);
    const sel = e.target.closest('select[data-field="row_color"]');
    if (!sel) {
      console.log("⚠️ 不是分类选择器，忽略");
      return;
    }

    console.log("✅ 找到分类选择器:", sel);
    const tr = sel.closest("tr");
    if (!tr) {
      console.error("❌ 找不到tr元素");
      return;
    }

    const id = tr.getAttribute("data-id");
    const newColor = sel.value;
    console.log("📝 更新分类:", { id, newColor });

    const row = await db.rows.get(id);
    if (!row) {
      console.error("❌ 找不到行数据:", id);
      return;
    }

    await db.rows.put({
      ...row,
      row_color: newColor,
      updated_at: Date.now(),
    });
    console.log("💾 数据库已更新");

    // 更新桌面端分类背景
    const xhsCell = tr.querySelector(".col-xhs");
    if (xhsCell) {
      console.log("🎨 更新桌面端背景色");
      setCategoryBg(xhsCell, newColor);
    } else {
      console.warn("⚠️ 找不到xhsCell");
    }

    // 同步更新移动端 pill
    const card = $("#mobileList")?.querySelector(
      `.m-row[data-id="${id}"]`
    );
    if (card) {
      const pill = card.querySelector(".m-cat-pill");
      if (pill) {
        console.log("🎨 更新移动端pill");
        setCategoryBg(pill, newColor);
        const cats = readCats();
        pill.textContent = catNameOf(cats, newColor) || "未分类";
      }
    }

    console.log("✅ 分类更新完成");
  });

  // 桌面端：操作按钮（上移/下移/删除）
  gridBody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;

    const id = btn.getAttribute("data-id");
    const act = btn.getAttribute("data-act");
    const rows = await getAllRows();
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) return;

    if (act === "up" && idx > 0) {
      const tmp = rows[idx - 1].order;
      rows[idx - 1].order = rows[idx].order;
      rows[idx].order = tmp;
    } else if (act === "down" && idx < rows.length - 1) {
      const tmp = rows[idx + 1].order;
      rows[idx + 1].order = rows[idx].order;
      rows[idx].order = tmp;
    } else if (act === "del") {
      if (!confirm("确定删除该行？")) return;
      await db.rows.delete(id);
      await refreshFilters();
      await renderTable();
      return;
    } else {
      return;
    }

    await db.rows.bulkPut(rows);
    await renderTable();
  });

  // 手机版：折叠卡片展开/收起
  mobileList.addEventListener("click", (e) => {
    const header = e.target.closest(".m-row-header");
    if (!header) return;
    const row = header.closest(".m-row");
    if (!row) return;
    row.classList.toggle("open");
  });

  // 手机版：详情区 contenteditable blur 保存
  mobileList.addEventListener(
    "blur",
    async (e) => {
      const valDiv = e.target.closest(".m-detail-value[contenteditable]");
      if (!valDiv) return;
      const field = valDiv.getAttribute("data-field");
      const id = valDiv.getAttribute("data-id");
      const val = valDiv.innerText.trim();

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

  // 手机版：详情区分类下拉
  mobileList.addEventListener("change", async (e) => {
    const sel = e.target.closest('select[data-field="row_color"]');
    if (!sel) return;
    const id = sel.getAttribute("data-id");
    const newColor = sel.value;
    const row = await db.rows.get(id);
    if (!row) return;

    await db.rows.put({
      ...row,
      row_color: newColor,
      updated_at: Date.now(),
    });

    const card = sel.closest(".m-row");
    const pill = card?.querySelector(".m-cat-pill");
    if (pill) {
      setCategoryBg(pill, newColor);
      const cats = readCats();
      pill.textContent = catNameOf(cats, newColor) || "未分类";
    }

    await renderTable();
  });

  /* =========== 顶部工具栏 / 搜索 / 筛选绑定 =========== */

  // 搜索框输入（节流）
  const onSearchInput = throttle(async () => {
    const qInput = $("#q");
    state.q = qInput ? qInput.value.trim() : "";
    await renderTable();
  }, 200);

  safeBind("#q", "input", onSearchInput);

  // 搜索模式切换（模糊 / 精准）
  safeBind("#btnSearchMode", "click", async () => {
    state.precise = !state.precise;
    const btn = $("#btnSearchMode");
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

  // 新增一行
  safeBind("#btnAdd", "click", async () => {
    await addRow();
  });

  // CSV 导入
  safeBind("#btnImportCSV", "click", () => {
    const fileInput = $("#csvFile");
    if (fileInput) fileInput.click();
  });

  safeBind("#csvFile", "change", async (e) => {
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
  safeBind("#btnExportCSV", "click", async () => {
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
  safeBind("#btnSaveCloud", "click", async () => {
    await cloudSave();
  });

  // 云端加载
  safeBind("#btnLoadCloud", "click", async () => {
    const panel = $("#cloudHistoryPanel");
    if (panel) {
      if (panel.classList.contains("show")) {
        panel.classList.remove("show");
      } else {
        panel.classList.add("show");
        await renderCloudHistory();
      }
    }
  });

  // 清空全部
  safeBind("#btnClearAll", "click", async () => {
    if (!confirm("确定清空本地所有数据？此操作不可恢复。")) return;
    await db.rows.clear();
    await refreshFilters();
    await renderTable();
  });

  /* ===== 分类设置 / 显示设置：互斥展开 ===== */

  // 分类设置：与「显示设置」互斥展开
  safeBind("#btnCategories", "click", () => {
    const panelCat = $("#panelCategories");
    const panelView = $("#panelView");
    if (!panelCat) return;

    const willOpen = panelCat.classList.contains("panel-hidden");

    // 先全部收起
    panelCat.classList.add("panel-hidden");
    if (panelView) panelView.classList.add("panel-hidden");

    if (willOpen) {
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

    if (willOpen) {
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

  // 标题颜色默认回退到 #1990FF
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

  safeBind("#btnCompact", "click", () => {
    const v = readView();
    v.pad = 5;
    v.colScale = 0.95;
    saveView(v);
    applyView(v);
  });

  safeBind("#btnResetSize", "click", () => {
    saveView({
      ...DEFAULT_VIEW,
      titleText: readView().titleText,
      titleColor: readView().titleColor,
    });
    applyView(readView());
    renderTable();
  });
}

/* =========================================================
 * 12. CSV 简单导入 / 导出
 * ========================================================= */

function parseCSV(text) {
  const lines = (text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const header = lines[0].split(",").map((s) => s.trim());
  const rows = lines.slice(1).map((line) => {
    const parts = line.split(",").map((s) => s.trim());
    const obj = {};
    header.forEach((h, i) => {
      obj[h] = parts[i] || "";
    });
    return {
      phone: obj.phone || obj.手机 || "",
      owner: obj.owner || obj.所属人 || "",
      wx_real: obj.wx_real || obj.实名 || "",
      wx_name: obj.wx_name || obj.微信名 || "",
      xhs_name: obj.xhs_name || obj.小红书 || "",
      note1: obj.note1 || obj.备注 || "",
      row_color: obj.row_color || obj.分类 || "",
    };
  });
  return rows;
}

function toCSV(rows) {
  const header = [
    "phone",
    "owner",
    "wx_real",
    "wx_name",
    "xhs_name",
    "note1",
    "row_color",
  ];
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        r.phone || "",
        r.owner || "",
        r.wx_real || "",
        r.wx_name || "",
        r.xhs_name || "",
        (r.note1 || "").replace(/\n/g, "  "),
        r.row_color || "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    ),
  ];
  return lines.join("\n");
}

/* =========================================================
 * 13. 启动
 * ========================================================= */

// 初始化入口
async function init() {
  // 等待 DOM 完全加载
  if (document.readyState === "loading") {
    await new Promise((resolve) => {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", resolve, { once: true });
      } else {
        resolve();
      }
    });
  }

  // 再等 50ms，确保元素都渲染好
  await new Promise((resolve) => setTimeout(resolve, 50));

  // 检查关键元素
  const requiredElements = ["#gridBody", "#mobileList", "#btnAdd", "#q"];
  const missing = requiredElements.filter((sel) => !$(sel));
  if (missing.length) {
    console.error("❌ 缺少必需的元素:", missing);
    console.error("当前 DOM 状态:", document.readyState);
    // 重试一次
    await new Promise((resolve) => setTimeout(resolve, 100));
    const retryMissing = requiredElements.filter((sel) => !$(sel));
    if (retryMissing.length) {
      console.error("❌ 重试后仍缺少元素:", retryMissing);
      return;
    }
  }

  try {
    console.log("开始初始化…");
    applyView(readView());
    console.log("视图已应用");
    bindEvents();
    console.log("事件已绑定");
    await refreshFilters();
    console.log("筛选器已刷新");
    await renderTable();
    console.log("表格已渲染");
    await initSupabase();
    console.log("✅ 应用初始化完成");
  } catch (error) {
    console.error("❌ 初始化失败:", error);
    console.error("错误堆栈:", error.stack);
  }
}

// DOM 加载完成后启动
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    init();
  });
} else {
  init();
}
