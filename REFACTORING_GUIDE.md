# 代码重构指南

## 已完成的工作

### ✅ 已创建的模块文件

1. **js/config.js** - 配置和常量模块
   - 包含所有配置常量（VIEW_KEY, CATS_KEY, DB_NAME等）
   - 包含默认视图和分类配置
   - 包含 Supabase 配置初始化函数

2. **js/utils.js** - 工具函数模块
   - DOM选择器 `$`
   - 时间格式化 `fmtTime`
   - 唯一ID生成 `uid`
   - HTML转义/反转义 `escapeHtml`, `unescapeHtml`
   - 颜色转换 `hexToRgba`
   - 文本截断 `truncateText`
   - 搜索工具函数 `tokenize`, `matchDigitsSubstr`

3. **js/data.js** - 数据操作模块
   - IndexedDB 数据库初始化和操作
   - 视图配置读写（readView, saveView, applyView）
   - 分类配置读写（readCats, saveCats, catNameOf, catColorOf）
   - 数据行操作（getAllRows, updateRow, deleteRowById, moveRow, addRow等）

4. **js/auth.js** - 认证和权限模块
   - Supabase 客户端管理
   - 用户信息获取（getCurrentUserId, getCurrentUserName, getCurrentUserEmail）
   - 权限检查（checkPermission, isAdmin）

5. **js/sync.js** - 云端同步模块（基础结构）
   - 云端健康检查
   - 接口定义（需要从 app.js 提取完整实现）

## 待完成的工作

### 1. 完善 sync.js 模块

需要从 `app.js` 中提取以下函数到 `sync.js`：

- **cloudSave** (1416-1815行)
  - 数据比较逻辑
  - 快照保存逻辑
  - 历史快照管理

- **cloudLoad** (1817-1947行)
  - 权限检查
  - 数据加载逻辑
  - 分类和视图同步

- **renderCloudHistory** (1949-2073行)
  - 历史快照列表渲染
  - 点击事件处理

### 2. 创建 ui.js 模块

需要从 `app.js` 中提取以下UI相关函数：

- **渲染函数**：
  - `renderTable()` (1050-1078行)
  - `renderMobileList()` (1080-1192行)
  - `makeRowTr()` (1025-1048行)
  - `renderCatList()` (2079-2209行)

- **事件处理函数**：
  - `bindEvents()` (2215-2877行) - 需要重构为事件委托模式
  - `showAddNumberModal()` (482-661行)
  - `saveMobileCardEdit()` (1199-1277行)
  - `cancelMobileCardEdit()` (1280-1297行)
  - `showMobileToast()` (1300-1344行)

- **筛选和搜索函数**：
  - `refreshFilters()` (739-807行)
  - `applySearchFilter()` (821-860行)
  - `applyFilters()` (862-988行)

### 3. 重构 app.js

#### 3.1 删除冗余代码

**位置：app.js 第104-124行**
```javascript
// ❌ 删除：重复的数据库连接检查
let dbReady = false;
db.open().then(() => {
  dbReady = true;
  console.log('✅ IndexedDB 数据库连接已就绪');
}).catch((err) => {
  console.error('❌ IndexedDB 数据库连接失败:', err);
  dbReady = true;
});
```

**保留：** 只保留 `dbReadyPromise`（第106-113行）

#### 3.2 使用模块导入

在 `app.js` 开头添加：
```javascript
// 导入配置
import { 
  VIEW_KEY, CATS_KEY, DB_NAME, 
  SUPABASE_TABLE, SUPABASE_DEFAULT_KEY,
  DEFAULT_VIEW, DEFAULT_CATS,
  initSupabaseConfig, getSupabaseConfig 
} from './config.js';

// 导入工具函数
import { 
  $, fmtTime, uid, escapeHtml, unescapeHtml, 
  hexToRgba, truncateText, tokenize, matchDigitsSubstr 
} from './utils.js';

// 导入数据操作
import {
  ensureDbReady, getDb, getAllRows, updateRow, deleteRowById,
  moveRow, addRow, bulkAddRows, clearAllRows, bulkDeleteRows,
  readView, saveView, applyView,
  readCats, saveCats, catNameOf, catColorOf
} from './data.js';

// 导入认证
import {
  setSupabaseClient, getSupabaseClient,
  getCurrentUserId, getCurrentUserName, getCurrentUserEmail,
  checkPermission, isAdmin
} from './auth.js';

// 导入云端同步
import {
  setSupabaseClient as setSyncSupabaseClient,
  cloudHealthCheck, cloudSave, cloudLoad, renderCloudHistory
} from './sync.js';
```

