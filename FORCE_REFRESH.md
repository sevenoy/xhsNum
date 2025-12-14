# 🔄 强制刷新缓存指南

如果本地浏览没有看到样式改变，请按以下步骤操作：

## 方法 1：浏览器强制刷新（推荐）

### Chrome/Edge/Safari
1. 按 `Cmd + Shift + R` (Mac) 或 `Ctrl + Shift + R` (Windows)
2. 或者按 `F12` 打开开发者工具，然后右键点击刷新按钮，选择"清空缓存并硬性重新加载"

### 移动端 Safari (iOS)
1. 长按刷新按钮
2. 选择"重新载入页面"

## 方法 2：清除 Service Worker 缓存

1. 打开浏览器开发者工具（F12）
2. 切换到 **Application** 标签（Chrome）或 **存储** 标签（Firefox）
3. 找到 **Service Workers** 部分
4. 点击 **Unregister** 取消注册
5. 找到 **Cache Storage** 部分
6. 删除所有缓存（右键 → Delete）
7. 刷新页面

## 方法 3：使用控制台强制更新

在浏览器控制台（F12 → Console）中执行：

```javascript
// 清除所有缓存
caches.keys().then(names => {
  names.forEach(name => caches.delete(name));
  console.log('✅ 缓存已清除');
});

// 取消注册 Service Worker
navigator.serviceWorker.getRegistrations().then(registrations => {
  registrations.forEach(reg => reg.unregister());
  console.log('✅ Service Worker 已取消注册');
});

// 重新加载页面
setTimeout(() => location.reload(true), 1000);
```

## 方法 4：禁用 Service Worker（临时）

1. 打开开发者工具（F12）
2. 切换到 **Application** 标签
3. 在左侧找到 **Service Workers**
4. 勾选 **Bypass for network**（绕过网络）
5. 刷新页面

## 验证更新

更新后，你应该看到：
- ✅ `admin.html` - iframe 自适应高度，无多余容器
- ✅ `snapshot-browser.html` - 无外层容器，统计栏直接显示
- ✅ `view-settings.html` - 无外层容器，设置项直接显示
- ✅ `recent-changes.html` - 无外层容器，统计卡片直接显示

所有页面的 `body` 背景应该是 `transparent`（透明），而不是 `#f5f5f7`。

## 当前版本

- Service Worker 版本：`20250115.4`
- Manifest 版本：`20250115.4`

如果以上方法都不行，请检查文件是否已正确保存。

