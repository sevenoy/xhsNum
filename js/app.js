// app.js  —— 仅在“样式与交互”层面做增强；保留你原有的本地优先 + 云端快照模型
// 兼容 Dexie v4（全局 Dexie 对象已在 index.html 通过 CDN 注入）
// Supabase 使用动态 import，避免 import 失败导致整份脚本挂掉

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

// 使用动态 import，避免 import 失败导致整份脚本无法执行
let supabase = null;
let hasSupabase = false;

async function initSupabase() {
  hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  if (!hasSupabase) {
    // 没配置就保持“未配置”状态
    return;
  }
  try {
    const { createClient } = await import(
      "https://esm.sh/@supabase/supabase-js@2"
    );
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    // 初始化完成后再做一次健康检查 & 刷新历史
    await cloudHealthCheck();
    await renderCloudHistory();
  } catch (err) {
    console.error("Supabase 初始化失败：", err);
    supabase = null;
  }
}

// 默认视图（统一 zebra = #e2f0ff 即 222/240/255）
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

// 默认分类（可在“分类设置”中调整）
const DEFAULT_CATS = Object.freeze([
  { id: "enterprise", name: "企业号", color: "#007aff" },
  { id: "olina", name: "Olina用", color: "#34c759" },
  { id: "jasper", name: "嘉用", color: "#ff9f0a" },
  { id: "usable", name: "可用", color: "#8e8e93" },
]);

// 全局筛选/排序状态
const state = {
  q: "",
  owner: "all",
  wxReal: "all",
  sortBy: "order",
  precise: false, // 精准/模糊搜索切换
};

/* =========================
 * 1. Dexie 初始化（本地权威数据源）
 * ========================= */
const db = new Dexie(DB_NAME);
db.version(1).stores({
  rows: "id,order,phone,owner,wx_real,wx_name,xhs_name,note1,row_color,updated_at",
});

/* =========================
 * 2. 视图配置（localStorage）
 * ========================= */
