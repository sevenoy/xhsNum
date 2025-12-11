# 小红书账号管理系统 (XHSPHONE)

一个基于 Web 的小红书账号管理系统，支持多用户协作、数据云端同步、快照管理等功能。

## ✨ 主要功能

- 📱 **号码管理** - 管理小红书账号信息（电话号码、所属人、微信实名、小红书名称等）
- 👥 **多用户协作** - 支持多用户登录和权限管理
- ☁️ **云端同步** - 数据自动同步到 Supabase 云端
- 📸 **快照管理** - 保存和恢复数据快照，支持版本回溯
- 📊 **最近修改** - 查看所有快照保存历史和修改记录
- 🎨 **显示设置** - 自定义界面样式（颜色、字体、尺寸等）
- 📱 **响应式设计** - 完美适配手机端和桌面端

## 🚀 快速开始

1. 克隆仓库
```bash
git clone https://github.com/sevenoy/xhsNum.git
cd xhsNum
```

2. 配置 Supabase
   - 在 `js/app.js` 中配置你的 Supabase 项目 URL 和 API Key

3. 部署
   - 将文件部署到任何静态网站托管服务（如 GitHub Pages、Vercel、Netlify 等）

## 📱 iOS Web App 使用

1. 在 Safari 中打开网站
2. 点击分享按钮（底部中间）
3. 选择"添加到主屏幕"
4. 输入名称并添加

详细更新指南请查看 [UPDATE_GUIDE.md](./UPDATE_GUIDE.md)

## 🔧 工具页面

- **显示设置** - `view-settings.html` - 自定义界面显示样式
- **强制清除缓存** - `force-clear-cache.html` - 清除缓存和 Service Worker
- **管理中心** - `admin.html` - 用户管理、权限管理、快照浏览器等

## 📚 文档

- [技术说明文档](./TECHNICAL_DOCUMENTATION.md) - **技术架构、核心功能模块和可复用组件详解** ⭐
- [更新日志](./CHANGELOG.md) - 详细的更新历史记录
- [更新指南](./UPDATE_GUIDE.md) - iOS Web App 自动更新指南
- [强制刷新指南](./FORCE_REFRESH.md) - 缓存刷新方法
- [最近改动列表](./RECENT_CHANGES.md) - 代码提交历史

## 🛠️ 技术栈

- **前端**: HTML5, CSS3, JavaScript (ES6+)
- **存储**: IndexedDB (本地), Supabase (云端)
- **PWA**: Service Worker, Web App Manifest
- **图标**: 多尺寸图标支持，适配各种设备

## 📝 版本信息

- **当前版本**: 20250115.4
- **Service Worker 版本**: 20250115.4
- **Manifest 版本**: 20250115.4

## 🔄 更新机制

系统使用 Service Worker 实现自动更新机制：
- 每次更新代码时，修改 `sw.js`、`index.html` 和 `site.webmanifest` 中的版本号
- 用户打开 App 时自动检测新版本
- 发现新版本时自动弹出更新提示

详细说明请查看 [UPDATE_GUIDE.md](./UPDATE_GUIDE.md)

## 📄 许可证

本项目为私有项目。

## 👤 作者

sevenoy

## 🔗 相关链接

- GitHub: https://github.com/sevenoy/xhsNum
