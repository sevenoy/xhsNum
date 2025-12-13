# 多设备数据冲突解决方案

## 问题描述

**场景：**
1. 安卓1手机：增加了新数据1，保存云端（快照号 2512131600）
2. 安卓2手机：基于旧快照，本地修改了其他数据
3. 安卓2手机：点击保存云端，检测到数据改动，保存成功
4. **问题**：安卓2手机用自己的旧数据（没有新数据1）覆盖了云端快照，导致新数据1丢失

**根本原因：**
- 当前只检查"本地数据 vs 最新快照"是否不同
- 没有检查"本地数据是否基于最新快照"
- 没有检查"云端是否有更新的快照"

---

## 解决方案对比

### 方案1：保存前检查云端更新（推荐⭐⭐⭐⭐⭐）

**原理：**
- 保存前检查云端最新快照的更新时间
- 如果云端快照比本地数据新，说明有其他设备更新了
- 提示用户先加载云端数据，或自动合并

**优点：**
- ✅ 简单直接，易于实现
- ✅ 用户体验好（明确提示）
- ✅ 防止数据丢失
- ✅ 不需要额外的版本号字段

**缺点：**
- ⚠️ 需要用户手动操作（加载云端数据）
- ⚠️ 如果用户选择强制保存，仍可能覆盖

**实现复杂度：** ⭐⭐ (简单)

---

### 方案2：记录本地数据快照版本（推荐⭐⭐⭐⭐）

**原理：**
- 在本地存储中记录最后一次加载的快照时间戳
- 保存前检查云端快照是否比本地记录的时间新
- 如果新，说明有冲突，阻止保存

**优点：**
- ✅ 自动检测冲突
- ✅ 不需要用户手动检查
- ✅ 实现简单

**缺点：**
- ⚠️ 如果用户清除了本地存储，会丢失版本信息
- ⚠️ 需要额外的存储字段

**实现复杂度：** ⭐⭐ (简单)

---

### 方案3：乐观锁机制（推荐⭐⭐⭐⭐⭐）

**原理：**
- 在快照中保存版本号（每次保存递增）
- 保存时检查版本号是否匹配
- 如果不匹配，说明有冲突，阻止保存并提示

**优点：**
- ✅ 最可靠的冲突检测
- ✅ 标准做法（类似数据库乐观锁）
- ✅ 可以显示冲突详情

**缺点：**
- ⚠️ 需要修改快照结构（添加版本号字段）
- ⚠️ 实现稍复杂

**实现复杂度：** ⭐⭐⭐ (中等)

---

### 方案4：数据合并策略（推荐⭐⭐⭐）

**原理：**
- 检测到冲突时，自动合并数据
- 或显示冲突列表让用户选择保留哪些数据

**优点：**
- ✅ 用户体验最好（自动处理）
- ✅ 不会丢失数据

**缺点：**
- ⚠️ 合并逻辑复杂（需要处理字段级冲突）
- ⚠️ 可能产生重复数据
- ⚠️ 需要用户确认合并结果

**实现复杂度：** ⭐⭐⭐⭐ (复杂)

---

### 方案5：最后写入获胜 + 操作日志（推荐⭐⭐⭐）

**原理：**
- 允许保存（最后写入获胜）
- 但检查是否有冲突
- 如果有冲突，显示警告并记录操作日志
- 管理员可以查看日志并恢复数据

**优点：**
- ✅ 不会阻塞用户操作
- ✅ 有数据恢复机制
- ✅ 适合高并发场景

**缺点：**
- ⚠️ 仍可能丢失数据（如果用户忽略警告）
- ⚠️ 需要额外的日志系统

**实现复杂度：** ⭐⭐⭐ (中等)

---

## 推荐方案组合

### 最佳实践：方案1 + 方案2 + 方案3

**组合策略：**
1. **方案2**：记录本地快照版本（基础检查）
2. **方案1**：保存前检查云端更新（二次确认）
3. **方案3**：乐观锁机制（最终保障）

**工作流程：**
```
保存前检查：
1. 检查本地记录的快照版本
2. 查询云端最新快照
3. 比较版本号/时间戳
4. 如果有冲突：
   - 显示冲突提示
   - 提供选项：加载云端数据 / 强制保存（警告）
5. 如果无冲突：
   - 正常保存
   - 更新本地版本记录
```

