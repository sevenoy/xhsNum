import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  "https://tmeqccupnsvxexbrlflo.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtZXFjY3VwbnN2eGV4YnJsZmxvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0OTg2MjAsImV4cCI6MjA3ODA3NDYyMH0.9ZJz6Cwpjo5HLGXRNMBtj-J57gX47Aj42_0ILmkxbho"
);

// 工具函数
const $ = (q, s = document) => s.querySelector(q);
const $$ = (q, s = document) => Array.from(s.querySelectorAll(q));

// 本地存储键
const VIEW_KEY = "xhs_view_v7";
const CATS_KEY = "xhs_cats_v7";

const DEFAULT_VIEW = {
  pad: 6,
  colScale: 1,
  zebraOn: true,
  zebraColor: "#eef5ff",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro SC","PingFang SC","Noto Sans CJK SC","Hiragino Sans GB","Microsoft YaHei",sans-serif',
  titleText: "XHSPHONE",
  titleColor: "#111111",
};

const DEFAULT_CATS = [
  { key: "enterprise", name: "企业号", color: "#ffd60a" },
  { key: "olina", name: "Olina用", color: "#007aff" },
  { key: "jasper", name: "嘉用", color: "#af52de" },
  { key: "usable", name: "可用", color: "#34c759" },
];

// Dexie 本地数据库
const db = new Dexie("xhs_phone_sheet_v7");
db.version(1).stores({
  rows: "id, order, phone, owner, wx_real, wx_name, xhs_name, note1, row_color, updated_at",
});

const SUPABASE_TABLE = "xhsphone_snapshot";
const SUPABASE_KEY = "default";

// 视图与分类
function readView() {
  try {
    return { ...DEFAULT_VIEW, ...(JSON.parse(localStorage.getItem(VIEW_KEY)) || {}) };
  } catch {
    return { ...DEFAULT_VIEW };
  }
}
function saveView(v) {
  localStorage.setItem(VIEW_KEY, JSON.stringify(v));
}
function applyView(v) {
  document.documentElement.style.setProperty("--pad", (v.pad ?? 6) + "px");
  document.documentElement.style.setProperty("--colScale", v.colScale ?? 1);
  document.documentElement.style.setProperty("--zebra", v.zebraColor || "#eef5ff");
  document.documentElement.style.setProperty("--font-main", v.fontFamily || DEFAULT_VIEW.fontFamily);

  const titleEl = $("#appTitle");
  if (titleEl) {
    titleEl.textContent = v.titleText || "XHSPHONE";
    titleEl.style.color = v.titleColor || "#111111";
  }
}
function readCats() {
  try {
    return JSON.parse(localStorage.getItem(CATS_KEY)) || DEFAULT_CATS;
  } catch {
    return DEFAULT_CATS;
  }
}
function saveCats(c) {
  localStorage.setItem(CATS_KEY, JSON.stringify(c));
}
function catColorOf(key) {
  const c = readCats().find((x) => x.key === key);
  return c ? c.color : null;
}
function catNameOf(key) {
  const c = readCats().find((x) => x.key === key);
  return c ? c.name : "";
}

function hexToRgba(hex, a) {
  hex = (hex || "").replace("#", "");
  if (hex.length === 3) hex = hex.split("").map((x) => x + x).join("");
  const r = parseInt(hex.slice(0, 2), 16) || 255;
  const g = parseInt(hex.slice(2, 4), 16) || 255;
  const b = parseInt(hex.slice(4, 6), 16) || 255;
  return `rgba(${r},${g},${b},${a})`;
}

// 状态
const state = {
  q: "",
  owner: "all",
  wxReal: "all",
  sortBy: "order",
  precise: false, // false=模糊搜索, true=精准搜索
};

