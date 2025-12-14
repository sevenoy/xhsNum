# 技术说明文档

> 小红书账号管理系统 (XHSPHONE) - 技术架构与功能复用指南

本文档详细说明了项目的技术架构、核心功能模块和可复用组件，帮助开发者理解并复用功能到其他项目中。

---

## 📋 目录

1. [项目架构概述](#项目架构概述)
2. [核心技术栈](#核心技术栈)
3. [核心功能模块](#核心功能模块)
4. [可复用组件](#可复用组件)
5. [技术实现细节](#技术实现细节)
6. [最佳实践](#最佳实践)

---

## 项目架构概述

### 架构模式

本项目采用 **前后端分离 + PWA** 架构：

```
┌─────────────────────────────────────────┐
│         前端应用层 (Static HTML)         │
│  ┌──────────┐  ┌──────────┐  ┌──────┐  │
│  │ IndexedDB│  │localStorage│ │PWA   │  │
│  │ (Dexie)  │  │  (配置)   │ │Cache │  │
│  └──────────┘  └──────────┘  └──────┘  │
└─────────────────────────────────────────┘
                    ↕ HTTP/HTTPS
┌─────────────────────────────────────────┐
│      后端服务层 (Supabase)              │
│  ┌──────────┐  ┌──────────┐  ┌──────┐  │
│  │ Auth     │  │ Database │  │Storage│ │
│  │ (认证)   │  │ (Postgres)│ │ (可选)│ │
│  └──────────┘  └──────────┘  └──────┘  │
└─────────────────────────────────────────┘
```

### 数据流

1. **本地优先**：数据首先存储在 IndexedDB（Dexie）
2. **云端同步**：通过 Supabase 实现多设备数据同步
3. **离线支持**：Service Worker 提供离线缓存能力
4. **权限控制**：基于 Supabase Auth + 自定义权限表

---

## 核心技术栈

### 前端技术

| 技术 | 版本 | 用途 | 文档 |
|------|------|------|------|
| **HTML5** | - | 页面结构 | - |
| **CSS3** | - | 样式和响应式布局 | - |
| **JavaScript (ES6+)** | - | 业务逻辑 | - |
| **Dexie.js** | 4.0.8 | IndexedDB 封装库 | [Dexie.js](https://dexie.org/) |
| **Supabase JS** | 2.x | 后端服务客户端 | [Supabase](https://supabase.com/docs) |

### 后端服务

| 服务 | 用途 | 说明 |
|------|------|------|
| **Supabase Auth** | 用户认证 | 基于 JWT 的认证系统 |
| **Supabase Database** | 数据存储 | PostgreSQL 数据库 |
| **Supabase Storage** | 文件存储 | (可选) 文件上传存储 |

### PWA 技术

| 技术 | 用途 |
|------|------|
| **Service Worker** | 离线缓存、自动更新 |
| **Web App Manifest** | 添加到主屏幕、主题色 |
| **Cache API** | 资源缓存管理 |

---

## 核心功能模块

### 1. 用户认证与权限管理

#### 1.1 登录系统

**位置**: `login.html`, `index.html` (登录检查)

**核心代码模式**:

```javascript
// 1. 初始化 Supabase 客户端
const SUPABASE_URL = localStorage.getItem("xhs_supabase_url");
const SUPABASE_ANON_KEY = localStorage.getItem("xhs_supabase_anon_key");
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 2. 检查登录状态
const { data: { session } } = await supabase.auth.getSession();
if (!session) {
  window.location.href = 'login.html';
  return;
}

// 3. 获取用户信息
const { data: profile } = await supabase
  .from('user_profiles')
  .select('*')
  .eq('user_id', session.user.id)
  .single();

// 4. 存储用户信息到 localStorage
localStorage.setItem('xhs_user_name', profile.username);
localStorage.setItem('xhs_user_id', session.user.id);
localStorage.setItem('xhs_user_email', profile.email);
localStorage.setItem('xhs_user_role', profile.role || 'basic');
```

**数据库表结构** (Supabase):

```sql
-- user_profiles 表
CREATE TABLE user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  role TEXT DEFAULT 'basic', -- 'basic', 'admin', 'super_admin'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 1.2 权限检查

**位置**: `js/app.js` (checkPermission 函数), `admin.html` (管理员检查)

**核心代码模式**:

```javascript
// 检查管理员权限
async function checkAdminPermission() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;
  
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('username, role')
    .eq('user_id', session.user.id)
    .maybeSingle();
  
  if (profile) {
    const username = (profile.username || '').toLowerCase();
    return username === 'sevenoy' || profile.role === 'super_admin';
  }
  return false;
}

// 检查资源权限
async function checkPermission(resourceId, resourceType, permissionType = 'view') {
  const { data: { session } } = await supabase.auth.getSession();
  const authUid = session?.user?.id;
  if (!authUid) return false;
  
  // 检查是否是资源所有者
  if (resourceType === 'snapshot') {
    const { data: snapshot } = await supabase
      .from('snapshots')
      .select('owner_id')
      .eq('key', resourceId)
      .maybeSingle();
    
    if (snapshot?.owner_id === authUid) return true;
  }
  
  // 检查权限表
  const { data: permission } = await supabase
    .from('permissions')
    .select('*')
    .eq('resource_id', resourceId)
    .eq('resource_type', resourceType)
    .eq('user_id', authUid)
    .eq('status', 'active')
    .maybeSingle();
  
  if (!permission) return false;
  
  // 检查权限类型
  if (permissionType === 'edit') {
    return permission.permission_type === 'edit';
  }
  
  return permission.permission_type === 'view' || 
         permission.permission_type === 'edit';
}
```

**权限表结构**:

```sql
-- permissions 表
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id TEXT NOT NULL,
  resource_type TEXT NOT NULL, -- 'snapshot', 'document', etc.
  user_id UUID NOT NULL REFERENCES auth.users(id),
  permission_type TEXT NOT NULL, -- 'view', 'edit'
  granted_by UUID REFERENCES auth.users(id),
  granted_by_name TEXT,
  status TEXT DEFAULT 'active', -- 'active', 'revoked', 'expired'
  expired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 1.3 FOUC 防护（防止未授权内容闪烁）

**位置**: `admin.html`

**核心代码模式**:

```css
/* CSS: 默认隐藏管理员按钮 */
.nav button.admin-only {
  display: none !important;
  visibility: hidden !important;
}
```

```html
<!-- HTML: 添加 admin-only 类 -->
<button id="btnAdmin" class="admin-only">管理员功能</button>
```

```javascript
// JavaScript: 权限验证后显示
if (isAdmin) {
  btnAdmin.classList.remove('admin-only');
} else {
  btnAdmin.remove(); // 彻底移除DOM元素
}
```

---

### 2. 本地数据存储 (IndexedDB)

#### 2.1 Dexie 初始化

**位置**: `js/app.js`

**核心代码模式**:

```javascript
import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@4.0.8/dist/dexie.min.js';

const DB_NAME = "your_app_db";
const db = new Dexie(DB_NAME);

// 定义数据库结构
db.version(1).stores({
  rows: "id,order,field1,field2,updated_at", // id 为主键，其他为索引
});

// 使用示例
async function addRow(data) {
  await db.rows.add({
    id: Date.now().toString(),
    ...data,
    updated_at: Date.now()
  });
}

async function getAllRows() {
  return await db.rows.toArray();
}

async function updateRow(id, updates) {
  await db.rows.update(id, {
    ...updates,
    updated_at: Date.now()
  });
}

async function deleteRow(id) {
  await db.rows.delete(id);
}
```

#### 2.2 数据操作模式

```javascript
// 批量操作
async function batchUpdate(updates) {
  await db.transaction('rw', db.rows, async () => {
    for (const update of updates) {
      await db.rows.update(update.id, update.data);
    }
  });
}

// 查询和筛选
async function searchRows(keyword) {
  return await db.rows
    .filter(row => 
      row.field1.includes(keyword) || 
      row.field2.includes(keyword)
    )
    .toArray();
}

// 排序
async function getSortedRows(sortField, ascending = true) {
  return await db.rows
    .orderBy(sortField)
    .reverse(!ascending)
    .toArray();
}
```

---

### 3. 云端数据同步

#### 3.1 Supabase 初始化

**位置**: `js/app.js`

**核心代码模式**:

```javascript
// 动态加载 Supabase（避免阻塞）
let supabase = null;
let hasSupabase = false;

async function initSupabase() {
  const SUPABASE_URL = localStorage.getItem("supabase_url");
  const SUPABASE_ANON_KEY = localStorage.getItem("supabase_anon_key");
  
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

// 健康检查
async function cloudHealthCheck() {
  try {
    const { data, error } = await supabase
      .from('health_check')
      .select('id')
      .limit(1);
    return !error;
  } catch (err) {
    return false;
  }
}
```

#### 3.2 数据同步模式

**保存到云端**:

```javascript
async function saveToCloud(snapshotKey, data) {
  if (!supabase) {
    console.warn('Supabase 未初始化');
    return false;
  }
  
  const userId = await getCurrentUserId();
  if (!userId) {
    console.error('用户未登录');
    return false;
  }
  
  try {
    const payload = {
      snapshot_label: '快照名称',
      data: data, // 要保存的数据
      metadata: {
        version: '1.0',
        created_at: new Date().toISOString()
      }
    };
    
    const { error } = await supabase
      .from('snapshots')
      .upsert({
        key: snapshotKey,
        owner_id: userId,
        payload: payload,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'key'
      });
    
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('保存到云端失败:', err);
    return false;
  }
}
```

**从云端加载**:

```javascript
async function loadFromCloud(snapshotKey) {
  if (!supabase) return null;
  
  try {
    // 检查权限
    const hasPermission = await checkPermission(
      snapshotKey, 
      'snapshot', 
      'view'
    );
    
    if (!hasPermission) {
      console.error('无权限访问该快照');
      return null;
    }
    
    const { data, error } = await supabase
      .from('snapshots')
      .select('payload')
      .eq('key', snapshotKey)
      .maybeSingle();
    
    if (error) throw error;
    if (!data) return null;
    
    return data.payload;
  } catch (err) {
    console.error('从云端加载失败:', err);
    return null;
  }
}
```

**快照表结构**:

```sql
-- snapshots 表
CREATE TABLE snapshots (
  key TEXT PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_snapshots_owner ON snapshots(owner_id);
CREATE INDEX idx_snapshots_updated ON snapshots(updated_at DESC);
```

---

### 4. PWA 功能

#### 4.1 Service Worker 实现

**位置**: `sw.js`

**核心代码模式**:

```javascript
const VERSION = '20250115.4';
const CACHE_NAME = `app-cache-v${VERSION}`;

const CRITICAL_RESOURCES = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './site.webmanifest',
  './icon/icon-192.png',
  './icon/icon-512.png'
];

// 安装 Service Worker
self.addEventListener('install', (event) => {
  console.log('[SW] 安装中，版本:', VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CRITICAL_RESOURCES).catch((err) => {
        console.warn('[SW] 部分资源缓存失败:', err);
      });
    })
  );
  self.skipWaiting(); // 立即激活
});

// 激活 Service Worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// 拦截网络请求
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // 只处理同源请求
  if (url.origin !== location.origin) return;
  
  // 网络优先策略（HTML、CSS、JS）
  if (request.method === 'GET' && (
    request.destination === 'document' ||
    request.url.includes('.css') ||
    request.url.includes('.js')
  )) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cachedResponse) => {
            return cachedResponse || new Response('离线状态', { status: 503 });
          });
        })
    );
  } else {
    // 缓存优先策略（其他资源）
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        return cachedResponse || fetch(request).then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        });
      })
    );
  }
});
```

#### 4.2 Service Worker 注册与更新

**位置**: `index.html`

**核心代码模式**:

```javascript
const APP_VERSION = '20250115.4';

if ('serviceWorker' in navigator) {
  let registration = null;
  let updateCheckInterval = null;
  
  // 注册 Service Worker
  navigator.serviceWorker.register('./sw.js', {
    scope: './'
  }).then((reg) => {
    registration = reg;
    console.log('✅ Service Worker 注册成功');
    
    // 检查更新
    checkForUpdate(reg);
    
    // 监听更新
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateNotification();
        }
      });
    });
    
    // 定期检查更新（每5分钟）
    updateCheckInterval = setInterval(() => {
      checkForUpdate(reg);
    }, 5 * 60 * 1000);
    
    // 页面可见时检查更新
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && reg) {
        checkForUpdate(reg);
      }
    });
  });
  
  // 检查更新函数
  function checkForUpdate(reg) {
    reg.update().then(() => {
      console.log('✅ 更新检查完成');
    }).catch((err) => {
      console.warn('⚠️ 更新检查失败:', err);
    });
  }
  
  // 显示更新通知
  function showUpdateNotification() {
    if (localStorage.getItem('update_notification_shown') === APP_VERSION) {
      return;
    }
    
    const notification = document.createElement('div');
    notification.innerHTML = `
      <div>🔄 发现新版本</div>
      <button id="btnUpdateNow">立即更新</button>
      <button id="btnUpdateLater">稍后</button>
    `;
    document.body.appendChild(notification);
    
    document.getElementById('btnUpdateNow').addEventListener('click', async () => {
      if (registration && registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      setTimeout(() => {
        window.location.reload();
      }, 500);
    });
    
    localStorage.setItem('update_notification_shown', APP_VERSION);
  }
  
  // 监听 Service Worker 控制权变化（自动刷新）
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });
}
```

#### 4.3 Web App Manifest

**位置**: `site.webmanifest`

```json
{
  "name": "应用名称",
  "short_name": "短名称",
  "description": "应用描述",
  "start_url": "./index.html?v=20250115",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#1990FF",
  "orientation": "portrait",
  "version": "20250115.4",
  "icons": [
    {
      "src": "./icon/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "./icon/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

**HTML 引用**:

```html
<link rel="manifest" href="./site.webmanifest">
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="theme-color" content="#1990FF" />
```

---

### 5. 响应式设计

#### 5.1 移动端适配

**核心 CSS 模式**:

```css
/* 基础样式 */
.container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 16px;
}

/* 平板适配 */
@media (max-width: 768px) {
  .container {
    padding: 12px;
  }
  
  .button {
    font-size: 14px;
    padding: 6px 12px;
  }
}

/* 手机适配 */
@media (max-width: 480px) {
  .container {
    padding: 8px;
  }
  
  .button {
    font-size: 12px;
    padding: 6px 10px;
  }
  
  /* Grid 布局 */
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
}

/* 防止输入框自动放大（iOS Safari） */
@media (max-width: 768px) {
  input, textarea, select {
    font-size: 16px; /* iOS 不会自动放大的最小字体 */
  }
}

/* Standalone 模式适配（添加到主屏幕后） */
@media (display-mode: standalone) {
  .topbar {
    padding-top: calc(env(safe-area-inset-top) + 8px);
  }
}
```

#### 5.2 桌面/移动双模式

**位置**: `js/app.js`, `css/style.css`

```javascript
// 检测设备类型
function isMobile() {
  return window.innerWidth <= 768;
}

// 根据设备渲染不同UI
async function renderTable() {
  if (isMobile()) {
    renderMobileList();
  } else {
    renderDesktopTable();
  }
}
```

```css
/* 桌面版显示 */
.desktop-only {
  display: block;
}

.mobile-only {
  display: none;
}

/* 移动版显示 */
@media (max-width: 768px) {
  .desktop-only {
    display: none;
  }
  
  .mobile-only {
    display: block;
  }
}
```

---

### 6. 数据导入导出

#### 6.1 CSV 导出

**位置**: `js/app.js`

```javascript
function exportToCSV() {
  const rows = await db.rows.toArray();
  
  // CSV 表头
  const headers = ['ID', '字段1', '字段2', '字段3'];
  
  // CSV 数据行
  const csvRows = rows.map(row => [
    row.id,
    row.field1,
    row.field2,
    row.field3
  ]);
  
  // 组合 CSV 内容
  const csvContent = [
    headers.join(','),
    ...csvRows.map(row => row.join(','))
  ].join('\n');
  
  // 添加 BOM 以支持中文（Excel）
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  
  // 下载
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `数据导出_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
```

#### 6.2 CSV 导入

```javascript
function importFromCSV(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        const lines = text.split('\n');
        
        // 跳过表头
        const headers = lines[0].split(',');
        const dataLines = lines.slice(1);
        
        const rows = [];
        for (const line of dataLines) {
          if (!line.trim()) continue;
          
          const values = line.split(',');
          const row = {
            id: Date.now().toString() + Math.random(),
            field1: values[0] || '',
            field2: values[1] || '',
            field3: values[2] || '',
            updated_at: Date.now()
          };
          rows.push(row);
        }
        
        // 批量插入
        await db.rows.bulkAdd(rows);
        resolve(rows.length);
      } catch (err) {
        reject(err);
      }
    };
    
    reader.onerror = reject;
    reader.readAsText(file, 'UTF-8');
  });
}
```

---

### 7. 后台任务优化

#### 7.1 页面可见性检测

**位置**: `snapshot-browser.html`

```javascript
// 检查页面是否真正可见（包括iframe情况）
function isPageVisible() {
  // 检查 document.hidden
  if (document.hidden) return false;
  
  // 检查 window 是否在焦点中（针对iframe情况）
  if (window.top !== window.self) {
    try {
      if (window.top.document.hidden) return false;
    } catch (e) {
      // 跨域情况下无法访问，保守处理
      return false;
    }
  }
  
  // 检查窗口是否在焦点中
  if (window.top !== window.self) {
    try {
      if (!window.top.document.hasFocus()) return false;
    } catch (e) {
      return false;
    }
  }
  
  return true;
}

// 自动刷新（仅在可见时）
let autoRefreshInterval = null;
const AUTO_REFRESH_INTERVAL = 100000; // 100秒

function startAutoRefresh() {
  if (autoRefreshInterval) return;
  
  autoRefreshInterval = setInterval(() => {
    if (isPageVisible()) {
      loadData(); // 刷新数据
    } else {
      stopAutoRefresh(); // 页面不可见，停止刷新
    }
  }, AUTO_REFRESH_INTERVAL);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

// 多重监听
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopAutoRefresh();
  } else if (isPageVisible()) {
    startAutoRefresh();
  }
});

window.addEventListener('focus', () => {
  if (isPageVisible()) {
    startAutoRefresh();
  }
});

window.addEventListener('blur', () => {
  stopAutoRefresh();
});
```

---

## 可复用组件

### 1. 权限检查组件

**文件**: `utils/permission.js` (建议创建)

```javascript
export class PermissionManager {
  constructor(supabase) {
    this.supabase = supabase;
  }
  
  async checkAdmin(userId) {
    const { data: profile } = await this.supabase
      .from('user_profiles')
      .select('username, role')
      .eq('user_id', userId)
      .maybeSingle();
    
    if (profile) {
      const username = (profile.username || '').toLowerCase();
      return username === 'admin' || profile.role === 'super_admin';
    }
    return false;
  }
  
  async checkResource(userId, resourceId, resourceType, permissionType = 'view') {
    // 实现权限检查逻辑
  }
}
```

### 2. 数据同步组件

**文件**: `utils/sync.js` (建议创建)

```javascript
export class DataSync {
  constructor(db, supabase) {
    this.db = db;
    this.supabase = supabase;
  }
  
  async saveToCloud(key, data) {
    // 实现保存逻辑
  }
  
  async loadFromCloud(key) {
    // 实现加载逻辑
  }
  
  async sync() {
    // 实现双向同步逻辑
  }
}
```

### 3. PWA 更新组件

**文件**: `utils/pwa-update.js` (建议创建)

```javascript
export class PWAUpdate {
  constructor(version) {
    this.version = version;
    this.registration = null;
  }
  
  async register() {
    // 注册 Service Worker
  }
  
  async checkUpdate() {
    // 检查更新
  }
  
  showNotification() {
    // 显示更新通知
  }
}
```

---

## 技术实现细节

### 1. 版本管理

**统一版本号位置**:
- `sw.js`: `const VERSION = '20250115.4';`
- `index.html`: `const APP_VERSION = '20250115.4';`
- `site.webmanifest`: `"version": "20250115.4"`

**更新流程**:
1. 修改所有文件中的版本号
2. 提交代码
3. 用户访问时自动检测更新
4. Service Worker 自动激活新版本

### 2. 错误处理模式

```javascript
// 统一错误处理
async function safeAsync(fn, errorMessage) {
  try {
    return await fn();
  } catch (err) {
    console.error(errorMessage, err);
    showToast(`❌ ${errorMessage}`);
    return null;
  }
}

// 使用示例
const data = await safeAsync(
  () => supabase.from('table').select('*'),
  '加载数据失败'
);
```

### 3. 状态管理

```javascript
// 全局状态对象
const state = {
  q: "",           // 搜索关键词
  filter: "all",   // 筛选条件
  sortBy: "date",  // 排序方式
  activeFunction: null // 当前激活的功能
};

// 状态更新函数
function updateState(key, value) {
  state[key] = value;
  localStorage.setItem(`state_${key}`, JSON.stringify(value));
  render(); // 重新渲染
}

// 状态恢复
function restoreState() {
  Object.keys(state).forEach(key => {
    const saved = localStorage.getItem(`state_${key}`);
    if (saved) {
      state[key] = JSON.parse(saved);
    }
  });
}
```

---

## 最佳实践

### 1. 安全性

- ✅ **永远不要在前端代码中硬编码敏感信息**（API Key、密码等）
- ✅ **使用环境变量或配置管理**
- ✅ **所有权限检查都在服务端验证**
- ✅ **使用 HTTPS 传输数据**
- ✅ **定期更新依赖库**

### 2. 性能优化

- ✅ **使用 IndexedDB 存储大量数据**
- ✅ **实现数据分页加载**
- ✅ **使用防抖/节流处理频繁操作**
- ✅ **图片懒加载**
- ✅ **CSS/JS 压缩和合并**

### 3. 用户体验

- ✅ **提供加载状态提示**
- ✅ **错误信息友好化**
- ✅ **支持离线使用**
- ✅ **响应式设计**
- ✅ **键盘快捷键支持**

### 4. 代码组织

- ✅ **模块化代码结构**
- ✅ **统一的命名规范**
- ✅ **注释和文档**
- ✅ **版本控制**
- ✅ **代码审查**

---

## 数据库表结构参考

### 必需表

```sql
-- 1. 用户资料表
CREATE TABLE user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  role TEXT DEFAULT 'basic',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 快照/数据表
CREATE TABLE snapshots (
  key TEXT PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 权限表
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  permission_type TEXT NOT NULL,
  granted_by UUID REFERENCES auth.users(id),
  status TEXT DEFAULT 'active',
  expired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_snapshots_owner ON snapshots(owner_id);
CREATE INDEX idx_snapshots_updated ON snapshots(updated_at DESC);
CREATE INDEX idx_permissions_resource ON permissions(resource_id, resource_type);
CREATE INDEX idx_permissions_user ON permissions(user_id);
```

---

## 快速开始模板

### 1. 基础项目结构

```
project/
├── index.html          # 主页面
├── login.html          # 登录页面
├── admin.html          # 管理页面
├── css/
│   └── style.css       # 样式文件
├── js/
│   └── app.js          # 主逻辑
├── sw.js               # Service Worker
├── site.webmanifest    # PWA 配置
└── icon/               # 图标文件
```

### 2. 最小化实现

**index.html**:
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>应用名称</title>
  <link rel="manifest" href="./site.webmanifest">
  <script src="https://cdn.jsdelivr.net/npm/dexie@4.0.8/dist/dexie.min.js"></script>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="./js/app.js"></script>
</body>
</html>
```

**js/app.js**:
```javascript
// 初始化 Dexie
const db = new Dexie('app_db');
db.version(1).stores({
  items: 'id, name, updated_at'
});

// 初始化 Supabase
let supabase = null;
async function initSupabase() {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  supabase = createClient(
    localStorage.getItem('supabase_url'),
    localStorage.getItem('supabase_key')
  );
}

// 初始化
initSupabase();
```

---

## 总结

本项目提供了一个完整的 **PWA + 本地存储 + 云端同步** 的解决方案，包含：

1. ✅ **用户认证与权限管理**
2. ✅ **本地数据存储（IndexedDB）**
3. ✅ **云端数据同步（Supabase）**
4. ✅ **PWA 功能（离线、自动更新）**
5. ✅ **响应式设计**
6. ✅ **数据导入导出**

所有功能模块都可以独立复用，根据项目需求选择使用。

---

## 相关资源

- [Dexie.js 文档](https://dexie.org/)
- [Supabase 文档](https://supabase.com/docs)
- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Web App Manifest](https://developer.mozilla.org/en-US/docs/Web/Manifest)

---

**文档版本**: 1.0  
**最后更新**: 2025-01-15  
**维护者**: sevenoy