---

## 实现代码示例

### 方案1：保存前检查云端更新

```javascript
async function cloudSave() {
  // ... 现有代码 ...
  
  // ✅ 新增：保存前检查云端是否有更新
  const { data: latestCloudSnapshot } = await supabase
    .from(SUPABASE_TABLE)
    .select('updated_at, payload')
    .eq('key', SUPABASE_DEFAULT_KEY)
    .maybeSingle();
  
  // 获取本地数据的最后更新时间
  const localLastUpdate = localStorage.getItem('local_snapshot_updated_at');
  
  if (latestCloudSnapshot && localLastUpdate) {
    const cloudTime = new Date(latestCloudSnapshot.updated_at).getTime();
    const localTime = parseInt(localLastUpdate);
    
    // 如果云端快照比本地记录新，说明有其他设备更新了
    if (cloudTime > localTime) {
      const shouldLoad = confirm(
        '⚠️ 检测到云端有更新\n\n' +
        '云端快照时间：' + new Date(cloudTime).toLocaleString() + '\n' +
        '本地快照时间：' + new Date(localTime).toLocaleString() + '\n\n' +
        '建议先加载云端数据，然后再保存。\n\n' +
        '点击【确定】加载云端数据\n' +
        '点击【取消】强制保存（可能覆盖云端数据）'
      );
      
      if (shouldLoad) {
        await cloudLoad();
        alert('✅ 已加载云端数据，请检查后再保存');
        return;
      } else {
        // 用户选择强制保存，显示警告
        const confirmForce = confirm(
          '⚠️ 警告：您确定要覆盖云端数据吗？\n\n' +
          '这将覆盖其他设备的更新，可能导致数据丢失。'
        );
        if (!confirmForce) {
          return;
        }
      }
    }
  }
  
  // 继续保存流程...
}
```

---

### 方案2：记录本地快照版本

```javascript
// 加载云端数据时记录版本
async function cloudLoad(key = SUPABASE_DEFAULT_KEY) {
  // ... 现有加载代码 ...
  
  // ✅ 新增：记录加载的快照时间戳
  if (data && data.updated_at) {
    localStorage.setItem('local_snapshot_updated_at', 
      new Date(data.updated_at).getTime().toString()
    );
    localStorage.setItem('local_snapshot_key', key);
    console.log('✅ 已记录本地快照版本:', data.updated_at);
  }
  
  // ... 其他代码 ...
}

// 保存时检查版本
async function cloudSave() {
  // ... 现有代码 ...
  
  // ✅ 检查本地记录的版本
  const localSnapshotTime = localStorage.getItem('local_snapshot_updated_at');
  const localSnapshotKey = localStorage.getItem('local_snapshot_key');
  
  if (localSnapshotTime && localSnapshotKey === SUPABASE_DEFAULT_KEY) {
    // 查询云端最新快照
    const { data: cloudSnapshot } = await supabase
      .from(SUPABASE_TABLE)
      .select('updated_at')
      .eq('key', SUPABASE_DEFAULT_KEY)
      .maybeSingle();
    
    if (cloudSnapshot) {
      const cloudTime = new Date(cloudSnapshot.updated_at).getTime();
      const localTime = parseInt(localSnapshotTime);
      
      if (cloudTime > localTime) {
        // 云端有更新，提示用户
        // ... 处理逻辑 ...
      }
    }
  }
  
  // ... 保存后更新本地版本记录 ...
  if (latestSnapshot && latestSnapshot.updated_at) {
    localStorage.setItem('local_snapshot_updated_at',
      new Date(latestSnapshot.updated_at).getTime().toString()
    );
  }
}
```

---

### 方案3：乐观锁机制