// 云端状态 UI
function setCloudStatus(ok, text) {
  const dot = $("#cloudDot");
  const tx = $("#cloudText");
  if (dot) dot.style.background = ok ? "#34c759" : "#ff3b30";
  if (tx) tx.textContent = text || (ok ? "Base 数据连接：已连接" : "Base 数据连接：离线");
}

// Supabase 云端操作
async function cloudLoad() {
  try {
    const { data, error } = await supabase
      .from(SUPABASE_TABLE)
      .select("payload")
      .eq("key", SUPABASE_KEY)
      .maybeSingle();

    if (error) {
      console.error("云端读取失败", error);
      setCloudStatus(false, "Base 数据连接：读取失败");
      alert("云端读取失败：" + (error.message || "未知错误"));
      return null;
    }
    if (!data || !data.payload) {
      setCloudStatus(true, "Base 数据连接：无数据");
      alert("云端暂无数据");
      return null;
    }
    setCloudStatus(true, "Base 数据连接：已连接");
    return data.payload;
  } catch (e) {
    console.error("云端读取异常", e);
    setCloudStatus(false, "Base 数据连接：异常");
    alert("云端读取异常");
    return null;
  }
}
async function cloudSave(payload) {
  try {
    const { error } = await supabase
      .from(SUPABASE_TABLE)
      .upsert({
        key: SUPABASE_KEY,
        payload,
        updated_at: new Date().toISOString(),
      });

    if (error) {
      console.error("云端保存失败", error);
      setCloudStatus(false, "Base 数据连接：保存失败");
      alert("云端保存失败：" + (error.message || "未知错误"));
      return false;
    }
    setCloudStatus(true, "Base 数据连接：已同步");
    alert("云端保存成功");
    return true;
  } catch (e) {
    console.error("云端保存异常", e);
    setCloudStatus(false, "Base 数据连接：异常");
    alert("云端保存异常");
    return false;
  }
}

// 数据读写
async function getAllRows() {
  return await db.rows.orderBy("order").toArray();
}
async function updateRow(id, patch) {
  const row = await db.rows.get(id);
  if (!row) return;
  const next = { ...row, ...patch, updated_at: new Date().toISOString() };
  await db.rows.put(next);
}
async function addRow() {
  const all = await getAllRows();
  const maxOrder = all.reduce((m, r) => Math.max(m, r.order || 0), 0);
  const id = Date.now().toString(16) + Math.random().toString(16).slice(2);
  await db.rows.add({
    id,
    order: maxOrder + 1,
    phone: "",
    owner: "",
    wx_real: "",
    wx_name: "",
    xhs_name: "",
    note1: "",
    row_color: "",
    updated_at: new Date().toISOString(),
  });
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
  const filtered = await applyFilters(all);
  const idx = filtered.findIndex((r) => r.id === id);
  if (idx < 0) return;
  const targetIdx = dir === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= filtered.length) return;

  const a = filtered[idx];
  const b = filtered[targetIdx];
  const orderA = a.order || 0;
  const orderB = b.order || 0;
  await db.rows.update(a.id, { order: orderB });
  await db.rows.update(b.id, { order: orderA });
  await refreshFilters();
  await renderTable();
}

// 搜索 + 筛选
async function refreshFilters() {
  const all = await getAllRows();
  const owners = [...new Set(all.map((r) => r.owner).filter(Boolean))];
  const reals = [...new Set(all.map((r) => r.wx_real).filter(Boolean))];

  const oSel = $("#filterOwner");
  const wSel = $("#filterWxReal");
  const prevO = oSel.value;
  const prevW = wSel.value;

  oSel.innerHTML = '<option value="all">所属人：全部</option>' +
    owners.map((o) => `<option value="${o}">${o}</option>`).join("");
  wSel.innerHTML = '<option value="all">微信实名人：全部</option>' +
    reals.map((w) => `<option value="${w}">${w}</option>`).join("");

  oSel.value = owners.includes(prevO) ? prevO : "all";
  wSel.value = reals.includes(prevW) ? prevW : "all";
}

