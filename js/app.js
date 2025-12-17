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
  if (!hasSupabase) {
    console.warn('⚠️ Supabase 配置缺失，跳过初始化');
    return;
  }

  try {
    console.log('⏳ 开始初始化 Supabase 连接...');
    const { createClient } = await import(
      "https://esm.sh/@supabase/supabase-js@2"
    );
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    
    // ✅ 执行健康检查，确保连接正常
    await cloudHealthCheck();
    console.log('✅ Supabase 连接已建立');
  } catch (err) {
    console.error("❌ Supabase 初始化失败：", err);
    supabase = null;
    // ✅ 即使初始化失败，也继续执行，避免阻塞应用
  }
}

// 默认视图
const DEFAULT_VIEW = Object.freeze({
  viewVersion: 9, // ✅ 优化：升级版本号，强制重置所有用户的配置
  pad: 4, // ✅ 优化：默认行高设为最小值
  colScale: 0.7, // ✅ 优化：默认列宽缩放设为最小值
  zebraOn: true,
  zebraColor: "#e2f0ff",
  fontFamily: "PingFang SC, -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif", // ✅ 优化：默认字体改为苹方
  fontWeight: "normal", // ✅ 优化：默认字体粗细为normal
  titleText: "号码管理", // ✅ 优化：默认标题改为"号码管理"
  titleColor: "#208BEE", // ✅ 优化：默认标题颜色 RGB(32, 139, 238)
  btnColor: "#639BD5", // ✅ 优化：默认按钮颜色 RGB(99, 155, 213)
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
  sortBy: "owner",
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

// ✅ 确保数据库连接已打开（针对新添加桌面标签网站的情况）
// 在页面加载时立即打开数据库，避免后续操作时数据库未就绪
let dbReadyPromise = db.open().then(() => {
  console.log('✅ IndexedDB 数据库连接已就绪');
  return true;
}).catch((err) => {
  console.error('❌ IndexedDB 数据库连接失败:', err);
  // 即使连接失败，也返回 true，避免阻塞应用
  return true;
});

// ✅ 确保数据库连接已打开（针对新添加桌面标签网站的情况）
let dbReady = false;
db.open().then(() => {
  dbReady = true;
  console.log('✅ IndexedDB 数据库连接已就绪');
}).catch((err) => {
  console.error('❌ IndexedDB 数据库连接失败:', err);
  // 即使连接失败，也标记为就绪，避免阻塞
  dbReady = true;
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
  root.style.setProperty("--font-weight", v.fontWeight || "normal"); // ✅ 优化：应用字体粗细设置
  root.style.setProperty("--btn-default", v.btnColor || "#639BD5"); // ✅ 优化：使用新的默认颜色

  const h1 = document.getElementById("appTitle");
  if (h1) {
    // ✅ 只更新标题文本，不显示版本号
    h1.innerHTML = v.titleText;
    h1.style.color = v.titleColor || "#208BEE"; // ✅ 优化：使用新的默认颜色
  }
}

/* =========================
 * 3. 分类配置
 * ========================= */

function readCats() {
  try {
    const raw = localStorage.getItem(CATS_KEY);
    console.log('📦 读取分类数据:', { key: CATS_KEY, raw: raw ? '有数据' : '无数据' });
    if (!raw) {
      console.log('⚠️ 分类数据为空，返回默认分类');
      // ✅ 首次使用时，保存默认分类到 localStorage
      const defaultCats = DEFAULT_CATS.slice();
      saveCats(defaultCats);
      return defaultCats;
    }
    const obj = JSON.parse(raw);
    console.log('📦 解析后的分类数据:', obj);
    // ✅ 详细显示每个分类的名称和颜色
    if (Array.isArray(obj) && obj.length > 0) {
      console.log('📋 分类详情:', obj.map(cat => ({
        id: cat.id,
        name: cat.name,
        color: cat.color
      })));
    }
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
      console.log('✅ 返回分类数据:', fixed);
      // ✅ 再次详细显示返回的分类数据
      console.log('📋 返回的分类详情:', fixed.map(cat => ({
        id: cat.id,
        name: cat.name,
        color: cat.color
      })));
      return fixed;
    }
    console.log('⚠️ 分类数据格式不正确，返回默认分类');
    // ✅ 如果数据格式不正确，也保存默认分类
    const defaultCats = DEFAULT_CATS.slice();
    saveCats(defaultCats);
    return defaultCats;
  } catch (err) {
    console.error('❌ 读取分类数据失败:', err);
    // ✅ 如果读取失败，也保存默认分类
    const defaultCats = DEFAULT_CATS.slice();
    saveCats(defaultCats);
    return defaultCats;
  }
}

function saveCats(cats) {
  console.log('💾 保存分类数据:', { key: CATS_KEY, cats: cats });
  localStorage.setItem(CATS_KEY, JSON.stringify(cats));
  console.log('✅ 分类数据已保存');
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

async function getCurrentUserId() {
  if (!supabase) {
    console.warn('⚠️ Supabase 未初始化，返回 null');
    return null;
  }

  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.error('获取 Supabase 会话失败:', error);
      return null;
    }
    const uid = session?.user?.id || null;
    if (!uid) {
      console.error('⚠️ 当前没有登录用户');
    }
    return uid;
  } catch (error) {
    console.error('获取 Supabase 会话异常:', error);
    return null;
  }
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
  if (!supabase) {
    console.warn('⚠️ Supabase 未初始化，跳过权限检查');
    return false;
  }

  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.error('❌ 获取 Supabase 会话失败:', error);
      return false;
    }

    const authUid = session?.user?.id;
    if (!authUid) {
      console.error('❌ 当前没有登录用户，无法执行权限检查');
      return false;
    }

    console.log('🔍 权限检查:', { resourceId, resourceType, permissionType, authUid });

    if (resourceType === 'snapshot') {
      const { data: snapshot, error: snapshotError } = await supabase
        .from(SUPABASE_TABLE)
        .select('owner_id')
        .eq('key', resourceId)
        .maybeSingle();

      if (snapshotError) {
        console.error('❌ 查询快照所有者失败:', snapshotError);
        return false;
      }

      if (snapshot?.owner_id === authUid) {
        console.log('✅ 当前用户是资源所有者');
        return true;
      }
    }

    const { data: permission, error: permError } = await supabase
      .from('permissions')
      .select('*')
      .eq('resource_id', resourceId)
      .eq('resource_type', resourceType)
      .eq('user_id', authUid)
      .eq('status', 'active')
      .maybeSingle();

    if (permError) {
      console.error('❌ 查询权限记录失败:', permError);
      return false;
    }

    if (!permission) {
      console.log('❌ 未找到权限记录', { resourceId, resourceType, authUid });
      return false;
    }

    if (permission.expired_at && new Date(permission.expired_at) < new Date()) {
      console.warn('⚠️ 权限记录已过期，自动标记为 expired');
      await supabase
        .from('permissions')
        .update({ status: 'expired' })
        .eq('id', permission.id);
      return false;
    }

    if (permissionType === 'edit') {
      const hasEdit = permission.permission_type === 'edit';
      console.log('✅ 编辑权限检查:', hasEdit);
      return hasEdit;
    }

    const hasView = permission.permission_type === 'view' || permission.permission_type === 'edit';
    console.log('✅ 查看权限检查:', hasView);
    return hasView;
  } catch (err) {
    console.error('❌ 权限检查失败:', err);
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
  // ✅ 如果点击的是已激活的按钮，则取消激活
  if (state.activeFunction === functionName) {
    clearActiveFunction();
    return;
  }
  
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
  // ✅ 确保数据库已打开（针对新添加桌面标签网站的情况）
  if (!db.isOpen()) {
    await dbReadyPromise;
  }
  const all = await db.rows.toArray();
  all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return all;
}

// ✅ 更新云端快照信息显示（显示本地加载的快照号和云端最新快照号）
// 使用静态变量避免重复弹出对话框
let lastCheckedSnapshotKey = null;
let isAutoUpdating = false;

// ✅ 格式化快照名称显示：去掉 default，简化用户名和年份
function formatSnapshotDisplay(snapshotLabel) {
  if (!snapshotLabel || snapshotLabel === '未知') {
    return '-';
  }
  
  // 格式：用户名 年月日时分，例如：Olina 202512172057 或 olena 202512172057
  // 转换为：O 2512172057（去掉 default，用户名只取首字母，年份从 2025 改为 25）
  
  // 如果包含 default，去掉（包括括号中的 default）
  let formatted = snapshotLabel.replace(/default\s*/gi, '').replace(/[()]/g, '').trim();
  
  // 提取用户名和日期时间
  // 格式可能是：Olina 202512172057 或 olena 202512172057
  const match = formatted.match(/^([a-zA-Z]+)\s+(\d{4})(\d{8})$/);
  if (match) {
    const userName = match[1];
    const year = match[2];
    const dateTime = match[3];
    
    // 用户名只取首字母（大写）
    const firstLetter = userName.charAt(0).toUpperCase();
    
    // 年份从 2025 改为 25
    const shortYear = year.slice(-2);
    
    return `${firstLetter} ${shortYear}${dateTime}`;
  }
  
  // 如果格式不匹配，尝试其他格式
  // 可能是：Olina 2512172057（已经是短年份）
  const match2 = formatted.match(/^([a-zA-Z]+)\s+(\d{10})$/);
  if (match2) {
    const userName = match2[1];
    const dateTime = match2[2];
    const firstLetter = userName.charAt(0).toUpperCase();
    return `${firstLetter} ${dateTime}`;
  }
  
  // 如果都不匹配，返回原值（去掉 default 和括号）
  return formatted;
}