```javascript
// 修改快照结构，添加版本号
const payload = {
  ver: 1,
  version: 1,  // ✅ 新增：版本号（每次保存递增）
  snapshot_label: snapshotName,
  // ... 其他字段 ...
};

// 保存时检查版本号
async function cloudSave() {
  // ... 现有代码 ...
  
  // ✅ 查询当前快照的版本号
  const { data: currentSnapshot } = await supabase
    .from(SUPABASE_TABLE)
    .select('payload')
    .eq('key', SUPABASE_DEFAULT_KEY)
    .maybeSingle();
  
  const currentVersion = currentSnapshot?.payload?.version || 0;
  const localVersion = localStorage.getItem('local_snapshot_version') || '0';
  
  // 如果版本号不匹配，说明有冲突
  if (parseInt(localVersion) < currentVersion) {
    const shouldLoad = confirm(
      '⚠️ 检测到数据冲突\n\n' +
      '云端版本：' + currentVersion + '\n' +
      '本地版本：' + localVersion + '\n\n' +
      '云端数据已被其他设备更新，建议先加载云端数据。\n\n' +
      '点击【确定】加载云端数据\n' +
      '点击【取消】强制保存（覆盖云端数据）'
    );
    
    if (shouldLoad) {
      await cloudLoad();
      return;
    }
  }
  
  // 保存时递增版本号
  const newVersion = currentVersion + 1;
  const payload = {
    // ... 其他字段 ...
    version: newVersion
  };
  
  // ... 保存后更新本地版本 ...
  localStorage.setItem('local_snapshot_version', newVersion.toString());
}
```

---

### 方案4：数据合并策略

```javascript
// 检测并合并冲突数据
async function mergeConflictData(localData, cloudData) {
  const merged = {
    rows: [],
    cats: cloudData.cats || localData.cats,
    view: cloudData.view || localData.view
  };
  
  // 合并 rows：以云端为主，添加本地新增的数据
  const cloudRowsMap = new Map();
  cloudData.rows.forEach(row => {
    cloudRowsMap.set(row.phone || row.id, row);
  });
  
  // 添加云端数据
  cloudRowsMap.forEach(row => {
    merged.rows.push(row);
  });
  
  // 添加本地新增的数据（不在云端的数据）
  localData.rows.forEach(localRow => {
    const key = localRow.phone || localRow.id;
    if (!cloudRowsMap.has(key)) {
      merged.rows.push(localRow);
    }
  });
  
  return merged;
}

// 在保存时使用
async function cloudSave() {
  // ... 检测到冲突 ...
  
  if (hasConflict) {
    const shouldMerge = confirm(
      '检测到数据冲突，是否自动合并？\n\n' +
      '将保留云端数据和本地新增数据。'
    );
    
    if (shouldMerge) {
      const merged = await mergeConflictData(localData, cloudData);
      // 使用合并后的数据保存
      // ...
    }
  }
}
```

---

## 推荐实现方案

### 最佳组合：方案1 + 方案2

**理由：**
1. **方案2**：自动检测，无需用户手动检查
2. **方案1**：提供明确的用户提示和选择
3. 实现简单，用户体验好
4. 不需要修改数据库结构

**实现步骤：**
1. 在 `cloudLoad` 时记录快照时间戳
2. 在 `cloudSave` 时检查云端是否有更新
3. 如果有更新，提示用户选择
4. 保存后更新本地版本记录

---

## 实施建议

### 阶段1：快速修复（方案2）
- 立即实施，防止数据丢失
- 实现简单，风险低

### 阶段2：完善体验（方案1）
- 添加用户提示和选择
- 提供强制保存选项（带警告）

### 阶段3：长期优化（方案3）
- 如果需要更严格的冲突控制
- 可以添加版本号机制

---

## 注意事项

1. **本地存储清理**：如果用户清除浏览器数据，会丢失版本信息
   - 解决方案：首次保存时，如果检测不到版本信息，允许保存但显示警告

2. **时区问题**：确保时间戳使用 UTC 时间
   - 解决方案：使用 `Date.getTime()` 获取时间戳（毫秒数）

3. **网络延迟**：查询云端快照可能有延迟
   - 解决方案：添加超时处理，如果查询失败，允许保存但显示警告

4. **多设备同时保存**：仍可能出现竞态条件
   - 解决方案：使用乐观锁（方案3）或操作日志（方案5）

---

## 总结

**推荐方案：方案1 + 方案2**

- ✅ 实现简单
- ✅ 用户体验好
- ✅ 有效防止数据丢失
- ✅ 不需要修改数据库结构

**实施优先级：**
1. 🔴 **高优先级**：方案2（记录本地版本）
2. 🟡 **中优先级**：方案1（保存前检查）
3. 🟢 **低优先级**：方案3（乐观锁，可选）