function applySearchFilter(rows) {
  const qRaw = state.q.trim();
  if (!qRaw) return rows;

  const q = qRaw.toLowerCase();
  const digits = q.replace(/\D/g, "");

  return rows.filter((r) => {
    const fields = [
      r.phone || "",
      r.owner || "",
      r.wx_real || "",
      r.wx_name || "",
      r.xhs_name || "",
      r.note1 || "",
      catNameOf(r.row_color || ""),
    ];
    const combined = fields.join(" ").toLowerCase();

    if (state.precise) {
      // 精准搜索：如果是数字，则精确匹配手机号里的数字串
      if (digits) {
        const phoneDigits = String(r.phone || "").replace(/\D/g, "");
        return phoneDigits.includes(digits);
      }
      // 文字精确：要求某个字段与关键字完全相等（忽略大小写）
      return fields.some((v) => v.toLowerCase() === q);
    } else {
      // 模糊搜索：普通“包含”，支持多关键词（空格分隔，所有词都要出现）
      const tokens = q.split(/\s+/).filter(Boolean);
      if (!tokens.length) return true;
      return tokens.every((tk) => combined.includes(tk));
    }
  });
}

async function applyFilters(all) {
  let rows = [...all];

  if (state.owner !== "all") rows = rows.filter((r) => r.owner === state.owner);
  if (state.wxReal !== "all") rows = rows.filter((r) => r.wx_real === state.wxReal);

  rows = applySearchFilter(rows);

  switch (state.sortBy) {
    case "owner":
      rows.sort((a, b) =>
        String(a.owner || "").localeCompare(String(b.owner || ""), "zh-CN"),
      );
      break;
    case "wx_real":
      rows.sort((a, b) =>
        String(a.wx_real || "").localeCompare(String(b.wx_real || ""), "zh-CN"),
      );
      break;
    case "phone":
      rows.sort((a, b) =>
        String(a.phone || "").localeCompare(String(b.phone || ""), "zh-CN"),
      );
      break;
    case "xhs_name":
      rows.sort((a, b) =>
        String(a.xhs_name || "").localeCompare(String(b.xhs_name || ""), "zh-CN"),
      );
      break;
    case "row_color":
      rows.sort((a, b) =>
        catNameOf(a.row_color || "").localeCompare(
          catNameOf(b.row_color || ""),
          "zh-CN",
        ),
      );
      break;
    default:
      rows.sort((a, b) => (a.order || 0) - (b.order || 0));
      break;
  }

  return rows;
}

// 渲染桌面表格
function makeRowTr(r) {
  const tr = document.createElement("tr");
  tr.dataset.id = r.id;
  tr.dataset.order = r.order || 0;

  const bg = r.row_color
    ? hexToRgba(catColorOf(r.row_color) || "#ffffff", 0.18)
    : "";

  tr.innerHTML = `
    <td class="col-phone" contenteditable="true" data-k="phone">${r.phone || ""}</td>
    <td class="col-owner" contenteditable="true" data-k="owner">${r.owner || ""}</td>
    <td class="col-real" contenteditable="true" data-k="wx_real">${r.wx_real || ""}</td>
    <td class="col-wx" contenteditable="true" data-k="wx_name">${r.wx_name || ""}</td>
    <td class="col-xhs" contenteditable="true" data-k="xhs_name" style="${
      bg ? `background:${bg};` : ""
    }">${r.xhs_name || ""}</td>
    <td class="col-note" contenteditable="true" data-k="note1">${r.note1 || ""}</td>
    <td class="col-cat">
      <select data-k="row_color"></select>
    </td>
    <td class="col-act">
      <div class="actions-container">
        <button class="ghost" data-act="edit">编辑</button>
        <div class="actions-extra">
          <button class="ghost" data-act="up">上移</button>
          <button class="ghost" data-act="down">下移</button>
          <button class="ghost danger" data-act="del">删除</button>
        </div>
      </div>
    </td>
  `;

  const sel = tr.querySelector("select[data-k='row_color']");
  const cats = readCats();
  sel.innerHTML =
    '<option value="">无</option>' +
    cats.map((c) => `<option value="${c.key}">${c.name}</option>`).join("");
  sel.value = r.row_color || "";

  return tr;
}