function readView() {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return { ...DEFAULT_VIEW };
    const obj = JSON.parse(raw);
    if (!obj || obj.viewVersion !== DEFAULT_VIEW.viewVersion) {
      // 视图版本不匹配，覆盖为默认
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

  // 标题
  const h1 = document.getElementById("appTitle");
  if (h1) {
    h1.textContent = v.titleText;
    h1.style.color = v.titleColor;
  }
}

/* =========================
 * 3. 分类配置（localStorage）
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
// 将分类色转淡色背景（手机 pill）
function makeHighlightColor(hex, alpha = 0.14) {
  if (!hex || !hex.startsWith("#")) return "transparent";
  const c = hex.slice(1);
  let r, g, b;
  if (c.length === 3) {
    r = parseInt(c[0] + c[0], 16);
    g = parseInt(c[1] + c[1], 16);
    b = parseInt(c[2] + c[2], 16);
  } else {
    r = parseInt(c.slice(0, 2), 16);
    g = parseInt(c.slice(2, 4), 16);
    b = parseInt(c.slice(4, 6), 16);
  }
  return `rgba(${r},${g},${b},${alpha})`;
}

/* =========================
 * 5. 本地数据封装（行级）
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
    row_color: "", // 存分类 id
    updated_at: Date.now(),
  };
  await db.rows.add(row);
  await refreshFilters();
  await renderTable();
}
async function updateRow(id, patch) {
  const row = await db.rows.get(id);
  if (!row) return;
  const next = { ...row, ...patch, updated_at: Date.now() };
  await db.rows.put(next);
}
async function deleteRowById(id) {
  await db.rows.delete(id);
  await refreshFilters();
  await renderTable();
}
async function moveRow(id, dir /* 'up' | 'down' */) {
  // 在“当前筛选结果”里交换 order
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

  // 尽量保留原选择
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
    // 精准模式：含数字 → 按手机号数字子串；否则要求字段全等之一
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
    // 模糊模式：多关键词且全部命中（任一字段）
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
 * 7. 渲染（桌面表格 + 手机版卡片）
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
  // 关键：select 聚焦时把单元格背景置白，避免“隔行着色干扰下拉”
  return `<td class="${cls}"><select data-field="row_color" data-id="${rowId}" style="position:relative;z-index:5" onfocus="this.closest('td').style.background='#fff';" onblur="this.closest('td').style.background='';">${opts}</select></td>`;
}
function tdActions(rowId) {
  // 直接展示三按钮（替代“编辑”）
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
  const xhsBg = makeHighlightColor(catColorOf(cats, r.row_color), 0.18);
  return `<tr data-id="${r.id}">
    ${tdEditable("col-phone", r.phone, "phone", r.id)}
    ${tdEditable("col-owner", r.owner, "owner", r.id)}
    ${tdEditable("col-real", r.wx_real, "wx_real", r.id)}
    ${tdEditable("col-wx", r.wx_name, "wx_name", r.id)}
    <td class="col-xhs" contenteditable="true" data-field="xhs_name" data-id="${r.id}" style="background:${xhsBg}">${escapeHtml(
      r.xhs_name || ""
    )}</td>
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
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#888;padding:14px 0;">暂无数据，点击“新增一行”开始录入</td></tr>`;
  } else {
    tbody.innerHTML = rows.map((r) => makeRowTr(r)).join("");
  }

  // 绑定：单元格编辑
  tbody.querySelectorAll('td[contenteditable="true"]').forEach((td) => {
    td.addEventListener("focus", () => {
      // 聚焦时把背景置白，避免隔行色影响可读性
      td.style.background = "#fff";
    });
    td.addEventListener("blur", async () => {
      td.style.background = ""; // 还原（由 zebra 控制）
      const id = td.getAttribute("data-id");
      const field = td.getAttribute("data-field");
      const val = unescapeHtml(td.textContent || "").trim();
      await updateRow(id, { [field]: val });
      if (field === "xhs_name" || field === "row_color" || field === "owner") {
        // 需要刷新高亮和筛选
        await refreshFilters();
        await renderTable();
      }
    });
    // 防止回车换行
    td.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        td.blur();
      }
    });
  });

  // 绑定：分类选择
  tbody.querySelectorAll('select[data-field="row_color"]').forEach((sel) => {
    sel.addEventListener("change", async () => {
      const id = sel.getAttribute("data-id");
      await updateRow(id, { row_color: sel.value });
      await renderTable();
    });
  });

  // 绑定：动作按钮
  tbody.querySelectorAll("button[data-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
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
  });

  // 渲染手机版
  renderMobileList(rows);
}

