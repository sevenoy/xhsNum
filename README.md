# xhsphone 云同步（安全版）

## 文件
- `index.html`：前端页面（密码门、移动端优化、云同步按钮、连接状态灯、访问密钥头）
- `worker.js`：Cloudflare Worker（Origin 白名单 + `X-Access-Key` 校验）

## 使用步骤
1. GitHub 仓库里创建数据文件：`data/rows.json`，初始内容：`{"rows":[],"cats":[],"view":{},"ver":1,"updated_at":""}`
2. Cloudflare → Workers → 选择你的 Worker → **Quick Edit**，贴入 `worker.js` → **Save and Deploy**。
3. Worker → **Settings → Variables** 添加：
   - `GH_TOKEN`: 你的 GitHub PAT（repo）
   - `GH_REPO`: sevenoy/xhsphone
   - `GH_PATH`: data/rows.json
   - `GH_BRANCH`: main
   - `ACCESS_KEY`: 自定义一串长随机字符串（前端也要相同值）
4. 打开 `index.html`，把顶部脚本里的：
   ```js
   const WORKER_URL = 'https://xhsphone-sync.sevenoy.workers.dev';
   const ACCESS_KEY  = 'SET_A_LONG_RANDOM_KEY';
   ```
   改成你的真实地址与密钥，然后把 `index.html` 上传到 GitHub Pages 根目录。

## 使用
- 导入 CSV → 编辑 → 「保存到云端」
- 另一台设备打开 → 「从云端加载」
- 「导出 CSV」仅在本地生成，不会上云
- 顶部状态灯：绿色=已连接/已同步；红色=离线/失败