// 渲染手机折叠列表
function renderMobileList(rows) {
  const list = $("#mobileList");
  list.innerHTML = "";
  const cats = readCats();

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.style.textAlign = "center";
    empty.style.color = "#6e6e73";
    empty.style.padding = "24px 8px";
    empty.textContent = '暂无数据，点击“新增一行”添加账号';
    list.appendChild(empty);
    return;
  }

  rows.forEach((row) => {
    const card = document.createElement("div");
    card.className = "m-row";
    const cat = cats.find((c) => c.key === row.row_color);

    card.innerHTML = `
      <button type="button" class="m-row-header">
        <div class="m-main-line">
          <div class="m-phone">${row.phone || ""}</div>
          <div class="m-xhs">${row.xhs_name || ""}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;width:100%;justify-content:space-between;margin-top:2px;">
          <span class="m-owner-tag">${row.owner || "未设置所属人"}</span>
          <span class="m-arrow">⌄</span>
        </div>
      </button>
      <div class="m-row-details">
        <div class="m-detail-row">
          <div class="m-detail-label">所属人</div>
          <div class="m-detail-value" contenteditable="true" data-k="owner">${row.owner || ""}</div>
        </div>
        <div class="m-detail-row">
          <div class="m-detail-label">微信实名人</div>
          <div class="m-detail-value" contenteditable="true" data-k="wx_real">${row.wx_real || ""}</div>
        </div>
        <div class="m-detail-row">
          <div class="m-detail-label">对应微信名</div>
          <div class="m-detail-value" contenteditable="true" data-k="wx_name">${row.wx_name || ""}</div>
        </div>
        <div class="m-detail-row">
          <div class="m-detail-label">备注</div>
          <div class="m-detail-value" contenteditable="true" data-k="note1">${row.note1 || ""}</div>
        </div>
        <div class="m-detail-row">
          <div class="m-detail-label">分类</div>
          <div class="m-detail-value">
            <select data-k="row_color" style="width:100%;padding:4px 6px;border-radius:8px;border:1px solid var(--line);background:#fff;font-size:13px;">
              <option value="">无</option>
              ${cats
                .map(
                  (c) =>
                    `<option value="${c.key}" ${
                      c.key === row.row_color ? "selected" : ""
                    }>${c.name}</option>`,
                )
                .join("")}
            </select>
          </div>
        </div>
        <div class="m-actions">
          <button class="ghost m-edit">编辑</button>
          <div class="m-hidden-actions">
            <button class="ghost" data-act="up">上移</button>
            <button class="ghost" data-act="down">下移</button>
            <button class="ghost danger" data-act="del">删除</button>
          </div>
        </div>
      </div>
    `;

    const header = card.querySelector(".m-row-header");
    const details = card.querySelector(".m-row-details");
    const arrow = card.querySelector(".m-arrow");
    const editBtn = card.querySelector(".m-edit");
    const hidden = card.querySelector(".m-hidden-actions");

    header.addEventListener("click", () => {
      card.classList.toggle("open");
    });

    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      hidden.classList.toggle("show");
    });

    // 内联编辑
    card
      .querySelectorAll(".m-detail-value[contenteditable='true']")
      .forEach((el) => {
        el.addEventListener(
          "blur",
          async () => {
            const k = el.dataset.k;
            const v = el.textContent.trim();
            await updateRow(row.id, { [k]: v });
            await renderTable();
          },
          true,
        );
      });

    // 分类选择
    const sel = card.querySelector("select[data-k='row_color']");
    sel.addEventListener("change", async () => {
      await updateRow(row.id, { row_color: sel.value });
      await renderTable();
    });

    // 操作按钮
    hidden.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const act = btn.dataset.act;
        if (act === "del") {
          if (!confirm("确定删除这一行？")) return;
          await deleteRowById(row.id);
        } else if (act === "up") {
          await moveRow(row.id, "up");
        } else if (act === "down") {
          await moveRow(row.id, "down");
        }
      });
    });

    list.appendChild(card);
  });
}