function renderMobileList(rows) {
  const container = $("#mobileList");
  const v = readView();

  if (!rows.length) {
    container.innerHTML = `<div style="text-align:center;color:#888;padding:10px 0;">暂无数据</div>`;
    return;
  }
  container.innerHTML = rows
    .map((r, idx) => {
      const cats = readCats();
      const zebraBg = v.zebraOn && idx % 2 === 1 ? v.zebraColor : "#fff";
      const pillBg = makeHighlightColor(catColorOf(cats, r.row_color), 0.18);
      const catName = catNameOf(cats, r.row_color);
      return `<div class="m-row" data-id="${r.id}" style="--card-bg:${zebraBg}">
        <button class="m-row-header" data-id="${r.id}">
          <div class="m-main-line">
            <span class="m-phone">${escapeHtml(r.phone || "")}</span>
            <span class="m-xhs">${escapeHtml(r.xhs_name || "")}</span>
            <span class="m-arrow">▾</span>
          </div>
          <div class="m-meta-line">
            <span class="m-owner">所属人：${escapeHtml(r.owner || "-")}</span>
            <span class="m-cat-pill" style="background:${pillBg}">${escapeHtml(
              catName || "未分类"
            )}</span>
          </div>
        </button>
        <div class="m-row-details">
          ${mobileDetail("微信实名人", r.wx_real, "wx_real", r.id)}
          ${mobileDetail("对应微信名", r.wx_name, "wx_name", r.id)}
          ${mobileDetail("小红书名称", r.xhs_name, "xhs_name", r.id)}
          ${mobileDetail("备注", r.note1, "note1", r.id)}
          ${mobileCat(r.row_color, r.id)}
          <div class="m-actions">
            <div class="m-actions-main">
              <button class="ghost m-btn-edit" data-id="${r.id}">更多</button>
            </div>
            <div class="m-actions-hidden" id="m-hidden-${r.id}">
              <button class="ghost" data-mact="up" data-id="${r.id}">上移</button>
              <button class="ghost" data-mact="down" data-id="${r.id}">下移</button>
              <button class="btn-danger" data-mact="del" data-id="${r.id}">删除</button>
            </div>
          </div>
        </div>
      </div>`;
    })
    .join("");

  // 绑定折叠
  container.querySelectorAll(".m-row-header").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".m-row");
      card.classList.toggle("open");
    });
  });

  // 绑定手机端可编辑文本
  container
    .querySelectorAll('.m-detail-value[contenteditable="true"]')
    .forEach((el) => {
      el.addEventListener("focus", () => (el.style.background = "#fff"));
      el.addEventListener("blur", async () => {
        el.style.background = "";
        const id = el.getAttribute("data-id");
        const field = el.getAttribute("data-field");
        const val = unescapeHtml(el.textContent || "").trim();
        await updateRow(id, { [field]: val });
        await renderTable();
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          el.blur();
        }
      });
    });

  // 绑定手机端分类
  container.querySelectorAll("select[data-field='row_color']").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const id = sel.getAttribute("data-id");
      await updateRow(id, { row_color: sel.value });
      await renderTable();
    });
    sel.addEventListener("focus", () => {
      const td = sel.closest(".m-detail-value");
      if (td) td.style.background = "#fff";
    });
    sel.addEventListener("blur", () => {
      const td = sel.closest(".m-detail-value");
      if (td) td.style.background = "";
    });
  });

  // 绑定手机端“更多”/隐藏动作
  container.querySelectorAll(".m-btn-edit").forEach((b) => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = b.getAttribute("data-id");
      const box = document.getElementById(`m-hidden-${id}`);
      if (!box) return;
      box.classList.toggle("show");
    });
  });

  // 绑定手机端动作三连
  container.querySelectorAll("button[data-mact]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      const act = btn.getAttribute("data-mact");
      if (act === "up") await moveRow(id, "up");
      else if (act === "down") await moveRow(id, "down");
      else if (act === "del") {
        if (confirm("确定删除该行？")) await deleteRowById(id);
      }
    });
  });

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
        <select data-field="row_color" data-id="${id}" style="width:100%;">
          ${opts}
        </select>
      </div>
    </div>`;
  }
}

/* =========================
 * 8. CSV 导入/导出（简单版）
 * ========================= */
function parseCSV(text) {
  // 简单 split，不处理引号内逗号的复杂场景（白皮书已标注限制）
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
    const { data, error } = await supabase
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

  // 仅快照名称本身，不附加时间（右侧独立显示）
  const label = prompt("输入快照名称（只保存名称，时间将显示在右侧）", "快照");
  if (label == null) return;
  const snapshotName = (label || "快照").trim();
  const now = Date.now();

  const payload = {
    ver: 1,
    snapshot_label: snapshotName, // 不拼时间
    updated_at: now,
    rows: all,
    cats,
    view,
  };

  // 1) 写 default
  const { error: err1 } = await supabase.from(SUPABASE_TABLE).upsert({
    key: SUPABASE_DEFAULT_KEY,
    payload,
    updated_at: new Date(now).toISOString(),
  });
  if (err1) {
    alert("保存失败：" + err1.message);
    return;
  }

  // 2) 插入历史 key='snap_时间戳'
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

  // 3) 只保留最近 5 个 snap_
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
    panel.innerHTML =
      `<div style="padding:8px 10px;color:#888;">未配置 Supabase</div>`;
    return;
  }
  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
    .select("key,payload,updated_at")
    .like("key", "snap_%")
    .order("updated_at", { ascending: false })
    .limit(5);
  if (error) {
    panel.innerHTML =
      `<div style="padding:8px 10px;color:#ff3b30;">加载历史失败</div>`;
    return;
  }
  if (!Array.isArray(data) || !data.length) {
    panel.innerHTML =
      `<div style="padding:8px 10px;color:#888;">暂无历史快照</div>`;
    return;
  }
  panel.innerHTML = data
    .map((row) => {
      const name = (row.payload?.snapshot_label || "快照").trim(); // 名称不带时间
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

  // 绑定：名称编辑
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

  // 绑定：操作
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

  // 绑定：颜色选择
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
  // 搜索 & 模式
  $("#q").addEventListener("input", async (e) => {
    state.q = e.target.value || "";
    await renderTable();
  });
  $("#btnSearchMode").addEventListener("click", async () => {
    state.precise = !state.precise;
    $("#btnSearchMode").textContent = state.precise
      ? "当前：精准搜索"
      : "当前：模糊搜索";
    await renderTable();
  });

  // 筛选/排序
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

  // 行操作
  $("#btnAdd").addEventListener("click", addRow);

  // CSV
  $("#btnImportCSV").addEventListener("click", () => $("#csvFile").click());
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
  });
  $("#btnExportCSV").addEventListener("click", async () => {
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

  // 云端
  $("#btnSaveCloud").addEventListener("click", cloudSave);
  $("#btnLoadCloud").addEventListener("click", async () => {
    const panel = $("#cloudHistoryPanel");
    if (panel.style.display === "none") {
      panel.style.display = "block";
      await renderCloudHistory();
    } else {
      panel.style.display = "none";
    }
  });

  $("#btnClearAll").addEventListener("click", async () => {
    if (!confirm("确定清空本地所有数据？此操作不可恢复。")) return;
    await db.rows.clear();
    await refreshFilters();
    await renderTable();
  });

  // 分类设置
  $("#btnCategories").addEventListener("click", () => {
    const p = $("#panelCategories");
    p.style.display = p.style.display === "none" ? "block" : "none";
    renderCatList();
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

  // 显示设置
  $("#btnView").addEventListener("click", () => {
    const p = $("#panelView");
    p.style.display = p.style.display === "none" ? "block" : "none";
    // 同步控件初值
    const v = readView();
    $("#titleText").value = v.titleText;
    $("#titleColor").value = v.titleColor;
    $("#fontFamily").value = v.fontFamily;
    $("#rowPad").value = v.pad;
    $("#colScale").value = v.colScale;
    $("#zebraOn").checked = v.zebraOn;
    $("#zebraColor").value = v.zebraColor;
  });

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
    renderTable(); // 手机卡片也要刷新 zebra
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
    v.pad = 5; // 更紧凑
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
  });
}

/* =========================
 * 12. 启动
 * ========================= */
document.addEventListener("DOMContentLoaded", async () => {
  // 应用视图
  applyView(readView());
  // 事件
  bindEvents();
  // 初次筛选/渲染
  await refreshFilters();
  await renderTable();

  // 先做一次本地的云端状态检查（此时 supabase 可能还没初始化好）
  await cloudHealthCheck();
  // 异步初始化 Supabase（失败也不会影响本地功能）
  initSupabase();

  // 云端历史面板初始隐藏
  const panel = $("#cloudHistoryPanel");
  if (panel) panel.style.display = "none";
});
