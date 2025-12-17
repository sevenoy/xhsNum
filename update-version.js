#!/usr/bin/env node

/**
 * 快速更新版本号脚本
 * 
 * 版本号规则：V + 当天日期 + . + 总更新次数（累计，不按天重置）
 * 
 * 使用方法：
 * 1. 自动计算：node update-version.js（推荐）
 * 2. 手动指定：node update-version.js V251217.37
 * 
 * 功能：
 * - 自动统计 update-log.json 中所有版本的总数
 * - 自动计算新的总更新次数（总数 + 1）
 * - 自动更新 sw.js 中的 VERSION
 * - 自动更新 index.html 中的 APP_VERSION
 * - 自动更新 site.webmanifest 中的 version 和 start_url
 * - 自动更新 index.html 中的 CSS 版本号
 */

const fs = require('fs');
const path = require('path');

// 统计 update-log.json 中的总版本数
function countTotalVersions() {
  const logPath = path.join(__dirname, 'update-log.json');
  if (!fs.existsSync(logPath)) {
    console.log('⚠️  update-log.json 不存在，总版本数设为 0');
    return 0;
  }
  
  try {
    const logContent = fs.readFileSync(logPath, 'utf8');
    // 统计所有版本号格式：V251216.10 或 20251212.8
    const versionPattern = /"(V\d{6}\.\d+|202\d{5}\.\d+)"/g;
    const matches = logContent.match(versionPattern);
    const totalCount = matches ? matches.length : 0;
    console.log(`📊 统计到 ${totalCount} 个历史版本`);
    return totalCount;
  } catch (err) {
    console.error('❌ 读取 update-log.json 失败:', err);
    return 0;
  }
}

// 获取新版本号（从命令行参数或自动生成）
function getNewVersion() {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    return args[0];
  }
  
  // 自动生成：当前日期 + .总更新次数
  const now = new Date();
  const year = String(now.getFullYear()).slice(-2); // 后2位年份
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateStr = `${year}${month}${day}`;
  
  // 统计总版本数
  const totalVersions = countTotalVersions();
  const newVersionNumber = totalVersions + 1;
  
  return `V${dateStr}.${newVersionNumber}`;
}

const newVersion = getNewVersion();
console.log(`🔄 开始更新版本号到: ${newVersion}\n`);

// 1. 更新 sw.js
const swPath = path.join(__dirname, 'sw.js');
if (fs.existsSync(swPath)) {
  let swContent = fs.readFileSync(swPath, 'utf8');
  // 匹配所有 VERSION 定义（可能有多个）
  swContent = swContent.replace(
    /const VERSION = ['"](.*?)['"];/g,
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
  const datePart = newVersion.replace(/^V/, '').split('.')[0];
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
  const datePart = newVersion.replace(/^V/, '').split('.')[0];
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
console.log('   1. 更新 update-log.json 添加新版本条目');
console.log('   2. 提交代码到 GitHub');
console.log('   3. 用户打开 App 时会自动检测到新版本\n');