#### 3.3 初始化模块

在 `app.js` 的初始化部分：
```javascript
// 初始化配置
initSupabaseConfig();
const { SUPABASE_URL, SUPABASE_ANON_KEY } = getSupabaseConfig();

// 初始化 Supabase
async function initSupabase() {
  const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  if (!hasSupabase) {
    console.warn('⚠️ Supabase 配置缺失，跳过初始化');
    return;
  }

  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    
    // 设置到各个模块
    setSupabaseClient(client);
    setSyncSupabaseClient(client);
    
    await cloudHealthCheck();
    console.log('✅ Supabase 连接已建立');
  } catch (err) {
    console.error("❌ Supabase 初始化失败：", err);
  }
}
```

### 4. 优化事件绑定

#### 4.1 统一使用事件委托

**当前问题：** `bindEvents()` 函数中有大量重复的事件绑定代码

**优化方案：**

1. **桌面端表格事件** - 已使用事件委托（✅ 已完成）
   - `gridBody.addEventListener("focus")` - 事件委托
   - `gridBody.addEventListener("blur")` - 事件委托
   - `gridBody.addEventListener("change")` - 事件委托
   - `gridBody.addEventListener("click")` - 事件委托

2. **移动端列表事件** - 已使用事件委托（✅ 已完成）
   - `mobileList.addEventListener("click")` - 事件委托
   - `mobileList.addEventListener("input")` - 事件委托
   - `mobileList.addEventListener("change")` - 事件委托

3. **工具栏按钮事件** - 需要优化
   - 当前：每个按钮单独绑定事件
   - 优化：使用事件委托，通过 `data-function` 属性识别

**示例优化：**
```javascript
// ❌ 旧方式：单独绑定
$("#btnAdd").addEventListener("click", async () => {
  await addRow();
});

$("#btnSaveCloud").addEventListener("click", async () => {
  await cloudSave();
});

// ✅ 新方式：事件委托
document.querySelector('.toolbar').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-function]');
  if (!btn) return;
  
  const functionName = btn.getAttribute('data-function');
  
  switch (functionName) {
    case 'add':
      await addRow();
      break;
    case 'saveCloud':
      await cloudSave();
      break;
    // ... 其他功能
  }
});
```

### 5. 合并重复的筛选逻辑

**位置：** `applyFilters()` 函数中有重复的排序逻辑

**优化方案：** 提取公共排序函数

```javascript
// 提取公共排序逻辑
function sortByOrder(a, b, sortBy) {
  if (sortBy === "order") {
    const aOrder = a.order ?? 0;
    const bOrder = b.order ?? 0;
    if (aOrder === 0 && bOrder !== 0) return -1;
    if (aOrder !== 0 && bOrder === 0) return 1;
    if (aOrder === 0 && bOrder === 0) {
      return (a.created_at || 0) - (b.created_at || 0);
    }
    return aOrder - bOrder;
  }
  return 0;
}
```

## 实施步骤

### 阶段一：基础模块（✅ 已完成）
- [x] 创建 config.js
- [x] 创建 utils.js
- [x] 创建 data.js
- [x] 创建 auth.js
- [x] 创建 sync.js（基础结构）

### 阶段二：完善模块（进行中）
- [ ] 完善 sync.js（提取完整实现）
- [ ] 创建 ui.js（提取UI相关函数）
- [ ] 创建 filter.js（提取筛选逻辑）

### 阶段三：重构主文件
- [ ] 重构 app.js（使用模块导入）
- [ ] 删除冗余代码
- [ ] 优化事件绑定

### 阶段四：测试验证
- [ ] 功能测试
- [ ] 性能测试
- [ ] 兼容性测试

## 注意事项

1. **保持向后兼容**：重构过程中确保功能不受影响
2. **逐步迁移**：可以分阶段进行，不需要一次性完成
3. **测试充分**：每个模块提取后都要进行测试
4. **文档更新**：更新相关技术文档

## 文件大小对比

- **原始 app.js**: ~3103 行
- **目标 app.js**: ~500-800 行（主逻辑）
- **模块文件**:
  - config.js: ~80 行
  - utils.js: ~80 行
  - data.js: ~250 行
  - auth.js: ~150 行
  - sync.js: ~400 行（预计）
  - ui.js: ~800 行（预计）
  - filter.js: ~200 行（预计）

总计：约 2000 行（模块化后更易维护）
