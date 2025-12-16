#!/usr/bin/env node

/**
 * 快速更新版本号脚本
 * 
 * 使用方法：
 * 1. 在终端运行：node update-version.js
 * 2. 或者直接运行：node update-version.js 20250115.2
 * 
 * 功能：
 * - 自动更新 sw.js 中的 VERSION
 * - 自动更新 index.html 中的 APP_VERSION
 * - 自动更新 site.webmanifest 中的 version 和 start_url
 * - 自动更新 index.html 中的 CSS 版本号
 */

const fs = require('fs');
const path = require('path');

// 获取新版本号（从命令行参数或自动生成）
function getNewVersion() {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    return args[0];
  }
  
  // 自动生成：当前日期 + .1
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}.1`;
}

const newVersion = getNewVersion();
console.log(`🔄 开始更新版本号到: ${newVersion}\n`);

// 1. 更新 sw.js
const swPath = path.join(__dirname, 'sw.js');
if (fs.existsSync(swPath)) {
  let swContent = fs.readFileSync(swPath, 'utf8');
  swContent = swContent.replace(
    /const VERSION = ['"](.*?)['"];/,
    `const VERSION = '${newVersion}';`
  );
  fs.writeFileSync(swPath, swContent, 'utf8');
  console.log('✅ 已更新 sw.js');
} else {
  console.log('⚠️  sw.js 不存在');
}

// 2. 更新 index.html
const htmlPath = path.join(__dirname, 'index.html');
if (fs.existsSync(htmlPath)) {
  let htmlContent = fs.readFileSync(htmlPath, 'utf8');
  
  // 更新 APP_VERSION
  htmlContent = htmlContent.replace(
    /const APP_VERSION = ['"](.*?)['"];/,
    `const APP_VERSION = '${newVersion}';`
  );
  
  // 更新 CSS 版本号（提取日期部分）
  const datePart = newVersion.split('.')[0];
  htmlContent = htmlContent.replace(
    /href="\.\/css\/style\.css\?v=(\d+)"/,
    `href="./css/style.css?v=${datePart}"`
  );
  
  fs.writeFileSync(htmlPath, htmlContent, 'utf8');
  console.log('✅ 已更新 index.html');
} else {
  console.log('⚠️  index.html 不存在');
}

// 3. 更新 site.webmanifest
const manifestPath = path.join(__dirname, 'site.webmanifest');
if (fs.existsSync(manifestPath)) {
  let manifestContent = fs.readFileSync(manifestPath, 'utf8');
  
  // 更新 version
  manifestContent = manifestContent.replace(
    /"version":\s*["'](.*?)["']/,
    `"version": "${newVersion}"`
  );
  
  // 更新 start_url 中的版本号
  const datePart = newVersion.split('.')[0];
  manifestContent = manifestContent.replace(
    /"start_url":\s*["']\.\/index\.html\?v=(\d+)["']/,
    `"start_url": "./index.html?v=${datePart}"`
  );
  
  fs.writeFileSync(manifestPath, manifestContent, 'utf8');
  console.log('✅ 已更新 site.webmanifest');
} else {
  console.log('⚠️  site.webmanifest 不存在');
}

console.log(`\n🎉 版本号更新完成！新版本: ${newVersion}`);
console.log('\n📝 下一步：');
console.log('   1. 提交代码到服务器');
console.log('   2. 用户打开 App 时会自动检测到新版本');
console.log('   3. 用户点击"立即更新"即可更新到最新版本\n');