// 总渲染
async function renderTable() {
  const all = await getAllRows();
  const rows = await applyFilters(all);
  const body = $("#gridBody");

  // 桌面表格
  body.innerHTML = "";
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.style.textAlign = "center";
    td.style.color = "#6e6e73";
    td.textContent = '暂无数据，点击“新增一行”添加账号';
    tr.appendChild(td);
    body.appendChild(tr);
  } else {
    rows.forEach((r) => body.appendChild(makeRowTr(r)));
  }

  // 手机版列表
  renderMobileList(rows);
}

// 分类 UI
function renderCatList() {
  const cats = readCats();
  const box = $("#catList");
  box.innerHTML = "";
  cats.forEach((c, idx) => {
    const row = document.createElement("div");
    row.className = "catRow";
    row.innerHTML = `
      <div class="chip">
        <span class="colorDot" style="background:${c.color}"></span>
        <span>${c.name}</span>
      </div>
      <span></span>
      <button class="ghost" data-act="up" data-key="${c.key}" ${
      idx === 0 ? "disabled" : ""
    }>上移</button>
      <button class="ghost" data-act="down" data-key="${c.key}" ${
      idx === cats.length - 1 ? "disabled" : ""
    }>下移</button>
      <button class="ghost" data-act="del" data-key="${c.key}">删除</button>
    `;
    box.appendChild(row);
  });
}