async function updateCloudSnapshotInfo() {
  try {
    const cloudSnapshotInfo = document.getElementById('cloudSnapshotInfo');
    const cloudSnapshotLocal = document.getElementById('cloudSnapshotLocal');
    const cloudSnapshotRemote = document.getElementById('cloudSnapshotRemote');
    
    if (!cloudSnapshotInfo || !cloudSnapshotLocal || !cloudSnapshotRemote) {
      return;
    }
    
    // 从 localStorage 获取本地当前加载的云端快照信息
    const currentCloudSnapshot = localStorage.getItem('xhs_current_cloud_snapshot');
    const currentCloudVersion = localStorage.getItem('xhs_current_cloud_version');
    
    console.log('🔍 检查本地快照信息:', { currentCloudSnapshot, currentCloudVersion });
    
    // 获取云端最新的快照信息
    let latestCloudSnapshot = '未知';
    let latestCloudVersion = '未知';
    let latestSnapshotData = null;
    
    if (supabase) {
      try {
        const currentUserId = await getCurrentUserId();
        console.log('🔍 当前用户 ID:', currentUserId);
        
        if (currentUserId) {
          // 查询当前用户最新的快照
          const { data: latestSnapshot, error } = await supabase
            .from(SUPABASE_TABLE)
            .select('key, payload, updated_at')
            .eq('owner_id', currentUserId)
            .order('updated_at', { ascending: false })
            .limit(1);
          
          if (error) {
            console.warn('⚠️ 查询云端快照失败:', error);
          } else if (latestSnapshot && latestSnapshot.length > 0) {
            const snapshot = latestSnapshot[0];
            latestCloudSnapshot = snapshot.key || '未知';
            latestCloudVersion = snapshot.payload?.snapshot_label || '未知';
            latestSnapshotData = snapshot;
            console.log('✅ 获取云端最新快照:', { key: latestCloudSnapshot, version: latestCloudVersion });
          } else {
            console.log('ℹ️ 云端没有快照数据');
          }
        } else {
          console.warn('⚠️ 无法获取当前用户 ID');
        }
      } catch (err) {
        console.warn('⚠️ 获取云端最新快照失败:', err);
      }
    } else {
      console.warn('⚠️ Supabase 未初始化');
    }
    
    // ✅ 修复：分成两行显示
    // 第一行：本地版本
    // 第二行：云端版本
    if (currentCloudSnapshot && currentCloudVersion) {
      // 本地有快照信息，显示本地版本（格式化显示）
      const formattedLocal = formatSnapshotDisplay(currentCloudVersion);
      cloudSnapshotLocal.textContent = formattedLocal;
    } else {
      // 本地没有快照，显示 "-"
      cloudSnapshotLocal.textContent = '-';
    }
    
    // 云端版本始终显示最新的（格式化显示）
    const formattedRemote = formatSnapshotDisplay(latestCloudVersion);
    cloudSnapshotRemote.textContent = formattedRemote;
    
    // ✅ 云端快照信息已隐藏，但功能保持运行
    // 始终隐藏显示，但继续执行版本检测和自动更新功能
    if (cloudSnapshotInfo) {
      cloudSnapshotInfo.style.display = 'none';
    }
    
    // 记录日志（即使不显示）
    if (latestCloudSnapshot !== '未知' || currentCloudSnapshot) {
      console.log('✅ 云端快照信息已检测（已隐藏）:', { 
        local: { key: currentCloudSnapshot, version: currentCloudVersion },
        latest: { key: latestCloudSnapshot, version: latestCloudVersion }
      });
    } else {
      console.log('ℹ️ 没有快照信息可显示');
    }
    
    // ✅ 检测版本差异：如果本地版本和云端版本不同，且云端版本有更新，自动更新本地数据
    if (latestSnapshotData && latestCloudSnapshot !== '未知' && latestCloudVersion !== '未知' && !isAutoUpdating) {
      // 比较版本：主要比较 snapshot_label（版本号），因为 key 可能相同但版本不同
      const isVersionDifferent = currentCloudVersion !== latestCloudVersion;
      
      // ✅ 修复：使用版本号（snapshot_label）而不是 key 来判断是否已检查过
      // 因为同一个 key（如 "default"）可能有多个不同版本
      const hasCheckedThisVersion = lastCheckedSnapshotKey === latestCloudVersion;
      
      console.log('🔍 版本检测详情:', {
        currentCloudSnapshot,
        currentCloudVersion,
        latestCloudSnapshot,
        latestCloudVersion,
        isVersionDifferent,
        hasCheckedThisVersion,
        lastCheckedSnapshotKey,
        isAutoUpdating
      });
      
      if (isVersionDifferent && !hasCheckedThisVersion) {
        console.log('🔄 检测到云端版本更新:', {
          local: { key: currentCloudSnapshot, version: currentCloudVersion },
          latest: { key: latestCloudSnapshot, version: latestCloudVersion }
        });
        
        // 标记正在自动更新，避免重复触发
        isAutoUpdating = true;
        // ✅ 修复：使用版本号而不是 key 来标记已检查
        lastCheckedSnapshotKey = latestCloudVersion;
        
        // 弹出对话框提示用户
        const shouldUpdate = confirm(
          '🔄 检测到云端有更新的快照\n\n' +
          `本地版本：${currentCloudSnapshot || 'default'} (${currentCloudVersion || '-'})\n` +
          `云端版本：${latestCloudSnapshot} (${latestCloudVersion})\n\n` +
          '是否立即更新本地数据？\n\n' +
          '⚠️ 注意：更新将覆盖本地数据'
        );
        
        if (shouldUpdate) {
          try {
            console.log('✅ 用户确认更新，开始加载云端快照:', latestCloudSnapshot);
            await cloudLoad(latestCloudSnapshot);
            console.log('✅ 云端快照已自动更新');
          } catch (err) {
            console.error('❌ 自动更新失败:', err);
            alert(`❌ 自动更新失败：${err.message || err}`);
            // 更新失败时重置标志，允许下次重试
            lastCheckedSnapshotKey = null;
          }
        } else {
          console.log('ℹ️ 用户取消自动更新');
          // 用户取消时也记录已检查，避免频繁弹出
          lastCheckedSnapshotKey = latestCloudVersion;
        }
        
        // 重置自动更新标志
        isAutoUpdating = false;
      } else if (!isVersionDifferent && currentCloudVersion) {
        // 版本相同，重置检查标志（允许检测新的更新）
        if (lastCheckedSnapshotKey !== latestCloudVersion) {
          lastCheckedSnapshotKey = latestCloudVersion;
          console.log('✅ 版本相同，更新检查标志:', latestCloudVersion);
        }
      } else if (hasCheckedThisVersion) {
        console.log('ℹ️ 已检查过此版本，跳过:', latestCloudVersion);
      }
    } else {
      if (!latestSnapshotData) {
        console.log('ℹ️ 没有云端快照数据，跳过版本检测');
      } else if (latestCloudSnapshot === '未知') {
        console.log('ℹ️ 云端快照 key 未知，跳过版本检测');
      } else if (latestCloudVersion === '未知') {
        console.log('ℹ️ 云端快照版本未知，跳过版本检测');
      } else if (isAutoUpdating) {
        console.log('ℹ️ 正在自动更新中，跳过版本检测');
      }
    }
  } catch (err) {
    console.error('更新云端快照信息失败:', err);
    isAutoUpdating = false;
  }
}

// ✅ 更新管理中心的总数据数和版本号显示
async function updateAdminStats() {
  try {
    const all = await getAllRows();
    const totalCount = all.length;
    const adminTotalCountEl = document.getElementById('adminTotalDataCount');
    const adminVersionEl = document.getElementById('adminStatsVersion');
    
    if (adminTotalCountEl) {
      adminTotalCountEl.textContent = `总数据：${totalCount}条`;
    }
    
    if (adminVersionEl) {
      // 优先使用 window.APP_VERSION，如果没有则从页面中获取
      const version = window.APP_VERSION || document.getElementById('appVersion')?.textContent?.replace('v', '') || '';
      if (version) {
        adminVersionEl.textContent = `版本 ${version}`;
      } else {
        adminVersionEl.textContent = '版本 未知';
      }
    }
  } catch (err) {
    console.error('更新管理中心统计信息失败:', err);
  }
}

// ✅ 更新数据统计栏（总数据数和版本号）- 已移除，保留函数以防其他地方调用
async function updateDataStatsBar() {
  try {
    const all = await getAllRows();
    const totalCount = all.length;
    const totalCountEl = document.getElementById('totalDataCount');
    const versionEl = document.getElementById('statsVersion');
    const statsBar = document.getElementById('dataStatsBar');
    
    // ✅ 如果是在管理中心页面，更新管理中心显示
    if (window.location.pathname.includes('admin.html')) {
      await updateAdminStats();
    }
    
    // ✅ 数据统计栏已隐藏，不再设置显示样式
    // 保持隐藏状态，但功能继续运行
    if (statsBar) {
      // 确保始终隐藏
      statsBar.style.display = 'none';
    }
    
    if (totalCountEl) {
      totalCountEl.textContent = `总数据：${totalCount}条`;
      // ✅ 确保子元素也有正确的样式
      totalCountEl.style.cssText = `
        color: #007aff !important;
        font-weight: normal !important;
        font-size: ${window.innerWidth <= 768 ? '11px' : '12px'} !important;
        margin: 0 4px !important;
        display: inline-block !important;
      `;
    }
    
    if (versionEl) {
      // 优先使用 window.APP_VERSION，如果没有则从页面中获取
      const version = window.APP_VERSION || document.getElementById('appVersion')?.textContent?.replace('v', '') || '';
      if (version) {
        versionEl.textContent = `版本 ${version}`; // ✅ 显示"版本"前缀
      } else {
        versionEl.textContent = '版本 未知'; // ✅ 如果没有版本号，显示"未知"
      }
      // ✅ 确保版本号元素也有正确的样式
      versionEl.style.cssText = `
        color: #007aff !important;
        font-weight: normal !important;
        font-size: ${window.innerWidth <= 768 ? '11px' : '12px'} !important;
        margin: 0 4px !important;
        display: inline-block !important;
      `;
    }
    
    // ✅ 确保分隔符也有正确的样式
    const separator = statsBar?.querySelector('.stats-separator');
    if (separator) {
      separator.style.cssText = `
        color: #ccc !important;
        margin: 0 8px !important;
        font-weight: normal !important;
        display: inline-block !important;
      `;
    }
  } catch (err) {
    console.error('更新数据统计栏失败:', err);
  }
}

