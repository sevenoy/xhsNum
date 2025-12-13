# 技术白皮书 - 号码管理系统

## 📋 目录

1. [项目概述](#项目概述)
2. [技术栈](#技术栈)
3. [项目结构](#项目结构)
4. [核心功能模块](#核心功能模块)
5. [配置参数说明](#配置参数说明)
6. [数据库结构](#数据库结构)
7. [API接口](#api接口)
8. [关键实现细节](#关键实现细节)
9. [复用指南](#复用指南)

---

## 项目概述

这是一个基于 **Progressive Web App (PWA)** 架构的数据管理系统，采用 **前端离线优先 + 云端同步** 的设计模式。系统支持多设备数据同步、权限管理、版本控制等企业级功能。

### 核心特性

- ✅ **离线优先**：使用 IndexedDB 本地存储，支持完全离线使用
- ✅ **云端同步**：基于 Supabase 的实时数据同步
- ✅ **PWA 支持**：可安装到桌面/手机，支持离线访问
- ✅ **权限管理**：基于角色的访问控制（RBAC）和资源级权限
- ✅ **版本控制**：快照系统支持数据版本管理和回滚
- ✅ **响应式设计**：桌面端表格视图 + 移动端卡片视图
- ✅ **自动更新**：Service Worker 自动检测和提示更新

---

## 技术栈

### 前端技术

| 技术 | 版本 | 用途 |
|------|------|------|
| **HTML5** | - | 页面结构 |
| **CSS3** | - | 样式和响应式布局 |
| **JavaScript (ES6+)** | - | 核心业务逻辑 |
| **Dexie.js** | 4.0.8 | IndexedDB 封装库 |
| **Supabase JS** | 2.x | 后端服务客户端 |

### 后端服务

| 服务 | 用途 |
|------|------|
| **Supabase** | BaaS (Backend as a Service) |
| - PostgreSQL | 关系型数据库 |
| - Auth | 用户认证系统 |
| - Storage | 文件存储（可选） |
| - Realtime | 实时数据同步（可选） |

### PWA 技术

| 技术 | 用途 |
|------|------|
| **Service Worker** | 离线缓存和更新控制 |
| **Web App Manifest** | 应用安装配置 |
| **IndexedDB** | 本地数据存储 |

---

## 项目结构

```
项目根目录/
├── index.html              # 主页面（数据管理界面）
├── login.html              # 登录页面
├── admin.html              # 管理后台入口
├── site.webmanifest        # PWA 配置文件
├── sw.js                   # Service Worker 脚本
├── update-log.json         # 更新日志
│
├── css/
│   └── style.css           # 主样式文件
│
├── js/
│   ├── app.js              # 主应用逻辑（核心文件）
│   ├── config.js           # 配置和常量模块
│   ├── utils.js            # 工具函数模块
│   ├── auth.js             # 认证和权限模块
│   ├── data.js             # 数据操作模块（待完善）
│   └── sync.js             # 云端同步模块（待完善）
│
├── icon/                   # 应用图标
│   ├── icon-192.png
│   ├── icon-512.png
│   └── ...
│
└── [其他管理页面]
    ├── user-management.html        # 用户管理
    ├── permission-management.html  # 权限管理
    ├── approval-management.html    # 审批管理
    ├── snapshot-browser.html       # 快照浏览器
    ├── recent-changes.html         # 变更历史
    ├── view-settings.html          # 视图设置
    └── category-settings.html      # 分类设置
```

---

## 核心功能模块

### 1. 数据管理模块

#### 1.1 本地数据存储（IndexedDB）

**技术实现：**
- 使用 **Dexie.js** 封装 IndexedDB
- 数据库名称：`xhs_phone_sheet_v7`
- 表结构：`rows` 表，字段包括：`id`, `order`, `phone`, `owner`, `wx_real`, `wx_name`, `xhs_name`, `note1`, `row_color`, `updated_at`

**关键函数：**

```javascript
// 初始化数据库
const db = new Dexie(DB_NAME);
db.version(1).stores({
  rows: "id,order,phone,owner,wx_real,wx_name,xhs_name,note1,row_color,updated_at"
});

// 获取所有数据
async function getAllRows() {
  const all = await db.rows.toArray();
  all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return all;
}

// 添加数据
async function addRow(row) {
  await db.rows.add(row);
}

// 更新数据
async function updateRow(id, patch) {
  await db.rows.update(id, patch);
}

// 删除数据
async function deleteRowById(id) {
  await db.rows.delete(id);
}
```

**配置参数：**
- `DB_NAME`: 数据库名称（默认：`"xhs_phone_sheet_v7"`）

---

#### 1.2 数据筛选和搜索

**功能特性：**
- 关键词搜索（支持多词搜索）
- 按所属人筛选
- 按微信实名人筛选
- 排序功能（按所属人、电话等）
- 精确匹配模式

**关键函数：**

```javascript
// 全局筛选状态
const state = {
  q: "",           // 搜索关键词
  owner: "all",    // 所属人筛选
  wxReal: "all",   // 微信实名人筛选
  sortBy: "owner", // 排序方式
  precise: false   // 精确匹配模式
};

// 应用筛选
function applyFilters(rows) {
  let filtered = applySearchFilter(rows);
  // ... 其他筛选逻辑
  return filtered;
}

// 搜索过滤
function applySearchFilter(rows) {
  if (!state.q) return rows;
  const tokens = tokenize(state.q);
  return rows.filter(row => {
    // 多词搜索逻辑
  });
}
```

---

#### 1.3 数据渲染

**桌面端：表格视图**
- 可编辑单元格
- 行内编辑
- 分类颜色标记
- 操作按钮（编辑/删除）

**移动端：卡片视图**
- 折叠列表
- 卡片详情编辑
- 触摸优化

**关键函数：**

```javascript
// 渲染表格
async function renderTable() {
  const rows = applyFilters(await getAllRows());
  // 生成表格 HTML
  tbody.innerHTML = rows.map(r => makeRowTr(r)).join("");
}

// 渲染移动端列表
function renderMobileList(rows) {
  // 生成卡片 HTML
}
```

---

### 2. 云端同步模块

#### 2.1 Supabase 配置

**配置方式：**

```javascript
// 方式1：通过 localStorage
localStorage.setItem("xhs_supabase_url", "https://your-project.supabase.co");
localStorage.setItem("xhs_supabase_anon_key", "your-anon-key");

// 方式2：通过全局变量
window.SUPABASE_URL = "https://your-project.supabase.co";
window.SUPABASE_ANON_KEY = "your-anon-key";
```

**初始化：**

```javascript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

**配置参数：**
- `SUPABASE_URL`: Supabase 项目 URL
- `SUPABASE_ANON_KEY`: Supabase 匿名密钥
- `SUPABASE_TABLE`: 快照表名（默认：`"xhsphone_snapshot"`）
- `SUPABASE_DEFAULT_KEY`: 默认快照键（默认：`"default"`）

---

#### 2.2 快照系统

**快照结构：**

```javascript
{
  key: "default" | "snap_1234567890",  // 快照键
  owner_id: "user-uuid",                // 所有者ID
  payload: {
    ver: 1,                             // 版本号
    snapshot_label: "用户名 202512131530", // 快照名称
    updated_at: 1234567890,              // 更新时间戳
    updated_by: "user-uuid",             // 更新者ID
    updated_by_name: "用户名",            // 更新者名称
    rows: [...],                         // 数据行
    cats: [...],                         // 分类数据
    view: {...}                          // 视图配置
  },
  updated_at: "2025-12-13T15:30:00Z"    // 数据库更新时间
}
```

**关键函数：**

```javascript
// 保存到云端
async function cloudSave() {
  // 1. 检查数据改动
  // 2. 构建 payload
  // 3. 保存默认快照
  // 4. 保存历史快照
  // 5. 清理旧快照（保留最新5条）
}

// 从云端加载
async function cloudLoad(key = "default") {
  // 1. 权限检查
  // 2. 查询快照
  // 3. 加载数据到本地
  // 4. 更新界面
}

// 渲染云端历史
async function renderCloudHistory(maxCount = 1) {
  // 查询并显示快照列表
}
```

**数据改动检测：**

```javascript
// 比较当前数据和最新快照
function compareData(currentData, latestSnapshot) {
  // 标准化数据（排除元数据）
  const normalizeRow = (r) => ({
    phone: String(r.phone || '').trim(),
    owner: String(r.owner || '').trim(),
    // ... 其他字段
  });
  
  // 比较 rows、cats、view
  const rowsEqual = JSON.stringify(currentRows) === JSON.stringify(latestRows);
  // ... 其他比较
  
  return rowsEqual && catsEqual && viewEqual;
}
```

---

### 3. 用户认证模块

#### 3.1 登录系统

**实现方式：**
- 基于 Supabase Auth
- 支持用户名/密码登录
- 记住我功能
- 自动登录检查

**关键代码：**

```javascript
// 登录检查（index.html）
const { data: { session } } = await supabase.auth.getSession();
if (!session) {
  window.location.href = 'login.html';
}

// 登录（login.html）
const { data, error } = await supabase.auth.signInWithPassword({
  email: userEmail,
  password: password
});
```

**用户信息存储：**
- `localStorage`: `xhs_user_name`, `xhs_user_id`, `xhs_user_email`, `xhs_user_role`, `xhs_is_admin`
- `window.currentUser`: 当前用户对象

---

#### 3.2 权限管理

**权限系统架构：**

1. **角色权限**（基于用户角色）
   - `super_admin`: 超级管理员
   - `admin`: 管理员
   - `basic`: 普通用户

2. **资源权限**（基于权限表）
   - 表名：`permissions`
   - 字段：`resource_id`, `resource_type`, `user_id`, `permission_type`, `status`, `expired_at`

**权限检查函数：**

```javascript
// 检查资源权限
async function checkPermission(resourceId, resourceType, permissionType = 'view') {
  // 1. 检查是否是资源所有者
  // 2. 检查权限表
  // 3. 检查权限是否过期
  // 4. 返回权限结果
}

// 检查是否是管理员
function isAdmin() {
  return window.isAdmin || localStorage.getItem('xhs_is_admin') === 'true';
}
```

**权限表结构：**

```sql
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  resource_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  user_id UUID NOT NULL,
  permission_type TEXT NOT NULL, -- 'view' 或 'edit'
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'expired', 'revoked'
  expired_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

### 4. PWA 功能模块

#### 4.1 Service Worker

**功能：**
- 离线缓存
- 自动更新检测
- 版本控制

**关键配置：**

```javascript
// sw.js
const VERSION = 'V251213.12'; // 版本号
const CACHE_NAME = `xhsnum-cache-v${VERSION}`;

// 缓存策略
// - HTML/CSS/JS: 网络优先
// - 其他资源: 缓存优先
```

**更新机制：**

```javascript
// index.html
// 1. 注册 Service Worker
navigator.serviceWorker.register('./sw.js?v=' + APP_VERSION);

// 2. 检测更新
async function checkForUpdate(reg) {
  await reg.update();
  // 检查版本号
  // 显示更新提示
}

// 3. 用户确认更新
// 清除缓存并刷新页面
```

**版本号格式：**
- 格式：`V + YYMMDD + . + N`
- 示例：`V251213.12` 表示 2025年12月13日第12次更新

---

#### 4.2 Web App Manifest

**配置文件：`site.webmanifest`**

```json
{
  "name": "应用名称",
  "short_name": "短名称",
  "description": "应用描述",
  "start_url": "./index.html?v=V251213",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#1990FF",
  "orientation": "portrait",
  "version": "V251213.12",
  "icons": [...]
}
```

**关键参数：**
- `display`: `"standalone"` - 独立应用模式
- `theme_color`: 主题颜色（状态栏颜色）
- `start_url`: 启动URL（带版本号参数）

---

### 5. 视图配置模块

#### 5.1 视图设置

**配置项：**

```javascript
const DEFAULT_VIEW = {
  viewVersion: 9,              // 视图版本号
  pad: 4,                      // 行高
  colScale: 0.7,               // 列宽缩放
  zebraOn: true,               // 斑马纹开关
  zebraColor: "#e2f0ff",       // 斑马纹颜色
  fontFamily: "PingFang SC...", // 字体
  fontWeight: "normal",        // 字体粗细
  titleText: "号码管理",        // 标题文本
  titleColor: "#208BEE",       // 标题颜色
  btnColor: "#639BD5"          // 按钮颜色
};
```

**存储方式：**
- `localStorage`: 键名 `"xhs_view_v7"`

**应用视图：**

```javascript
function applyView(v) {
  // 应用视图配置到页面
  document.documentElement.style.setProperty('--pad', v.pad);
  // ... 其他样式应用
}
```

---

#### 5.2 分类设置

**分类结构：**

```javascript
const DEFAULT_CATS = [
  { id: "enterprise", name: "企业号", color: "#007aff" },
  { id: "olina", name: "Olina用", color: "#34c759" },
  // ...
];
```

**存储方式：**
- `localStorage`: 键名 `"xhs_cats_v7"`

---

### 6. 数据导入导出

#### 6.1 CSV 导出

**功能：**
- 导出为 CSV 格式
- 包含所有数据字段

**关键函数：**

```javascript
function toCSV(rows) {
  const headers = ["phone", "owner", "wx_real", "wx_name", "xhs_name", "note1"];
  const csvRows = [headers.join(",")];
  rows.forEach(row => {
    csvRows.push(headers.map(h => `"${row[h] || ''}"`).join(","));
  });
  return csvRows.join("\n");
}
```

---

#### 6.2 CSV 导入

**功能：**
- 解析 CSV 文件
- 批量导入数据

**关键函数：**

```javascript
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  const headers = lines[0].split(",").map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    const obj = {};
    headers.forEach((h, idx) => (obj[h] = cols[idx] || ""));
    rows.push(obj);
  }
  return rows;
}
```

---

## 配置参数说明

### 核心配置常量

**文件：`js/config.js`**

```javascript
// 本地存储键名
export const VIEW_KEY = "xhs_view_v7";
export const CATS_KEY = "xhs_cats_v7";

// 数据库配置
export const DB_NAME = "xhs_phone_sheet_v7";

// Supabase配置
export const SUPABASE_TABLE = "xhsphone_snapshot";
export const SUPABASE_DEFAULT_KEY = "default";
```

### Supabase 配置

**配置位置：**
- `localStorage`: `xhs_supabase_url`, `xhs_supabase_anon_key`
- 或通过 `window.SUPABASE_URL`, `window.SUPABASE_ANON_KEY`

**初始化函数：**

```javascript
export function initSupabaseConfig() {
  if (!localStorage.getItem("xhs_supabase_url")) {
    localStorage.setItem("xhs_supabase_url", "your-url");
  }
  if (!localStorage.getItem("xhs_supabase_anon_key")) {
    localStorage.setItem("xhs_supabase_anon_key", "your-key");
  }
}
```

### 版本号配置

**需要同步更新的文件：**
1. `index.html`: `APP_VERSION` 常量
2. `sw.js`: `VERSION` 常量
3. `site.webmanifest`: `version` 字段
4. `update-log.json`: 添加新版本条目

**版本号格式：**
- `V + YYMMDD + . + N`
- 示例：`V251213.12`

---

## 数据库结构

### Supabase 数据库表

#### 1. user_profiles（用户资料表）

```sql
CREATE TABLE user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'basic', -- 'super_admin', 'admin', 'basic'
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### 2. xhsphone_snapshot（快照表）

```sql
CREATE TABLE xhsphone_snapshot (
  key TEXT PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  payload JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_snapshot_owner ON xhsphone_snapshot(owner_id);
CREATE INDEX idx_snapshot_updated ON xhsphone_snapshot(updated_at DESC);
```

#### 3. permissions（权限表）

```sql
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  resource_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  permission_type TEXT NOT NULL, -- 'view' 或 'edit'
  status TEXT NOT NULL DEFAULT 'active',
  expired_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_permissions_resource ON permissions(resource_id, resource_type);
CREATE INDEX idx_permissions_user ON permissions(user_id);
```

#### 4. operation_logs（操作日志表，可选）

```sql
CREATE TABLE operation_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Row Level Security (RLS) 策略

**快照表 RLS：**

```sql
-- 允许所有者访问
CREATE POLICY "用户可访问自己的快照"
ON xhsphone_snapshot FOR SELECT
USING (auth.uid() = owner_id);

-- 允许有权限的用户访问
CREATE POLICY "有权限的用户可访问快照"
ON xhsphone_snapshot FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM permissions
    WHERE resource_id = xhsphone_snapshot.key
    AND resource_type = 'snapshot'
    AND user_id = auth.uid()
    AND status = 'active'
    AND (expired_at IS NULL OR expired_at > NOW())
  )
);
```

---

## API接口

### Supabase 客户端 API

#### 认证 API

```javascript
// 登录
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password'
});

// 登出
await supabase.auth.signOut();

// 获取会话
const { data: { session } } = await supabase.auth.getSession();
```

#### 数据查询 API

```javascript
// 查询快照
const { data, error } = await supabase
  .from('xhsphone_snapshot')
  .select('*')
  .eq('key', 'default')
  .maybeSingle();

// 查询用户资料
const { data, error } = await supabase
  .from('user_profiles')
  .select('*')
  .eq('user_id', userId)
  .single();

// 查询权限
const { data, error } = await supabase
  .from('permissions')
  .select('*')
  .eq('resource_id', resourceId)
  .eq('user_id', userId)
  .eq('status', 'active');
```

#### 数据修改 API

```javascript
// 插入/更新快照
const { error } = await supabase
  .from('xhsphone_snapshot')
  .upsert({
    key: 'default',
    owner_id: userId,
    payload: {...},
    updated_at: new Date().toISOString()
  });

// 插入历史快照
const { error } = await supabase
  .from('xhsphone_snapshot')
  .insert({
    key: `snap_${Date.now()}`,
    owner_id: userId,
    payload: {...}
  });

// 删除快照
const { error } = await supabase
  .from('xhsphone_snapshot')
  .delete()
  .in('key', ['snap_1', 'snap_2']);
```

---

## 关键实现细节

### 1. 数据改动检测

**实现原理：**
1. 标准化数据（排除元数据字段）
2. 排序数据（确保顺序一致）
3. JSON 序列化比较

**关键代码：**

```javascript
// 标准化行数据
const normalizeRow = (r) => ({
  phone: String(r.phone || '').trim(),
  owner: String(r.owner || '').trim(),
  // ... 其他字段
  order: String(r.order ?? 0).trim()
});

// 排序并比较
const currentRowsData = sortRows(rows);
const latestRowsData = sortRows(latestRows);
const rowsEqual = JSON.stringify(currentRowsData) === JSON.stringify(latestRowsData);
```

---

### 2. 多设备同步

**实现策略：**
1. 每次保存时创建历史快照
2. 保留最新 5 条历史快照
3. 查询时获取所有可访问的快照（RLS 自动过滤）
4. 比较时排除元数据字段（如快照名称）

---

### 3. 权限检查流程

```javascript
async function checkPermission(resourceId, resourceType, permissionType) {
  // 1. 检查是否是资源所有者
  const snapshot = await supabase
    .from(SUPABASE_TABLE)
    .select('owner_id')
    .eq('key', resourceId)
    .maybeSingle();
  
  if (snapshot?.owner_id === authUid) {
    return true; // 所有者有全部权限
  }
  
  // 2. 检查权限表
  const permission = await supabase
    .from('permissions')
    .select('*')
    .eq('resource_id', resourceId)
    .eq('user_id', authUid)
    .eq('status', 'active')
    .maybeSingle();
  
  // 3. 检查权限类型和过期时间
  // ...
}
```

---

### 4. Service Worker 更新机制

**更新流程：**
1. 修改版本号（`sw.js` 和 `index.html`）
2. Service Worker 检测到新版本
3. 显示更新提示框
4. 用户点击确认后清除缓存并刷新

**关键代码：**

```javascript
// 检测更新
async function checkForUpdate(reg) {
  await reg.update();
  const swResponse = await fetch('./sw.js?v=' + Date.now());
  const swText = await swResponse.text();
  const versionMatch = swText.match(/const VERSION = ['"]([^'"]+)['"]/);
  
  if (versionMatch[1] !== APP_VERSION) {
    showUpdateNotification();
  }
}
```

---

## 复用指南

### 1. 快速开始

#### 步骤 1：克隆项目结构

```bash
# 创建项目目录
mkdir my-project
cd my-project

# 复制核心文件
cp -r js/ css/ icon/ .
cp index.html login.html site.webmanifest sw.js .
```

#### 步骤 2：配置 Supabase

1. 创建 Supabase 项目
2. 创建数据库表（参考"数据库结构"章节）
3. 配置 RLS 策略
4. 更新配置：

```javascript
// js/config.js 或 index.html
localStorage.setItem("xhs_supabase_url", "your-url");
localStorage.setItem("xhs_supabase_anon_key", "your-key");
```

#### 步骤 3：自定义数据模型

修改 `js/app.js` 中的数据模型：

```javascript
// 修改数据库结构
db.version(1).stores({
  rows: "id,field1,field2,field3" // 你的字段
});

// 修改默认视图
const DEFAULT_VIEW = {
  // 你的视图配置
};
```

---

### 2. 功能模块复用

#### 复用数据管理模块

```javascript
// 1. 复制 IndexedDB 初始化代码
const db = new Dexie(DB_NAME);
db.version(1).stores({...});

// 2. 复制 CRUD 函数
async function getAllRows() {...}
async function addRow(row) {...}
async function updateRow(id, patch) {...}
async function deleteRowById(id) {...}

// 3. 复制筛选函数
function applyFilters(rows) {...}
```

#### 复用云端同步模块

```javascript
// 1. 复制 Supabase 初始化
async function initSupabase() {...}

// 2. 复制快照保存/加载
async function cloudSave() {...}
async function cloudLoad(key) {...}

// 3. 复制数据比较逻辑
function compareData(current, latest) {...}
```

#### 复用权限管理模块

```javascript
// 1. 复制权限检查函数
async function checkPermission(resourceId, resourceType, permissionType) {...}

// 2. 复制用户认证逻辑
// 3. 配置权限表结构
```

#### 复用 PWA 功能

```javascript
// 1. 复制 Service Worker (sw.js)
// 2. 复制更新检测逻辑
// 3. 配置 Web App Manifest
```

---

### 3. 自定义配置

#### 修改应用名称和主题

```javascript
// site.webmanifest
{
  "name": "你的应用名称",
  "short_name": "短名称",
  "theme_color": "#你的主题色"
}

// index.html
<meta name="theme-color" content="#你的主题色" />
```

#### 修改数据字段

```javascript
// 1. 修改数据库结构
db.version(1).stores({
  rows: "id,your_field1,your_field2"
});

// 2. 修改表格渲染
function makeRowTr(r) {
  return `<tr>
    <td>${r.your_field1}</td>
    <td>${r.your_field2}</td>
  </tr>`;
}

// 3. 修改筛选逻辑
function applyFilters(rows) {
  // 你的筛选逻辑
}
```

---

### 4. 扩展功能

#### 添加新功能模块

1. **创建新页面**：`new-feature.html`
2. **添加路由**：在 `admin.html` 或主页面添加导航
3. **实现功能逻辑**：在 `js/app.js` 或新建模块文件

#### 添加新的数据表

```javascript
// 扩展数据库
db.version(2).stores({
  rows: "...",
  new_table: "id,field1,field2" // 新表
});
```

#### 添加新的 API 接口

```javascript
// 在 Supabase 中创建新表
// 在代码中添加对应的查询/修改函数
```

---

### 5. 部署指南

#### 静态文件部署

1. **GitHub Pages**
   ```bash
   git push origin main
   # 在 GitHub 设置中启用 Pages
   ```

2. **Netlify / Vercel**
   - 连接 GitHub 仓库
   - 自动部署

3. **自建服务器**
   ```bash
   # 使用 Nginx
   server {
     listen 80;
     root /path/to/your/project;
     index index.html;
   }
   ```

#### 环境配置

- **开发环境**：本地文件服务器
- **生产环境**：HTTPS（PWA 要求）

---

### 6. 最佳实践

#### 代码组织

- ✅ 使用 ES 模块拆分代码
- ✅ 配置、工具、业务逻辑分离
- ✅ 统一的错误处理

#### 性能优化

- ✅ 使用 Service Worker 缓存
- ✅ 懒加载非关键资源
- ✅ 优化 IndexedDB 查询

#### 安全考虑

- ✅ 使用 RLS 策略保护数据
- ✅ 验证用户输入
- ✅ 防止 XSS 攻击（使用 `escapeHtml`）

#### 用户体验

- ✅ 离线优先设计
- ✅ 清晰的错误提示
- ✅ 加载状态指示
- ✅ 响应式设计

---

## 总结

本系统提供了一个完整的 **离线优先 + 云端同步** 的数据管理解决方案，包含：

- ✅ **完整的数据管理**：CRUD、筛选、搜索
- ✅ **云端同步**：快照系统、版本控制
- ✅ **权限管理**：RBAC + 资源级权限
- ✅ **PWA 支持**：离线访问、自动更新
- ✅ **响应式设计**：桌面 + 移动端

所有功能模块都可以独立复用，根据实际需求进行定制和扩展。

---

## 附录

### A. 依赖库 CDN

```html
<!-- Dexie.js -->
<script src="https://cdn.jsdelivr.net/npm/dexie@4.0.8/dist/dexie.min.js"></script>

<!-- Supabase -->
<script type="module">
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
</script>
```

### B. 浏览器兼容性

- ✅ Chrome/Edge: 完全支持
- ✅ Firefox: 完全支持
- ✅ Safari: 完全支持（iOS 11.3+）
- ✅ 移动浏览器: 完全支持

### C. 相关文档

- [Dexie.js 文档](https://dexie.org/)
- [Supabase 文档](https://supabase.com/docs)
- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Web App Manifest](https://developer.mozilla.org/en-US/docs/Web/Manifest)

---

**文档版本**: 1.0  
**最后更新**: 2025-12-13  
**维护者**: 开发团队
