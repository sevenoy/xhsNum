// sync.js - 云端同步模块

import { SUPABASE_TABLE, SUPABASE_DEFAULT_KEY } from './config.js';
import { checkPermission, isAdmin, getCurrentUserId, getCurrentUserName } from './auth.js';
import { getAllRows, readCats, saveCats, readView, saveView, clearAllRows, bulkAddRows } from './data.js';
import { escapeHtml, fmtTime } from './utils.js';
import { $ } from './utils.js';

// Supabase 客户端（需要从外部初始化）
let supabase = null;

/**
 * 初始化 Supabase 客户端
 */
export function setSupabaseClient(client) {
  supabase = client;
}

/**
 * 云端健康检查
 */
export async function cloudHealthCheck() {
  const dot = $("#cloudDot");
  const text = $("#cloudText");
  if (!supabase) {
    if (dot) dot.style.background = "#999";
    if (text) text.textContent = "未链接";
    console.warn('⚠️ Supabase 客户端未初始化');
    return;
  }
  try {
    console.log('🔍 开始 Supabase 健康检查...', {
      table: SUPABASE_TABLE,
      key: SUPABASE_DEFAULT_KEY
    });
    
    const { data, error } = await supabase
      .from(SUPABASE_TABLE)
      .select("updated_at")
      .eq("key", SUPABASE_DEFAULT_KEY)
      .maybeSingle();
    
    if (error) {
      console.error('❌ Supabase 健康检查失败:', error);
      throw error;
    }
    
    console.log('✅ Supabase 健康检查成功', { data });
    if (dot) dot.style.background = "#30d158";
    if (text) text.textContent = "已链接";
  } catch (e) {
    console.error('❌ Supabase 连接错误:', e);
    if (dot) dot.style.background = "#999";
    if (text) {
      // 显示更详细的错误信息
      if (e.message) {
        text.textContent = `未链接: ${e.message.substring(0, 20)}`;
      } else {
        text.textContent = "未链接";
      }
    }
  }
}

/**
 * 保存到云端
 * 注意：这是一个简化版本，完整实现需要从 app.js 中提取 cloudSave 函数
 */
export async function cloudSave() {
  // TODO: 从 app.js 的 cloudSave 函数（1416-1815行）提取完整实现
  // 这里只提供接口定义
  console.warn('cloudSave 需要从 app.js 中提取完整实现');
}

/**
 * 从云端加载
 * 注意：这是一个简化版本，完整实现需要从 app.js 中提取 cloudLoad 函数
 */
export async function cloudLoad(key = SUPABASE_DEFAULT_KEY) {
  // TODO: 从 app.js 的 cloudLoad 函数（1817-1947行）提取完整实现
  // 这里只提供接口定义
  console.warn('cloudLoad 需要从 app.js 中提取完整实现');
}

/**
 * 渲染云端历史
 * 注意：这是一个简化版本，完整实现需要从 app.js 中提取 renderCloudHistory 函数
 */
export async function renderCloudHistory(maxCount = 3) {
  // TODO: 从 app.js 的 renderCloudHistory 函数（1949-2073行）提取完整实现
  // 这里只提供接口定义
  console.warn('renderCloudHistory 需要从 app.js 中提取完整实现');
}