// ✅ 显示新增号码的编辑页面
async function showAddNumberModal() {
  const cats = readCats();
  const now = Date.now();
  
  // 创建模态框
  const modal = document.createElement('div');
  modal.className = 'add-number-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 10000;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    box-sizing: border-box;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    border-radius: 16px;
    width: 100%;
    max-width: 500px;
    max-height: 90vh;
    overflow-y: auto;
    padding: 20px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    margin: auto;
    position: relative;
    -webkit-overflow-scrolling: touch;
  `;
  
  content.innerHTML = `
    <h2 style="margin: 0 0 20px 0; font-size: 20px; color: #1990FF;">新增号码</h2>
    <div class="m-row-details" style="max-height: none; opacity: 1; padding: 0; border: none;">
      <div class="m-detail-row">
        <div class="m-detail-label">电话号</div>
        <div class="m-detail-value">
          <input type="tel" class="m-input" id="add-phone" placeholder="输入电话号" style="width: 100%;">
        </div>
      </div>
      <div class="m-detail-row">
        <div class="m-detail-label">所属人</div>
        <div class="m-detail-value">
          <input type="text" class="m-input" id="add-owner" placeholder="输入所属人" style="width: 100%;">
        </div>
      </div>
      <div class="m-detail-row">
        <div class="m-detail-label">微信实名人</div>
        <div class="m-detail-value">
          <input type="text" class="m-input" id="add-wx-real" placeholder="输入微信实名人" style="width: 100%;">
        </div>
      </div>
      <div class="m-detail-row">
        <div class="m-detail-label">对应微信名</div>
        <div class="m-detail-value">
          <input type="text" class="m-input" id="add-wx-name" placeholder="输入对应微信名" style="width: 100%;">
        </div>
      </div>
      <div class="m-detail-row">
        <div class="m-detail-label">小红书名称</div>
        <div class="m-detail-value">
          <input type="text" class="m-input" id="add-xhs-name" placeholder="输入小红书名称" style="width: 100%;">
        </div>
      </div>
      <div class="m-detail-row">
        <div class="m-detail-label">备注</div>
        <div class="m-detail-value">
          <textarea class="m-textarea" id="add-note1" placeholder="输入备注" rows="2" style="width: 100%;"></textarea>
        </div>
      </div>
      <div class="m-detail-row">
        <div class="m-detail-label">分类</div>
        <div class="m-detail-value">
          <select id="add-row-color" style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid #e5e5ea;">
            <option value="">未分类</option>
            ${cats.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>
    <div style="display: flex; gap: 10px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e5ea;">
      <button class="ghost" id="add-cancel" style="flex: 1; padding: 10px;">取消</button>
      <button class="primary" id="add-save" style="flex: 1; padding: 10px;">💾 保存</button>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  // 点击背景关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
  
  // 取消按钮
  document.getElementById('add-cancel').addEventListener('click', () => {
    modal.remove();
  });
  
  // 保存按钮
  document.getElementById('add-save').addEventListener('click', async () => {
    const phone = document.getElementById('add-phone').value.trim();
    const owner = document.getElementById('add-owner').value.trim();
    const wxReal = document.getElementById('add-wx-real').value.trim();
    const wxName = document.getElementById('add-wx-name').value.trim();
    const xhsName = document.getElementById('add-xhs-name').value.trim();
    const note1 = document.getElementById('add-note1').value.trim();
    const rowColor = document.getElementById('add-row-color').value;
    
    // 验证电话号格式（如果有输入）
    if (phone && !/^[\d\s\-()]+$/.test(phone)) {
      alert('❌ 电话号格式不正确\n\n只能包含数字、空格、短横线和括号');
      return;
    }
    
    // 创建新行
    const all = await getAllRows();
    const currentUserId = await getCurrentUserId() || 'unknown';
    const currentUserName = getCurrentUserName();
    
    // ✅ 从顶部新增：新行的 order 设为 0，其他所有行的 order + 1
    if (all.length > 0) {
      const updates = all.map(r => ({
        ...r,
        order: (r.order || 0) + 1,
        updated_at: now,
        updated_by: currentUserId,
        updated_by_name: currentUserName
      }));
      await db.rows.bulkPut(updates);
    }
    
    const row = {
      id: uid(),
      order: 0,
      phone,
      owner,
      wx_real: wxReal,
      wx_name: wxName,
      xhs_name: xhsName,
      note1,
      row_color: rowColor,
      created_at: now,
      created_by: currentUserId,
      created_by_name: currentUserName,
      updated_at: now,
      updated_by: currentUserId,
      updated_by_name: currentUserName,
    };
    
    await db.rows.add(row);
    await refreshFilters();
    
    // ✅ 保存后根据所属人排序
    state.sortBy = 'owner';
    const sortSelect = document.getElementById('sortBy');
    if (sortSelect) {
      sortSelect.value = 'owner';
    }
    
    await renderTable();
    modal.remove();
    showMobileToast('✅ 新增成功');
  });
  
  // 聚焦第一个输入框
  setTimeout(() => {
    document.getElementById('add-phone').focus();
  }, 100);
}

async function addRow() {
  // ✅ 改为显示新增号码的编辑页面
  await showAddNumberModal();
}

// ✅ 简化 updateRow，参考原始版本
async function updateRow(id, patch) {
  const row = await db.rows.get(id);
  if (!row) return;
  
  // ✅ 获取当前用户 ID（用于冲突检测和记录）
  const currentUserId = await getCurrentUserId() || 'unknown';
  const currentUserName = getCurrentUserName();
  
  // ✅ 冲突检测：检查是否有人在最近30秒内修改过
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
      // 用户选择取消，重新加载数据
      await renderTable();
      return;
    }
  }
  
  const next = { 
    ...row, 
    ...patch, 
    updated_at: now,
    updated_by: currentUserId,
    updated_by_name: currentUserName
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
  const all = await getAllRows();
  
  // ✅ 名称归一化：将所有名称转换为小写进行分组，但保留原始显示名称
  const norm = (s) => String(s || "").trim().toLowerCase();
  
  // 所属人：按小写分组，保留最常见的原始大小写形式
  const ownerMap = new Map(); // key: 小写, value: { original: 原始名称, count: 数量 }
  for (const r of all) {
    if (!r.owner) continue;
    const key = norm(r.owner);
    if (!ownerMap.has(key)) {
      ownerMap.set(key, { original: r.owner, count: 0 });
    }
    ownerMap.get(key).count++;
  }
  
  // 微信实名人：按小写分组
  const wxRealMap = new Map();
  for (const r of all) {
    if (!r.wx_real) continue;
    const key = norm(r.wx_real);
    if (!wxRealMap.has(key)) {
      wxRealMap.set(key, { original: r.wx_real, count: 0 });
    }
    wxRealMap.get(key).count++;
  }
  
  const ownerSel = $("#filterOwner");
  const realSel = $("#filterWxReal");
  const ownerVal = ownerSel.value;
  const realVal = realSel.value;

  const priority = ["Olina", "嘉", "良", "齐", "齐注销", "宫"];
  const priIndex = new Map(priority.map((name, idx) => [norm(name), idx]));
  
  const sortNames = (nameMap) => {
    const arr = Array.from(nameMap.entries());
    return arr.sort(([aKey, aVal], [bKey, bVal]) => {
      const ap = priIndex.has(aKey) ? priIndex.get(aKey) : Infinity;
      const bp = priIndex.has(bKey) ? priIndex.get(bKey) : Infinity;
      if (ap !== bp) return ap - bp;
      if (ap === Infinity) {
        if (bVal.count !== aVal.count) return bVal.count - aVal.count;
        const cmp = aVal.original.localeCompare(bVal.original, "zh");
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
  };

  const sortedOwners = sortNames(ownerMap);
  ownerSel.innerHTML =
    `<option value="all">所属人：全部</option>` +
    sortedOwners
      .map(([key, val]) => `<option value="${escapeHtml(key)}" data-original="${escapeHtml(val.original)}">${escapeHtml(val.original)}</option>`)
      .join("");

  const sortedWxReals = sortNames(wxRealMap);
  realSel.innerHTML =
    `<option value="all">微信实名人：全部</option>` +
    sortedWxReals
      .map(([key, val]) => `<option value="${escapeHtml(key)}" data-original="${escapeHtml(val.original)}">${escapeHtml(val.original)}</option>`)
      .join("");

  // ✅ 保持选中值（使用小写键）
  ownerSel.value = ownerVal ? norm(ownerVal) : "all";
  realSel.value = realVal ? norm(realVal) : "all";
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
  const norm = (s) => String(s || "").trim().toLowerCase();
  
  // ✅ 确保排序方式有效，如果无效则默认使用 "owner"
  if (!state.sortBy || (state.sortBy !== "owner" && state.sortBy !== "wx_real" && state.sortBy !== "phone" && state.sortBy !== "xhs_name" && state.sortBy !== "row_color" && state.sortBy !== "order")) {
    console.warn('⚠️ 无效的排序方式，使用默认值 "owner"', state.sortBy);
    state.sortBy = "owner";
  }
  
  // ✅ 筛选时使用小写比较，实现大小写不区分
  if (state.owner !== "all") {
    out = out.filter((r) => norm(r.owner) === norm(state.owner));
  }
  if (state.wxReal !== "all") {
    out = out.filter((r) => norm(r.wx_real) === norm(state.wxReal));
  }
  out = applySearchFilter(out);
  
  // ✅ 优先排序：order 为 0 的行（新行）始终在最上面
  // 这个函数仅负责将 order=0 的行置顶，其他行返回 0 以便后续逻辑排序
  const sortByOrder = (a, b) => {
    // 只有在手动排序模式下，才强制所有行按 order 排序
    if (state.sortBy === "order") {
      const aOrder = a.order ?? 0;
      const bOrder = b.order ?? 0;
      // 保持新行（order=0）置顶逻辑
      if (aOrder === 0 && bOrder !== 0) return -1;
      if (aOrder !== 0 && bOrder === 0) return 1;
      if (aOrder === 0 && bOrder === 0) {
        return (a.created_at || 0) - (b.created_at || 0);
      }
      return aOrder - bOrder;
    }

    // 在其他排序模式下，不再强制置顶 order=0 的行
    // 直接返回 0，让后续的字段排序逻辑（如 owner, phone 等）接管所有行
    return 0;
  };
  
  switch (state.sortBy) {
    case "owner": {
      console.log("🔍 执行按所属人排序，数据量:", out.length);
      const priority = ["Olina", "嘉", "良", "齐", "齐注销", "宫"];
      const norm = (s) => String(s || "").trim().toLowerCase();
      const priIndex = new Map(priority.map((name, idx) => [norm(name), idx]));
      const counts = new Map();
      for (const r of out) {
        const key = norm(r.owner);
        if (!key) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      out.sort((a, b) => {
        // ✅ 第一优先级：order 为 0 的行（新行）始终在最上面
        const orderCmp = sortByOrder(a, b);
        if (orderCmp !== 0) return orderCmp;
        
        // ✅ 第二优先级：按所属人排序
        const ao = a.owner || "";
        const bo = b.owner || "";
        const an = norm(ao);
        const bn = norm(bo);
        const ap = priIndex.has(an) ? priIndex.get(an) : Infinity;
        const bp = priIndex.has(bn) ? priIndex.get(bn) : Infinity;
        if (ap !== bp) return ap - bp; // 先按优先名单固定顺序（Olina 最前）
        if (ap === Infinity) {
          // 非优先名单：按数量从多到少（基于归一化后的名字聚合）
          const ca = counts.get(an) || 0;
          const cb = counts.get(bn) || 0;
          if (cb !== ca) return cb - ca;
          // 数量相同再按原始名称（中文）排序
          const nameCmp = ao.localeCompare(bo, "zh");
          if (nameCmp !== 0) return nameCmp;
        }
        // ✅ 第三优先级：同一所属人内按 order 排序
        return (a.order ?? 0) - (b.order ?? 0);
      });
      console.log("✅ 按所属人排序完成");
      break;
    }
    case "wx_real":
      out.sort((a, b) => {
        const orderCmp = sortByOrder(a, b);
        if (orderCmp !== 0) return orderCmp;
        const wxCmp = (a.wx_real || "").localeCompare(b.wx_real || "", "zh");
        if (wxCmp !== 0) return wxCmp;
        return (a.order ?? 0) - (b.order ?? 0);
      });
      break;
    case "phone":
      out.sort((a, b) => {
        const orderCmp = sortByOrder(a, b);
        if (orderCmp !== 0) return orderCmp;
        const phoneCmp = (a.phone || "").localeCompare(b.phone || "", "zh");
        if (phoneCmp !== 0) return phoneCmp;
        return (a.order ?? 0) - (b.order ?? 0);
      });
      break;
    case "xhs_name":
      out.sort((a, b) => {
        const orderCmp = sortByOrder(a, b);
        if (orderCmp !== 0) return orderCmp;
        const xhsCmp = (a.xhs_name || "").localeCompare(b.xhs_name || "", "zh");
        if (xhsCmp !== 0) return xhsCmp;
        return (a.order ?? 0) - (b.order ?? 0);
      });
      break;
    case "row_color": {
      const cats = readCats();
      out.sort((a, b) => {
        const orderCmp = sortByOrder(a, b);
        if (orderCmp !== 0) return orderCmp;
        const catCmp = catNameOf(cats, a.row_color).localeCompare(
          catNameOf(cats, b.row_color),
          "zh"
        );
        if (catCmp !== 0) return catCmp;
        return (a.order ?? 0) - (b.order ?? 0);
      });
      break;
    }
    default:
      // 手动排序：直接按 order 排序
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
  const xhsDisplay = truncateText(r.xhs_name, 12); /* ✅ 优化：显示12个汉字 */
  
      // ✅ 检查是否是最近一个月内新增的（30天），一个月后自动取消标记
      const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const isNewNumber = (r.created_at || 0) > oneMonthAgo;
      const newNumberBadge = isNewNumber ? '<span style="display: inline-block; background: #1990FF; color: white; font-size: 10px; padding: 2px 6px; border-radius: 4px; margin-right: 6px; font-weight: 500; vertical-align: middle;">最近新增</span>' : '';
  
  return `<tr data-id="${r.id}">
    <td class="col-phone" contenteditable="true" data-field="phone" data-id="${r.id}">${newNumberBadge}${escapeHtml(r.phone || "")}</td>
    ${tdEditable("col-owner", r.owner, "owner", r.id)}
    ${tdEditable("col-real", r.wx_real, "wx_real", r.id)}
    ${tdEditable("col-wx", r.wx_name, "wx_name", r.id)}
    <td class="col-xhs" contenteditable="true" data-field="xhs_name" data-id="${r.id}" 
        style="${bg ? `background:${bg};` : ""} text-align:left;" 
        title="${escapeHtml(r.xhs_name || "")}">${escapeHtml(xhsDisplay)}</td>
    ${tdEditable("col-note", r.note1, "note1", r.id)}
    ${tdSelectCat("col-cat", r.row_color, r.id)}
    ${tdActions(r.id)}
  </tr>`;
}

async function renderTable() {
  console.log("🎨 renderTable 被调用");
  console.log("🔍 当前排序方式:", state.sortBy);
  const tbody = $("#gridBody");
  const all = await getAllRows();
  console.log(`📊 总共 ${all.length} 行数据`);
  const rows = applyFilters(all);
  console.log(`📊 过滤后 ${rows.length} 行数据`);
  // ✅ 调试：显示前几条数据的所属人，验证排序是否正确
  if (rows.length > 0 && state.sortBy === "owner") {
    console.log("🔍 排序验证（前5条数据的所属人）:", rows.slice(0, 5).map(r => r.owner || "(空)"));
  }

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
  
  // ✅ 更新数据统计栏
  await updateDataStatsBar();
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
      // ✅ 移除空格并尽量完整显示小红书名称
      const xhsNameClean = (r.xhs_name || "").replace(/\s+/g, "");
      const xhsDisplay = truncateText(xhsNameClean, 20); /* ✅ 增加显示长度到20个字符 */
      
      // ✅ 检查是否是最近一个月内新增的（30天），一个月后自动取消标记
      const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const isNewNumber = (r.created_at || 0) > oneMonthAgo;
      const newNumberBadge = isNewNumber ? '<span style="display: inline-block; background: #1990FF; color: white; font-size: 10px; padding: 2px 6px; border-radius: 4px; margin-right: 6px; font-weight: 500;">最近新增</span>' : '';
      
      return `<div class="m-row" data-id="${r.id}" data-original-data='${JSON.stringify(r)}' style="--card-bg:${zebraBg}">
        <button class="m-row-header" data-id="${r.id}">
          <div class="m-main-line">
            <span class="m-phone">${newNumberBadge}${escapeHtml(r.phone || "")}</span>
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
          ${mobileDetailTextarea("小红书名称", r.xhs_name, "xhs_name", r.id)}
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
    
    // ✅ 获取当前用户 ID（用于记录）
    const currentUserId = await getCurrentUserId() || 'unknown';
    const currentUserName = getCurrentUserName();
    
    // 保存到数据库
    updates.updated_at = Date.now();
    updates.updated_by = currentUserId;
    updates.updated_by_name = currentUserName;
    
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
    dot.style.background = "#999"; // ✅ 优化：未连接状态使用灰色
    text.textContent = "未链接"; // ✅ 优化：简化显示文字
    return;
  }
  try {
    const { error } = await supabase
      .from(SUPABASE_TABLE)
      .select("updated_at")
      .eq("key", SUPABASE_DEFAULT_KEY)
      .maybeSingle();
    if (error) throw error;
    dot.style.background = "#30d158"; // ✅ 优化：已连接状态使用绿色
    text.textContent = "已链接"; // ✅ 优化：简化显示文字
  } catch (e) {
    dot.style.background = "#999"; // ✅ 优化：失败状态使用灰色
    text.textContent = "未链接"; // ✅ 优化：简化显示文字
    console.error(e);
  }
}

async function cloudSave() {
  try {
    console.log('🔄 开始保存云端... [RLS Deep Dive 方案]');
    console.log('✅ 确认：已移除 prompt() 弹窗，直接使用自动生成的快照名称');

    if (!supabase) {
      alert("未配置 Supabase，无法保存云端；本地仍可正常使用。");
      return;
    }

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      console.error('❌ 获取会话失败:', sessionError);
      alert("❌ 无法获取用户信息，请重新登录");
      return;
    }

    const authUid = session?.user?.id;
    if (!authUid) {
      console.error('❌ 当前没有登录用户');
      alert("❌ 您尚未登录，无法保存到云端");
      return;
    }

    const isAdminUser = isAdmin();

    // ✅ 先获取当前本地数据（用于比较）
    const rows = await getAllRows();
    const cats = readCats();
    const view = readView();
    
    // ✅ 调试：输出本地 view 数据，检查是否包含元数据字段
    const viewKeys = Object.keys(view || {});
    const metadataKeys = viewKeys.filter(key => 
      !['pad', 'colScale', 'zebraOn', 'zebraColor', 'fontFamily', 
        'fontWeight', 'titleText', 'titleColor', 'btnColor', 'viewVersion'].includes(key)
    );
    if (metadataKeys.length > 0) {
      console.warn('⚠️ 检测到 view 数据中包含可能的元数据字段:', metadataKeys);
      console.warn('⚠️ 这些字段将在数据比较时被排除:', metadataKeys);
    }

    // ✅ 获取最新的快照（用于数据比较）- 查询所有快照，按时间排序
    console.log('🔍 开始检查数据改动...', { 
      authUid,
      localRowsCount: rows.length,
      localCatsCount: cats.length
    });
    
    // ✅ 查询所有可访问的快照（包括授权的快照），用于比较
    // 先查询默认快照（用于比较）
    const { data: defaultSnapshot, error: defaultError } = await supabase
      .from(SUPABASE_TABLE)
      .select('key, owner_id, payload, updated_at')
      .eq('key', SUPABASE_DEFAULT_KEY)
      .maybeSingle(); // ✅ 移除 owner_id 限制，因为可能有授权的快照
    
    // 再查询最新的历史快照（所有可访问的）
    const { data: historySnapshots, error: historyError } = await supabase
      .from(SUPABASE_TABLE)
      .select('key, owner_id, payload, updated_at')
      .like('key', 'snap_%')
      .order('updated_at', { ascending: false })
      .limit(1); // ✅ 移除 owner_id 限制，因为可能有授权的快照
    
    // 确定哪个是最新的快照（比较 updated_at）
    let latestSnapshot = null;
    let latestUpdatedAt = null;
    
    if (defaultSnapshot && defaultSnapshot.updated_at) {
      latestSnapshot = defaultSnapshot;
      latestUpdatedAt = new Date(defaultSnapshot.updated_at).getTime();
    }
    
    if (historySnapshots && historySnapshots.length > 0 && historySnapshots[0]) {
      const historyTime = new Date(historySnapshots[0].updated_at).getTime();
      if (!latestUpdatedAt || historyTime > latestUpdatedAt) {
        latestSnapshot = historySnapshots[0];
        latestUpdatedAt = historyTime;
      }
    }
    
    console.log('📦 最新快照查询结果:', {
      hasDefault: !!defaultSnapshot,
      hasHistory: !!(historySnapshots && historySnapshots.length > 0),
      latestKey: latestSnapshot?.key,
      latestUpdatedAt: latestSnapshot?.updated_at,
      latestOwnerId: latestSnapshot?.owner_id,
      currentUserId: authUid,
      hasPayload: !!latestSnapshot?.payload,
      // ✅ 添加调试信息：检查快照中的 rows 数量
      latestRowsCount: latestSnapshot?.payload?.rows?.length || 0,
      localRowsCount: rows.length
    });

    if (defaultError) {
      console.warn('⚠️ 查询默认快照失败:', defaultError);
    }
    if (historyError) {
      console.warn('⚠️ 查询历史快照失败:', historyError);
    }
    
    // ✅ 检查是否有数据改动：比较当前数据和最新快照（在 prompt 之前检查）
    if (latestSnapshot && latestSnapshot.payload) {
      console.log('✅ 找到最新快照，开始比较数据...', {
        snapshotKey: latestSnapshot.key,
        snapshotUpdatedAt: latestSnapshot.updated_at,
        snapshotOwnerId: latestSnapshot.owner_id,
        currentUserId: authUid
      });
      // ✅ 关键修复：只提取需要比较的数据字段，排除所有元数据字段
      // 确保快照名称（snapshot_label）等元数据不会影响数据比较
      const latestRows = latestSnapshot.payload.rows || [];
      const latestCats = latestSnapshot.payload.cats || [];
      const latestView = latestSnapshot.payload.view || {};
      
      // ✅ 调试：输出原始数据信息和元数据信息（用于对比）
      console.log('🔍 原始数据对比:', {
        localRowsCount: rows.length,
        latestRowsCount: latestRows.length,
        localCatsCount: cats.length,
        latestCatsCount: latestCats.length,
        // ✅ 显示快照元数据（这些字段不应该影响数据比较）
        latestSnapshotLabel: latestSnapshot.payload.snapshot_label,
        latestUpdatedBy: latestSnapshot.payload.updated_by_name,
        latestUpdatedAt: latestSnapshot.payload.updated_at,
        // ✅ 确认：这些元数据字段不会参与数据比较
        note: '数据比较只比较 rows、cats、view，不包括 snapshot_label、updated_at、updated_by 等元数据'
      });
      
      // 比较 rows：只比较数据字段，忽略元数据（id, created_at, updated_at 等）
      const normalizeRow = (r) => {
        if (!r) return null;
        // ✅ 确保所有字段都标准化为字符串，并处理 undefined/null
        return {
          phone: String(r.phone || '').trim(),
          owner: String(r.owner || '').trim(),
          wx_real: String(r.wx_real || '').trim(),
          wx_name: String(r.wx_name || '').trim(),
          xhs_name: String(r.xhs_name || '').trim(),
          note1: String(r.note1 || '').trim(),
          row_color: String(r.row_color || '').trim(),
          order: String(r.order ?? 0).trim() // ✅ 使用 ?? 确保 null/undefined 都转为 "0"
        };
      };
      
      // 标准化并排序 rows（按 phone 排序，确保顺序一致）
      const sortRows = (rowsData) => {
        return rowsData
          .map(normalizeRow)
          .filter(r => r !== null)
          .sort((a, b) => {
            const phoneA = a.phone || '';
            const phoneB = b.phone || '';
            if (phoneA !== phoneB) return phoneA.localeCompare(phoneB);
            // 如果 phone 相同，按其他字段排序
            const ownerA = a.owner || '';
            const ownerB = b.owner || '';
            if (ownerA !== ownerB) return ownerA.localeCompare(ownerB);
            return (a.xhs_name || '').localeCompare(b.xhs_name || '');
          });
      };
      
      const currentRowsData = sortRows(rows);
      const latestRowsData = sortRows(latestRows);
      
      // ✅ 调试：输出前几条数据用于对比
      console.log('🔍 数据标准化后对比（前3条）:', {
        current: currentRowsData.slice(0, 3),
        latest: latestRowsData.slice(0, 3)
      });
      
      // 比较 rows（使用 JSON.stringify 比较，确保顺序一致）
      const currentRowsStr = JSON.stringify(currentRowsData);
      const latestRowsStr = JSON.stringify(latestRowsData);
      const rowsEqual = currentRowsStr === latestRowsStr;
      
      // 如果 JSON 比较失败，输出详细信息用于调试
      if (!rowsEqual) {
        console.log('📊 Rows 数据不同:', {
          currentCount: currentRowsData.length,
          latestCount: latestRowsData.length,
          currentFirst: currentRowsData[0],
          latestFirst: latestRowsData[0],
          currentStrLength: currentRowsStr.length,
          latestStrLength: latestRowsStr.length,
          // ✅ 找出第一个不同的位置
          firstDiffIndex: (() => {
            const minLen = Math.min(currentRowsStr.length, latestRowsStr.length);
            for (let i = 0; i < minLen; i++) {
              if (currentRowsStr[i] !== latestRowsStr[i]) {
                return i;
              }
            }
            return minLen;
          })()
        });
        
        // ✅ 详细对比：找出具体哪些行不同
        const maxLen = Math.max(currentRowsData.length, latestRowsData.length);
        for (let i = 0; i < Math.min(maxLen, 5); i++) {
          const currentRow = currentRowsData[i];
          const latestRow = latestRowsData[i];
          if (JSON.stringify(currentRow) !== JSON.stringify(latestRow)) {
            console.log(`📊 第 ${i + 1} 行不同:`, {
              current: currentRow,
              latest: latestRow
            });
          }
        }
      } else {
        console.log('✅ Rows 数据完全相同');
      }
      
      // 比较 cats（标准化后比较）
      const normalizeCats = (catsData) => {
        if (!Array.isArray(catsData)) return [];
        return catsData
          .map(c => ({
            id: String(c.id || '').trim(),
            name: String(c.name || '').trim(),
            color: String(c.color || '').trim()
          }))
          .sort((a, b) => (a.id || '').localeCompare(b.id || ''));
      };
      
      const currentCatsData = normalizeCats(cats);
      const latestCatsData = normalizeCats(latestCats);
      const currentCatsStr = JSON.stringify(currentCatsData);
      const latestCatsStr = JSON.stringify(latestCatsData);
      const catsEqual = currentCatsStr === latestCatsStr;
      
      if (!catsEqual) {
        console.log('📊 Cats 数据不同:', {
          current: currentCatsData,
          latest: latestCatsData,
          currentStr: currentCatsStr,
          latestStr: latestCatsStr
        });
      } else {
        console.log('✅ Cats 数据完全相同');
      }
      
      // 比较 view（排除时间戳和版本号等字段）
      // ✅ 关键修复：确保排除所有元数据字段，只比较真正的视图配置
      // ✅ 只保留已知的视图配置字段，排除所有其他字段（包括可能的元数据字段）
      const KNOWN_VIEW_FIELDS = [
        'pad', 'colScale', 'zebraOn', 'zebraColor', 'fontFamily', 
        'fontWeight', 'titleText', 'titleColor', 'btnColor'
      ];
      
      const normalizeViewData = (v) => {
        if (!v) return {};
        const normalized = {};
        
        // ✅ 只保留已知的视图配置字段，排除所有其他字段
        // 这样可以确保元数据字段（如 snapshot_label、updated_at 等）不会影响比较
        KNOWN_VIEW_FIELDS.forEach(key => {
          if (key in v) {
            const val = v[key];
            if (val === null || val === undefined) {
              normalized[key] = '';
            } else if (typeof val === 'number') {
              normalized[key] = val;
            } else {
              normalized[key] = String(val);
            }
          }
        });
        
        // 按键排序，确保比较的一致性
        return Object.keys(normalized).sort().reduce((acc, key) => {
          acc[key] = normalized[key];
          return acc;
        }, {});
      };
      
      const currentViewData = normalizeViewData(view);
      const latestViewData = normalizeViewData(latestView);
      const currentViewStr = JSON.stringify(currentViewData);
      const latestViewStr = JSON.stringify(latestViewData);
      const viewEqual = currentViewStr === latestViewStr;
      
      if (!viewEqual) {
        console.log('📊 View 数据不同:', {
          current: currentViewData,
          latest: latestViewData,
          currentStr: currentViewStr.substring(0, 100),
          latestStr: latestViewStr.substring(0, 100),
          // ✅ 显示原始 view 数据，帮助调试
          currentViewOriginal: view,
          latestViewOriginal: latestView,
          note: 'View 比较只比较已知的视图配置字段，排除所有元数据字段'
        });
      } else {
        console.log('✅ View 数据完全相同');
      }
      
      // 如果所有数据都相同，提示用户并直接返回
      console.log('🔍 数据比较结果:', {
        rowsEqual,
        catsEqual,
        viewEqual,
        rowsCount: currentRowsData.length,
        latestRowsCount: latestRowsData.length,
        allEqual: rowsEqual && catsEqual && viewEqual
      });
      
      // ✅ 关键检查：如果所有数据都相同，必须阻止保存
      const allDataEqual = rowsEqual && catsEqual && viewEqual;
      
      console.log('🔍 最终数据比较结果:', {
        rowsEqual,
        catsEqual,
        viewEqual,
        allDataEqual,
        currentRowsCount: currentRowsData.length,
        latestRowsCount: latestRowsData.length,
        currentRowsStrLength: currentRowsStr?.length || 0,
        latestRowsStrLength: latestRowsStr?.length || 0
      });
      
      if (allDataEqual) {
        console.log('❌ 数据未改动，阻止保存并返回');
        console.log('📊 详细比较信息:', {
          rowsEqual,
          catsEqual,
          viewEqual,
          currentRowsCount: currentRowsData.length,
          latestRowsCount: latestRowsData.length,
          currentRowsSample: JSON.stringify(currentRowsData.slice(0, 1)),
          latestRowsSample: JSON.stringify(latestRowsData.slice(0, 1)),
          // ✅ 添加快照信息，帮助调试多设备问题
          latestSnapshotKey: latestSnapshot?.key,
          latestSnapshotUpdatedAt: latestSnapshot?.updated_at,
          latestSnapshotLabel: latestSnapshot?.payload?.snapshot_label,
          latestUpdatedBy: latestSnapshot?.payload?.updated_by_name,
          // ✅ 明确说明：快照名称不同不影响数据比较
          note: '数据比较只比较 rows、cats、view 的实际内容，不包括快照名称（snapshot_label）等元数据'
        });
        alert('ℹ️ 没有数据改动\n\n当前数据与最新快照完全相同，无需保存。\n\n即使快照名称不同，只要数据内容相同，就不会保存。\n\n请修改数据后再保存到云端。\n\n如果确实有修改，请检查控制台日志查看详细比较信息。');
        return; // ✅ 关键：直接返回，不继续执行后续代码
      }
      
      // 只有数据有改动时才继续
      console.log('✅ 数据有改动，继续保存流程：', {
        rowsChanged: !rowsEqual,
        catsChanged: !catsEqual,
        viewChanged: !viewEqual,
        // ✅ 明确说明：快照名称不同不影响数据比较
        note: '数据比较只比较 rows、cats、view 的实际内容，不包括快照名称（snapshot_label）等元数据',
        latestSnapshotLabel: latestSnapshot?.payload?.snapshot_label,
        currentWillGenerateLabel: `${getCurrentUserName()} ${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)}`
      });
    } else {
      // 没有找到最新快照或快照没有 payload
      if (!latestSnapshot) {
        console.log('ℹ️ 没有找到历史快照，允许保存（首次保存）');
      } else if (!latestSnapshot.payload) {
        console.log('⚠️ 最新快照没有 payload 数据，允许保存');
      } else {
        console.log('⚠️ 最新快照检查失败，但继续保存流程', {
          hasSnapshot: !!latestSnapshot,
          hasPayload: !!latestSnapshot?.payload
        });
      }
    }

    // ✅ 获取默认快照（用于权限检查和快照名称）
    // ✅ 修复：查询所有可访问的默认快照（RLS 会自动过滤）
    const { data: existingSnapshot, error: existingError } = await supabase
      .from(SUPABASE_TABLE)
      .select('owner_id, payload')
      .eq('key', SUPABASE_DEFAULT_KEY)
      .maybeSingle();

    if (existingError) {
      console.error('❌ 查询默认快照失败:', existingError);
      alert("❌ 查询默认快照失败：" + existingError.message);
      return;
    }

    const snapshotOwnerId = existingSnapshot?.owner_id || null;
    const isOwner = snapshotOwnerId === authUid;

    if (existingSnapshot && !isOwner && !isAdminUser) {
      const hasEditPermission = await checkPermission(SUPABASE_DEFAULT_KEY, 'snapshot', 'edit');
      if (!hasEditPermission) {
        alert(
          "❌ 您没有权限更新此快照\n\n" +
          "请联系快照所有者或管理员授予编辑权限。"
        );
        return;
      }
    }

    // ✅ 自动生成快照名称：用户名 + 当前时间（年月日时分）
    const currentUserName = getCurrentUserName();
    const nowDate = new Date();
    const year = nowDate.getFullYear();
    const month = String(nowDate.getMonth() + 1).padStart(2, '0');
    const day = String(nowDate.getDate()).padStart(2, '0');
    const hour = String(nowDate.getHours()).padStart(2, '0');
    const minute = String(nowDate.getMinutes()).padStart(2, '0');
    const dateStr = `${year}${month}${day}${hour}${minute}`;
    const snapshotName = `${currentUserName} ${dateStr}`;
    
    console.log('✅ 自动生成快照名称:', snapshotName);

    const now = Date.now();

    console.log('✅ 数据收集完成，准备构建 payload');

    const payload = {
      ver: 1,
      snapshot_label: snapshotName,
      updated_at: now,
      updated_by: authUid,
      updated_by_name: getCurrentUserName(),
      rows,
      cats,
      view,
    };

    const ownerId = snapshotOwnerId || authUid;

    console.log('💾 开始保存默认快照...', { ownerId, authUid });

    const { error: upsertError } = await supabase.from(SUPABASE_TABLE).upsert({
      key: SUPABASE_DEFAULT_KEY,
      payload,
      owner_id: ownerId,
      updated_at: new Date(now).toISOString(),
    });

    if (upsertError) {
      console.error('❌ 保存默认快照失败:', upsertError);
      alert("❌ 保存默认快照失败：" + upsertError.message);
      return;
    }

    console.log('✅ 默认快照保存成功');

    const histKey = `snap_${now}`;
    const { error: historyInsertError } = await supabase.from(SUPABASE_TABLE).insert({
      key: histKey,
      payload,
      owner_id: authUid,
      updated_at: new Date(now).toISOString(),
    });

    if (historyInsertError) {
      console.warn('⚠️ 保存历史快照失败（不影响主流程）:', historyInsertError);
    } else {
      console.log('✅ 历史快照保存成功，开始清理旧快照');
      const { data: historyList, error: historyQueryError } = await supabase
        .from(SUPABASE_TABLE)
        .select('key, updated_at')
        .like('key', 'snap_%')
        .eq('owner_id', authUid)
        .order('updated_at', { ascending: false });

      if (historyQueryError) {
        console.error('⚠️ 查询历史快照失败（不影响主流程）:', historyQueryError);
      } else if (Array.isArray(historyList) && historyList.length > 5) {
        const toDelete = historyList.slice(5).map((item) => item.key);
        if (toDelete.length) {
          console.log('🗑️ 清理旧历史快照:', toDelete);
          await supabase.from(SUPABASE_TABLE).delete().in('key', toDelete);
        }
      }
    }

    alert(`✅ 已保存到云端\n操作人：${getCurrentUserName()}`);
    await renderCloudHistory();
    
    // ✅ 保存后立即检测云端版本更新
    await updateCloudSnapshotInfo();
  } catch (error) {
    console.error('❌ 保存云端时发生未捕获的错误:', error);
    alert(
      "保存失败：发生未知错误\n\n" +
      "错误信息：" + (error.message || String(error)) + "\n\n" +
      "请查看浏览器控制台（F12）获取详细信息"
    );
  }
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
  
  // ✅ 修复：分类设置跟随云端快照更新
  // 如果云端有分类数据，使用云端的；否则保留本地的分类数据
  const cloudCats = payload.cats;
  const localCats = readCats();
  const cats = (Array.isArray(cloudCats) && cloudCats.length > 0) ? cloudCats : localCats;
  console.log('📦 分类数据处理:', { 
    hasCloudCats: Array.isArray(cloudCats) && cloudCats.length > 0,
    cloudCatsCount: cloudCats?.length || 0,
    localCatsCount: localCats.length,
    usingCats: cats.length,
    source: (Array.isArray(cloudCats) && cloudCats.length > 0) ? '云端' : '本地保留'
  });
  // ✅ 详细显示云端分类数据
  if (Array.isArray(cloudCats) && cloudCats.length > 0) {
    console.log('☁️ 云端分类详情:', cloudCats.map(cat => ({
      id: cat.id,
      name: cat.name,
      color: cat.color
    })));
  } else {
    console.log('ℹ️ 云端没有分类数据，使用本地分类');
  }
  // ✅ 详细显示本地分类数据
  if (localCats.length > 0) {
    console.log('💾 本地分类详情:', localCats.map(cat => ({
      id: cat.id,
      name: cat.name,
      color: cat.color
    })));
  }
  // ✅ 详细显示最终使用的分类数据
  console.log('✅ 最终使用的分类详情:', cats.map(cat => ({
    id: cat.id,
    name: cat.name,
    color: cat.color
  })));
  
  const view = payload.view || DEFAULT_VIEW;
  const savedBy = payload.updated_by_name || '未知用户';

  await db.rows.clear();
  if (rows.length) await db.rows.bulkAdd(rows);

  // ✅ 修复：保存分类数据（如果云端有分类数据，使用云端的；否则保留本地的）
  saveCats(cats);
  console.log('💾 分类数据已保存:', cats);
  saveView({ ...DEFAULT_VIEW, ...view });

  await refreshFilters();
  applyView(readView());
  await renderTable();
  
  // ✅ 修复：加载云端数据后，如果分类设置面板是打开的，重新渲染分类列表
  const panelCategories = $("#panelCategories");
  if (panelCategories && panelCategories.style.display === 'block') {
    console.log('🔄 分类设置面板已打开，重新渲染分类列表');
    renderCatList();
  }
  
  // ✅ 保存当前加载的云端快照信息到 localStorage
  localStorage.setItem('xhs_current_cloud_snapshot', key);
  localStorage.setItem('xhs_current_cloud_version', payload.snapshot_label || '未知');
  
  // ✅ 更新云端快照信息显示
  await updateCloudSnapshotInfo();
  
  // ✅ 加载后刷新历史列表，显示最新的快照高亮
  await renderCloudHistory();
  
  // ✅ 优化：加载完成后自动关闭快照面板
  const panel = $("#cloudHistoryPanel");
  if (panel) {
    panel.style.display = "none";
  }
  
  alert(`✅ 云端数据已加载\n最后保存人：${savedBy}`);
}

async function renderCloudHistory(maxCount = 1) {
  const panel = $("#cloudHistoryPanel");
  if (!panel) return;
  if (!supabase) {
    panel.innerHTML =
      `<div style="padding:8px 10px;color:#888;">未配置 Supabase</div>`;
    return;
  }
  
  // ✅ 修复：getCurrentUserId() 是 async 函数，需要 await
  const currentUserId = await getCurrentUserId();
  
  // ✅ 修复：如果 currentUserId 为 null，显示错误信息
  if (!currentUserId) {
    console.error('❌ 无法获取当前用户 ID');
    panel.innerHTML =
      `<div style="padding:8px 10px;color:#ff3b30;">加载历史失败: 无法获取用户信息，请重新登录</div>`;
    return;
  }
  
  try {
    // ✅ 修复：先查询当前用户的快照，然后取最新的一条
    // 查询当前用户拥有的快照，按时间排序，只取最新的一条
  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
      .select("key,payload,updated_at,owner_id")
    .eq("owner_id", currentUserId) // ✅ 先过滤出当前用户的快照
    .order("updated_at", { ascending: false })
      .limit(1); // ✅ 只查询最新的一条快照
    
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
    
    // ✅ 获取快照所有者的用户信息
    const row = data[0];
    const ownerId = row.owner_id;
    let ownerMap = {};
    
    if (ownerId) {
      const { data: ownerProfiles } = await supabase
        .from('user_profiles')
        .select('user_id, username')
        .eq('user_id', ownerId)
        .maybeSingle();
      
      if (ownerProfiles) {
        ownerMap[ownerId] = ownerProfiles.username;
      }
    }
    
    // ✅ 只显示最新的一条快照（已经是当前用户的了）
    const mySnapshots = data;
    
    let html = '';
    
    // 显示我的快照（只显示最新的一条）
    if (mySnapshots && mySnapshots.length > 0) {
      const row = mySnapshots[0];
      const t = fmtTime(row.updated_at);
      const userName = row.payload?.updated_by_name || ownerMap[row.owner_id] || '未知';
      const metaCount = Array.isArray(row.payload?.rows)
        ? `${row.payload.rows.length} 条`
        : "";
      
      // ✅ 修复：总是使用用户名+日期时间格式，不使用"默认快照"
      let snapshotName = row.payload?.snapshot_label;
      
      // 格式化日期时间（用于快照名称）
      const formatDateTime = (ts) => {
        try {
          const d = new Date(ts);
          const Y = d.getFullYear();
          const M = String(d.getMonth() + 1).padStart(2, '0');
          const D = String(d.getDate()).padStart(2, '0');
          const h = String(d.getHours()).padStart(2, '0');
          const m = String(d.getMinutes()).padStart(2, '0');
          return `${Y}${M}${D}${h}${m}`;
        } catch {
          return '';
        }
      };
      
      // 如果没有 snapshot_label 或为空，或者包含"默认快照"字样，都重新生成
      if (!snapshotName || snapshotName.trim() === '' || snapshotName.includes('默认快照')) {
        const dateTimeStr = formatDateTime(row.updated_at);
        snapshotName = `${userName} ${dateTimeStr}`;
      }
      
      const displayName = snapshotName;
      // ✅ 最新快照添加 latest 类和"最新"标记
      const latestBadge = '<span class="cloud-item-latest-badge">最新</span>';
      
      html = `<div class="cloud-item latest" data-key="${row.key}">
        <div class="cloud-item-main">
          <div class="cloud-item-name">${escapeHtml(displayName)}${latestBadge}</div>
          <div class="cloud-item-meta">${escapeHtml(metaCount)} · 修改人：${escapeHtml(userName)}</div>
        </div>
        <div class="cloud-item-time">${escapeHtml(t)}</div>
      </div>`;
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
    
    console.log(`✅ 云端历史加载成功: 显示最新 1 条快照`);
    
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
  if (!list) {
    console.error('❌ 找不到分类列表容器 #catList');
    return;
  }
  const cats = readCats();
  console.log('🎨 渲染分类列表，分类数量:', cats.length);
  // ✅ 详细显示要渲染的分类数据
  console.log('📋 要渲染的分类详情:', cats.map(cat => ({
    id: cat.id,
    name: cat.name,
    color: cat.color
  })));
  if (cats.length === 0) {
    console.warn('⚠️ 警告：分类列表为空，无法渲染');
    list.innerHTML = '<div style="padding:8px 10px;color:#888;">暂无分类数据</div>';
    return;
  }
  
  // ✅ 生成 HTML 内容
  // 第一排：序号、分类名称、颜色
  // 第二排：上移、下移、删除按钮
  const htmlContent = cats
    .map(
      (c, i) => `<div class="cat-row" data-id="${c.id}">
        <div class="cat-row-main">
          <span class="cat-index">${i + 1}</span>
          <div class="cat-name" contenteditable="true">${escapeHtml(c.name)}</div>
          <div class="cat-color-input">
            <span class="cat-color-preview" style="background:${escapeHtml(c.color)}"></span>
            <input type="color" value="${escapeHtml(c.color)}" data-act="color" class="cat-color-picker" />
          </div>
        </div>
        <div class="cat-actions">
          <button class="ghost" data-act="up" ${i === 0 ? "disabled" : ""}>上移</button>
          <button class="ghost" data-act="down" ${
            i === cats.length - 1 ? "disabled" : ""
          }>下移</button>
          <button class="btn-danger" data-act="del">删除</button>
        </div>
      </div>`
    )
    .join("");
  
  // ✅ 调试：显示生成的 HTML 内容（前500个字符）
  console.log('🔨 生成的 HTML 内容（前500字符）:', htmlContent.substring(0, 500));
  console.log('🔨 生成的 HTML 内容长度:', htmlContent.length);
  console.log('🔨 分类列表容器元素:', list);
  console.log('🔨 分类列表容器 innerHTML 长度（渲染前）:', list.innerHTML.length);
  
  list.innerHTML = htmlContent;
  
  // ✅ 调试：检查渲染后的内容
  console.log('🔨 分类列表容器 innerHTML 长度（渲染后）:', list.innerHTML.length);
  console.log('🔨 渲染后的分类行数量:', list.querySelectorAll('.cat-row').length);
  console.log('🔨 渲染后的分类名称元素数量:', list.querySelectorAll('.cat-name').length);
  
  // ✅ 调试：显示每个分类名称元素的内容
  list.querySelectorAll('.cat-name').forEach((el, idx) => {
    console.log(`🔨 分类 ${idx} 名称元素:`, {
      element: el,
      textContent: el.textContent,
      innerHTML: el.innerHTML,
      visible: el.offsetWidth > 0 && el.offsetHeight > 0
    });
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
    .querySelectorAll('.cat-color-picker')
    .forEach((el) => {
      el.addEventListener("change", () => {
        const row = el.closest(".cat-row");
        const id = row.getAttribute("data-id");
        const cats = readCats();
        const idx = cats.findIndex((x) => x.id === id);
        if (idx < 0) return;
        cats[idx] = { ...cats[idx], color: el.value };
        saveCats(cats);
        // 更新颜色预览
        const preview = row.querySelector('.cat-color-preview');
        if (preview) {
          preview.style.background = el.value;
        }
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
    let val = td.textContent.trim();
    
    // ✅ 如果是电话号列，需要移除"最近新增"标记文本（如果存在）
    if (field === 'phone') {
      val = val.replace(/最近新增/g, '').trim();
    }
    
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
  
  // 清除搜索图标
  const clearSearchBtn = document.getElementById("clearSearch");
  const searchInput = $("#q");
  
  function updateClearButton() {
    if (clearSearchBtn && searchInput) {
      if (searchInput.value) {
        clearSearchBtn.classList.add("show");
      } else {
        clearSearchBtn.classList.remove("show");
      }
    }
  }
  
  clearSearchBtn?.addEventListener("click", async () => {
    searchInput.value = "";
    state.q = "";
    updateClearButton();
    await renderTable();
  });
  
  $("#q").addEventListener("input", async (e) => {
    state.q = e.target.value || "";
    updateClearButton();
    await renderTable();
  });
  
  // 初始化清除按钮状态
  updateClearButton();

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
    const btn = $("#btnImportExport") || $("#btnExportCSV");
    const original = btn ? btn.textContent : '';
    try {
      if (btn) { btn.disabled = true; btn.textContent = '⏳ 导出中...'; }
      const all = await getAllRows();
      const csv = toCSV(all);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "xhsphone.csv";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = original || '导出数据'; }
    }
  });

  $("#btnSaveCloud").addEventListener("click", async () => {
    try {
      console.log('🖱️ 点击了"保存云端"按钮');
      console.log('✅ 确认：已移除 prompt() 弹窗，将直接使用自动生成的快照名称');
      setActiveFunction("saveCloud");
      const btn = $("#btnSaveCloud");
      const original = btn.textContent;
      btn.disabled = true; btn.textContent = '⏳ 保存中...';
      
      // ✅ 针对安卓设备：确保获取最新代码（强制清除可能的缓存）
      // 注意：这里只是日志，实际代码中已经没有 prompt() 了
      console.log('🔍 检查代码版本：当前 app.js 应该不包含 prompt() 调用');
      
      await cloudSave();
      // 操作日志（忽略失败）
      try {
        if (window.supabase) {
          const { data: { session } } = await supabase.auth.getSession();
          const uid = session?.user?.id;
          await supabase.from('operation_logs').insert({
            action: 'save_cloud',
            target: 'default',
            user_id: uid || null,
            details: '保存默认快照',
            created_at: new Date().toISOString()
          });
        }
      } catch (_) {}
      btn.textContent = '✅ 已保存';
      setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 800);
    } catch (error) {
      console.error('❌ 按钮点击事件处理失败:', error);
      alert("保存失败：按钮事件处理错误\n\n错误信息：" + (error.message || String(error)) + "\n\n请查看浏览器控制台（F12）获取详细信息");
      const btn = $("#btnSaveCloud");
      if (btn) { btn.disabled = false; }
    }
  });

  $("#btnLoadCloud").addEventListener("click", async () => {
    setActiveFunction("loadCloud");
    const btn = $("#btnLoadCloud");
    const original = btn.textContent;
    const panel = $("#cloudHistoryPanel");
    
    // 如果面板已打开，则关闭面板
    if (panel && panel.style.display !== "none") {
      panel.style.display = "none";
      return;
    }
    
    // 显示快照选择面板
    try {
      btn.disabled = true; 
      btn.textContent = '⏳ 加载中...';
      
      // 显示历史面板，让用户选择快照
      if (panel) {
        panel.style.display = "block";
        // 使用桥接的 renderCloudHistory 函数
        const renderFunc = window.renderCloudHistory || renderCloudHistory;
        await renderFunc();
        console.log('✅ 历史面板已显示');
      } else {
        // 如果没有面板，直接加载默认快照
        const loadFunc = window.cloudLoad || cloudLoad;
        await loadFunc(SUPABASE_DEFAULT_KEY, false);
      }
      
    } catch (err) {
      console.error('加载云端数据失败:', err);
      alert('加载失败: ' + (err.message || err));
    } finally {
      btn.disabled = false; 
      btn.textContent = original;
    }
  });

  // 删除数据菜单切换
  const btnDeleteData = $("#btnDeleteData");
  const deleteDataMenu = $("#deleteDataMenu");
  if (btnDeleteData && deleteDataMenu) {
    btnDeleteData.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteDataMenu.style.display = deleteDataMenu.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener("click", () => {
      deleteDataMenu.style.display = 'none';
    });
    
    // 清空全部数据
    $("#menuClearAll").addEventListener("click", async (e) => {
      e.stopPropagation();
      deleteDataMenu.style.display = 'none';
      clearActiveFunction();
      if (!confirm("确定清空本地所有数据？此操作不可恢复。")) {
        return;
      }
      const btn = $("#btnDeleteData");
      const original = btn.textContent;
      try {
        btn.disabled = true; btn.textContent = '⏳ 清空中...';
        await db.rows.clear();
        await refreshFilters();
        await renderTable();
        btn.textContent = '✅ 已清空';
      } finally {
        setTimeout(() => { btn.disabled = false; btn.textContent = original; }, 800);
      }
    });
    
    // 删除空白数据
    $("#menuDeleteEmpty").addEventListener("click", async (e) => {
      e.stopPropagation();
      deleteDataMenu.style.display = 'none';
      clearActiveFunction();
      
      const all = await getAllRows();
      const emptyRows = all.filter(r => {
        const phone = (r.phone || '').trim();
        const owner = (r.owner || '').trim();
        const wx_real = (r.wx_real || '').trim();
        const wx_name = (r.wx_name || '').trim();
        const xhs_name = (r.xhs_name || '').trim();
        const note1 = (r.note1 || '').trim();
        const row_color = (r.row_color || '').trim();
        
        return !phone && !owner && !wx_real && !wx_name && !xhs_name && !note1 && !row_color;
      });
      
      if (emptyRows.length === 0) {
        alert('ℹ️ 没有空白数据');
        return;
      }
      
      if (!confirm(`确定删除 ${emptyRows.length} 条空白数据？此操作不可恢复。`)) {
        return;
      }
      
      const btn = $("#btnDeleteData");
      const original = btn.textContent;
      try {
        btn.disabled = true; btn.textContent = '⏳ 删除中...';
        const ids = emptyRows.map(r => r.id);
        await db.rows.bulkDelete(ids);
        await refreshFilters();
        await renderTable();
        btn.textContent = '✅ 已删除';
      } finally {
        setTimeout(() => { btn.disabled = false; btn.textContent = original; }, 800);
      }
    });
  }

  $("#btnCategories").addEventListener("click", () => {
    // ✅ 跳转到管理中心的分类设置页面
    window.location.href = 'admin.html?module=category-settings.html';
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
    // ✅ 跳转到管理中心的显示设置页面
    window.location.href = 'admin.html?module=view-settings.html';
  });


  // ✅ 显示设置相关的事件监听器已移至 view-settings.html
  
  // ✅ 用户相关功能
  // 显示当前用户名（使用 getCurrentUserName 确保能获取到用户名）
  const updateUserNameDisplay = () => {
    const currentUserNameEl = $("#currentUserName");
    if (!currentUserNameEl) return;
    
    // ✅ 检查是否有退出标志，如果有则隐藏用户名
    const isLoggingOut = sessionStorage.getItem('xhs_logging_out') === 'true';
    if (isLoggingOut) {
      currentUserNameEl.style.display = 'none';
      currentUserNameEl.textContent = '';
      return;
    }
    
    // ✅ 优先使用 window.currentUser（最新）
    let userName = null;
    if (window.currentUser && window.currentUser.name) {
      userName = window.currentUser.name;
    } else {
      // 降级：使用 getCurrentUserName() 函数
      userName = getCurrentUserName();
    }
    
    // ✅ 如果还是没有，直接从 localStorage 获取
    if (!userName || userName === '匿名用户') {
      userName = localStorage.getItem('xhs_user_name');
    }
    
    if (userName && userName !== '匿名用户') {
      currentUserNameEl.textContent = `👤 ${userName}`;
      currentUserNameEl.style.display = 'inline-block';
      currentUserNameEl.style.visibility = 'visible';
      currentUserNameEl.style.opacity = '1';
      console.log('✅ 用户名显示已更新:', userName);
    } else {
      // 如果还是没有，隐藏元素
      currentUserNameEl.style.display = 'none';
    }
  };
  
  // ✅ 立即尝试更新一次
  updateUserNameDisplay();
  
  // ✅ 延迟更新（等待 window.currentUser 设置）- 增加延迟时间
  setTimeout(() => {
    updateUserNameDisplay();
  }, 500);
  
  // ✅ 再次延迟更新（针对桌面书签打开的情况）
  setTimeout(() => {
    updateUserNameDisplay();
  }, 1000);
  
  // ✅ 定期检查并更新（每500ms检查一次，最多检查15次，增加检查次数）
  let checkCount = 0;
  const checkInterval = setInterval(() => {
    checkCount++;
    updateUserNameDisplay();
    // ✅ 增加检查次数到15次，并检查是否已经有用户名显示
    const currentUserNameEl = $("#currentUserName");
    const hasUserName = currentUserNameEl && 
                       currentUserNameEl.textContent && 
                       currentUserNameEl.textContent.trim() !== '' &&
                       currentUserNameEl.style.display !== 'none';
    
    if (checkCount >= 15 || hasUserName) {
      clearInterval(checkInterval);
      if (hasUserName) {
        console.log('✅ 用户名显示检查完成，已显示用户名');
      } else {
        console.warn('⚠️ 用户名显示检查完成，但未找到用户名');
      }
    }
  }, 500);
  
  // 退出登录
  const btnLogout = $("#btnLogout");
  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      if (!confirm("确定要退出登录吗？")) return;
      
      // ✅ 设置退出标志（使用 sessionStorage，刷新后自动清除）
      sessionStorage.setItem('xhs_logging_out', 'true');
      
      // ✅ 先清除所有本地登录数据
      localStorage.removeItem('xhs_remember_me');
      localStorage.removeItem('xhs_remembered_username');
      localStorage.removeItem('xhs_user_name');
      localStorage.removeItem('xhs_user_id');
      localStorage.removeItem('xhs_user_email');
      localStorage.removeItem('xhs_user_role');
      localStorage.removeItem('xhs_is_admin');
      localStorage.removeItem('xhs_last_login');
      
      // ✅ 清除用户名显示
      const currentUserNameEl = $("#currentUserName");
      if (currentUserNameEl) {
        currentUserNameEl.style.display = 'none';
        currentUserNameEl.textContent = '';
      }
      
      // ✅ 清除 Supabase session（多次尝试确保清除）
      if (supabase) {
        try {
          await supabase.auth.signOut();
          console.log('✅ Supabase session 已清除');
          
          // ✅ 等待一下，再次检查并清除
          await new Promise(resolve => setTimeout(resolve, 200));
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            console.log('⚠️ Session 仍然存在，再次清除');
            await supabase.auth.signOut();
          }
        } catch (err) {
          console.error('退出登录时出错:', err);
        }
      }
      
      // ✅ 跳转到登录页，并添加时间戳防止缓存
      // 使用 replace 而不是 href，避免浏览器历史记录问题
      window.location.replace('login.html?logout=' + Date.now());
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
  // 管理页面入口
  const btnAdmin = $("#btnAdmin");
  if (btnAdmin) {
    btnAdmin.addEventListener("click", () => {
      window.location.href = 'admin.html';
    });
  }
  // 导入导出复合按钮
  const btnImportExport = $("#btnImportExport");
  const importExportMenu = $("#importExportMenu");
  if (btnImportExport && importExportMenu) {
    btnImportExport.addEventListener("click", (e) => {
      e.stopPropagation();
      importExportMenu.style.display = importExportMenu.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener("click", () => {
      importExportMenu.style.display = 'none';
    });
    $("#menuImport").addEventListener("click", async (e) => {
      e.stopPropagation();
      importExportMenu.style.display = 'none';
      const btn = $("#btnImportExport");
      const original = btn.textContent;
      try {
        btn.disabled = true; btn.textContent = '⏳ 导入中...';
        $("#csvFile").click();
      } finally {
        setTimeout(() => { btn.disabled = false; btn.textContent = original; }, 800);
      }
    });
    $("#menuExport").addEventListener("click", async (e) => {
      e.stopPropagation();
      importExportMenu.style.display = 'none';
      $("#btnExportCSV").click();
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
    // ✅ 修复：使用同步方式获取用户 ID（从 localStorage）
    // 在线状态管理不需要严格的 Supabase 会话验证
    this.userId = window.currentUser?.id || localStorage.getItem('xhs_user_id') || 'unknown';
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
  
  // ✅ 确保 IndexedDB 数据库已打开（针对新添加桌面标签网站的情况）
  try {
    await dbReadyPromise;
    if (!db.isOpen()) {
      console.log('⏳ 等待 IndexedDB 数据库打开...');
      await db.open();
      console.log('✅ IndexedDB 数据库已打开');
    } else {
      console.log('✅ IndexedDB 数据库已就绪');
    }
  } catch (err) {
    console.error('❌ IndexedDB 数据库打开失败:', err);
    // 继续执行，避免阻塞应用
  }
  
  // ✅ 等待一下，确保 window.isAdmin 和 window.currentUser 已经设置（增加等待时间）
  await new Promise(resolve => setTimeout(resolve, 300));
  
  // ✅ 恢复用户信息（针对桌面书签打开的情况）
  if (!window.currentUser) {
    const storedName = localStorage.getItem('xhs_user_name');
    const storedId = localStorage.getItem('xhs_user_id');
    const storedEmail = localStorage.getItem('xhs_user_email');
    
    if (storedName && storedId) {
      window.currentUser = {
        id: storedId,
        email: storedEmail || '',
        name: storedName
      };
      console.log('✅ DOMContentLoaded: 从 localStorage 恢复用户信息', window.currentUser);
    }
  }
  
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
  
  // ✅ 立即更新用户名显示（针对桌面书签打开的情况）
  const currentUserNameEl = $("#currentUserName");
  if (currentUserNameEl) {
    const userName = window.currentUser?.name || localStorage.getItem('xhs_user_name');
    if (userName && userName !== '匿名用户') {
      currentUserNameEl.textContent = `👤 ${userName}`;
      currentUserNameEl.style.display = 'inline-block';
      currentUserNameEl.style.visibility = 'visible';
      currentUserNameEl.style.opacity = '1';
      console.log('✅ DOMContentLoaded: 立即更新用户名显示', userName);
    }
  }
  
  // 初始化在线状态管理
  if (window.currentUser) {
    window.onlineStatusManager = new OnlineStatusManager();
  }
  
  applyView(readView());
  
  // ✅ 在 bindEvents 之前先确保排序设置正确
  const sortSelect = $("#sortBy");
  if (sortSelect) {
    // 强制设置为 "owner"（按所属人排序）
    state.sortBy = "owner";
    sortSelect.value = "owner";
    console.log('✅ 初始化排序设置: 按所属人排序 (owner)');
  } else {
    // 如果下拉框不存在（可能在手机端被隐藏），也确保 state.sortBy 是 "owner"
    state.sortBy = "owner";
    console.log('✅ 初始化排序设置: 按所属人排序 (owner) - 下拉框不存在');
  }
  
  bindEvents();
  
  // ✅ 添加全局事件监听器：按钮失去焦点时清除active状态
  document.addEventListener('click', (e) => {
    // 如果点击的不是按钮，清除所有按钮的active状态
    if (!e.target.closest('button.function-btn') && !e.target.closest('button.ghost')) {
      clearActiveFunction();
    }
  });
  
  // ✅ 按钮失去焦点时清除active状态
  document.addEventListener('focusout', (e) => {
    if (e.target.classList.contains('function-btn') || e.target.classList.contains('ghost')) {
      // 延迟清除，避免与其他事件冲突
      setTimeout(() => {
        if (document.activeElement !== e.target) {
          e.target.classList.remove('active');
        }
      }, 100);
    }
  });
  
  // ✅ 确保 Supabase 连接已初始化（在渲染之前）
  await initSupabase();
  
  // ✅ 在渲染之前再次确认排序设置
  await refreshFilters();
  console.log('🔍 渲染前最终确认排序方式:', state.sortBy);
  await renderTable();
  
  // ✅ 确保数据统计栏已更新
  await updateDataStatsBar();
  
  // ✅ 页面加载时立即显示云端快照信息
  await updateCloudSnapshotInfo();
  
  // ✅ 定期更新云端快照信息（每3秒更新一次，更实时地检测版本更新）
  setInterval(async () => {
    await updateCloudSnapshotInfo();
  }, 3000);
  
  const panel = $("#cloudHistoryPanel");
  if (panel) panel.style.display = "none";
  
  const loadSnapshotKey = localStorage.getItem('xhs_load_snapshot_key');
  if (loadSnapshotKey && supabase) {
    localStorage.removeItem('xhs_load_snapshot_key');
    const ok = confirm('检测到待加载的云端快照，是否立即加载？\n\n本地数据将被覆盖。');
    if (ok) {
      try {
        await cloudLoad(loadSnapshotKey);
      } catch (err) {
        alert(`❌ 加载失败：${err.message}`);
      }
    }
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

// 确保按钮/调用最终走桥接的新同步逻辑（防止旧函数覆盖）
if (window.cloudSave) cloudSave = window.cloudSave;
if (window.cloudLoad) cloudLoad = window.cloudLoad;
if (window.renderCloudHistory) renderCloudHistory = window.renderCloudHistory;
if (window.cloudHealthCheck) cloudHealthCheck = window.cloudHealthCheck;