// 事件绑定
function bindEvents() {
  const view = readView();
  applyView(view);

  // 初始化显示设置控件
  $("#titleText").value = view.titleText;
  $("#titleColor").value = view.titleColor;
  $("#fontFamily").value = view.fontFamily;
  $("#rowPad").value = view.pad;
  $("#colScale").value = view.colScale;
  $("#zebraOn").checked = view.zebraOn !== false;
  $("#zebraColor").value = view.zebraColor;

  // 搜索 + 筛选
  $("#q").addEventListener("input", async (e) => {
    state.q = e.target.value;
    await renderTable();
  });
  $("#btnSearchMode").addEventListener("click", async () => {
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

  // 增删改
  $("#btnAdd").addEventListener("click", addRow);
  $("#btnClearAll").addEventListener("click", async () => {
    if (!confirm("确定清空全部数据？此操作不可撤销。")) return;
    await db.rows.clear();
    await refreshFilters();
    await renderTable();
  });

  // CSV 导入/导出
  $("#btnImportCSV").addEventListener("click", () => {
    $("#csvFile").click();
  });
  $("#csvFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) {
      alert("CSV 内容为空");
      return;
    }
    const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
    const all = await getAllRows();
    let orderBase = all.reduce((m, r) => Math.max(m, r.order || 0), 0);
    const now = Date.now();
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw.trim()) continue;
      const cols = raw.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      const obj = {};
      headers.forEach((h, idx) => (obj[h] = cols[idx] || ""));
      rows.push({
        id: (now + i).toString(16),
        order: ++orderBase,
        phone: obj.phone || "",
        owner: obj.owner || "",
        wx_real: obj.wx_real || "",
        wx_name: obj.wx_name || "",
        xhs_name: obj.xhs_name || "",
        note1: obj.note1 || "",
        row_color: obj.row_color || "",
        updated_at: new Date().toISOString(),
      });
    }
    if (rows.length) {
      await db.rows.bulkAdd(rows);
      await refreshFilters();
      await renderTable();
      alert(`已导入 ${rows.length} 行`);
    }
    e.target.value = "";
  });
  $("#btnExportCSV").addEventListener("click", async () => {
    const all = await getAllRows();
    const headers = [
      "phone",
      "owner",
      "wx_real",
      "wx_name",
      "xhs_name",
      "note1",
      "row_color",
    ];
    const lines = [headers.join(",")];
    all.forEach((r) => {
      lines.push(
        headers
          .map((h) => `"${String(r[h] || "").replace(/"/g, '""')}"`)
          .join(","),
      );
    });
    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `xhsphone-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // 分类设置
  $("#btnCategories").addEventListener("click", () => {
    const p = $("#panelCategories");
    const btn = $("#btnCategories");
    const show = p.style.display === "none";
    p.style.display = show ? "" : "none";
    btn.classList.toggle("active", show);
    if (show) renderCatList();
  });
  $("#catColor").addEventListener("input", (e) => {
    $("#catColorPreview").style.background = e.target.value;
  });
  $("#btnCatAdd").addEventListener("click", () => {
    const name = $("#catName").value.trim();
    const color = $("#catColor").value;
    if (!name) {
      alert("请输入分类名称");
      return;
    }
    const key = name.toLowerCase().replace(/\s+/g, "_");
    const cats = readCats();
    if (cats.some((c) => c.key === key)) {
      alert("已存在同名分类");
      return;
    }
    cats.push({ key, name, color });
    saveCats(cats);
    $("#catName").value = "";
    renderCatList();
    renderTable();
  });
  $("#catList").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const key = btn.dataset.key;
    if (!key) return;
    let cats = readCats();
    const idx = cats.findIndex((c) => c.key === key);
    if (idx < 0) return;
    const act = btn.dataset.act;
    if (act === "del") {
      if (!confirm("确定删除该分类？")) return;
      cats.splice(idx, 1);
    } else if (act === "up" && idx > 0) {
      [cats[idx - 1], cats[idx]] = [cats[idx], cats[idx - 1]];
    } else if (act === "down" && idx < cats.length - 1) {
      [cats[idx + 1], cats[idx]] = [cats[idx], cats[idx + 1]];
    }
    saveCats(cats);
    renderCatList();
    renderTable();
  });

  // 显示设置
  $("#btnView").addEventListener("click", () => {
    const p = $("#panelView");
    const btn = $("#btnView");
    const show = p.style.display === "none";
    p.style.display = show ? "" : "none";
    btn.classList.toggle("active", show);
  });

  $("#titleText").addEventListener("input", (e) => {
    const v = readView();
    v.titleText = e.target.value || "XHSPHONE";
    saveView(v);
    applyView(v);
  });
  $("#titleColor").addEventListener("input", (e) => {
    const v = readView();
    v.titleColor = e.target.value || "#111111";
    saveView(v);
    applyView(v);
  });
  $("#fontFamily").addEventListener("change", (e) => {
    const v = readView();
    v.fontFamily = e.target.value || DEFAULT_VIEW.fontFamily;
    saveView(v);
    applyView(v);
  });

  $("#rowPad").addEventListener("input", (e) => {
    const v = readView();
    v.pad = parseInt(e.target.value, 10) || 6;
    saveView(v);
    applyView(v);
  });
  $("#colScale").addEventListener("input", (e) => {
    const v = readView();
    v.colScale = parseFloat(e.target.value) || 1;
    saveView(v);
    applyView(v);
  });
  $("#zebraOn").addEventListener("change", (e) => {
    const v = readView();
    v.zebraOn = e.target.checked;
    saveView(v);
    applyView(v);
    const body = $("#gridBody");
    if (body) {
      if (v.zebraOn) body.classList.add("zebra");
      else body.classList.remove("zebra");
    }
  });
  $("#zebraColor").addEventListener("input", (e) => {
    const v = readView();
    v.zebraColor = e.target.value || "#eef5ff";
    saveView(v);
    applyView(v);
  });
  $("#btnCompact").addEventListener("click", () => {
    const v = {
      ...readView(),
      pad: 4,
      colScale: 0.9,
      zebraOn: true,
      zebraColor: "#f5f5f7",
    };
    saveView(v);
    applyView(v);
    $("#rowPad").value = v.pad;
    $("#colScale").value = v.colScale;
    $("#zebraOn").checked = v.zebraOn;
    $("#zebraColor").value = v.zebraColor;
  });
  $("#btnResetSize").addEventListener("click", () => {
    const v = { ...DEFAULT_VIEW };
    saveView(v);
    applyView(v);
    $("#titleText").value = v.titleText;
    $("#titleColor").value = v.titleColor;
    $("#fontFamily").value = v.fontFamily;
    $("#rowPad").value = v.pad;
    $("#colScale").value = v.colScale;
    $("#zebraOn").checked = v.zebraOn;
    $("#zebraColor").value = v.zebraColor;
  });

  // 桌面表格事件（inline 编辑 + 操作）
  $("#gridBody").addEventListener(
    "blur",
    async (e) => {
      const cell = e.target.closest("td[contenteditable][data-k]");
      if (!cell) return;
      const tr = cell.closest("tr");
      const id = tr.dataset.id;
      const k = cell.dataset.k;
      const v = cell.textContent.trim();
      await updateRow(id, { [k]: v });
      if (["xhs_name", "row_color"].includes(k)) {
        await renderTable();
      }
    },
    true,
  );
  $("#gridBody").addEventListener("change", async (e) => {
    const sel = e.target.closest("select[data-k='row_color']");
    if (!sel) return;
    const tr = sel.closest("tr");
    const id = tr.dataset.id;
    await updateRow(id, { row_color: sel.value });
    await renderTable();
  });
  $("#gridBody").addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const act = btn.dataset.act;
    const tr = btn.closest("tr");
    if (!tr) return;
    const id = tr.dataset.id;

    if (act === "edit") {
      // 只展开/收起同一行的菜单
      const extra = tr.querySelector(".actions-extra");
      if (extra) extra.classList.toggle("show");
      return;
    }
    if (act === "del") {
      if (!confirm("确定删除这一行？")) return;
      await deleteRowById(id);
    } else if (act === "up") {
      await moveRow(id, "up");
    } else if (act === "down") {
      await moveRow(id, "down");
    }
  });

  // 云端按钮
  $("#btnSaveCloud").addEventListener("click", async () => {
    const rows = await getAllRows();
    const payload = {
      rows,
      cats: readCats(),
      view: readView(),
      ver: 1,
      updated_at: new Date().toISOString(),
    };
    await cloudSave(payload);
  });
  $("#btnLoadCloud").addEventListener("click", async () => {
    const data = await cloudLoad();
    if (!data) return;
    if (Array.isArray(data.rows)) {
      await db.rows.clear();
      await db.rows.bulkAdd(data.rows);
    }
    if (Array.isArray(data.cats)) {
      saveCats(data.cats);
    }
    if (data.view && typeof data.view === "object") {
      saveView({ ...DEFAULT_VIEW, ...data.view });
      applyView(readView());
    }
    await refreshFilters();
    await renderTable();
    alert("云端数据已加载到本地");
  });
}

// 初始化
document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  const view = readView();
  applyView(view);
  await refreshFilters();
  await renderTable();

  // 检测 Supabase 连接
  try {
    const { error } = await supabase
      .from(SUPABASE_TABLE)
      .select("updated_at")
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("云端检测失败", error);
      setCloudStatus(false, "Base 数据连接：失败");
    } else {
      setCloudStatus(true, "Base 数据连接：已连接");
    }
  } catch (e) {
    console.warn("云端检测异常", e);
    setCloudStatus(false, "Base 数据连接：异常");
  }
});
