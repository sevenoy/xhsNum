// auth.js - 认证和权限模块

import { SUPABASE_TABLE } from './config.js';

// Supabase 客户端（需要从外部初始化）
let supabase = null;

/**
 * 初始化 Supabase 客户端
 */
export function setSupabaseClient(client) {
  supabase = client;
}

/**
 * 获取 Supabase 客户端
 */
export function getSupabaseClient() {
  return supabase;
}

/**
 * 获取当前用户ID
 */
export async function getCurrentUserId() {
  if (!supabase) {
    console.warn('⚠️ Supabase 未初始化，返回 null');
    return null;
  }

  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.error('获取 Supabase 会话失败:', error);
      return null;
    }
    const uid = session?.user?.id || null;
    if (!uid) {
      console.error('⚠️ 当前没有登录用户');
    }
    return uid;
  } catch (error) {
    console.error('获取 Supabase 会话异常:', error);
    return null;
  }
}

/**
 * 获取当前用户名
 */
export function getCurrentUserName() {
  return window.currentUser?.name || localStorage.getItem('xhs_user_name') || '匿名用户';
}

/**
 * 获取当前用户邮箱
 */
export function getCurrentUserEmail() {
  return window.currentUser?.email || localStorage.getItem('xhs_user_email') || '';
}

/**
 * 检查是否是管理员
 */
export function isAdmin() {
  return window.isAdmin || localStorage.getItem('xhs_is_admin') === 'true';
}

/**
 * 检查用户是否有权限访问资源
 * @param {string} resourceId - 资源ID
 * @param {string} resourceType - 资源类型（如 'snapshot'）
 * @param {string} permissionType - 权限类型（'view' 或 'edit'）
 * @returns {Promise<boolean>} 是否有权限
 */
export async function checkPermission(resourceId, resourceType, permissionType = 'view') {
  if (!supabase) {
    console.warn('⚠️ Supabase 未初始化，跳过权限检查');
    return false;
  }

  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.error('❌ 获取 Supabase 会话失败:', error);
      return false;
    }

    const authUid = session?.user?.id;
    if (!authUid) {
      console.error('❌ 当前没有登录用户，无法执行权限检查');
      return false;
    }

    console.log('🔍 权限检查:', { resourceId, resourceType, permissionType, authUid });

    // 检查是否是资源所有者
    if (resourceType === 'snapshot') {
      const { data: snapshot, error: snapshotError } = await supabase
        .from(SUPABASE_TABLE)
        .select('owner_id')
        .eq('key', resourceId)
        .maybeSingle();

      if (snapshotError) {
        console.error('❌ 查询快照所有者失败:', snapshotError);
        return false;
      }

      if (snapshot?.owner_id === authUid) {
        console.log('✅ 当前用户是资源所有者');
        return true;
      }
    }

    // 检查权限表
    const { data: permission, error: permError } = await supabase
      .from('permissions')
      .select('*')
      .eq('resource_id', resourceId)
      .eq('resource_type', resourceType)
      .eq('user_id', authUid)
      .eq('status', 'active')
      .maybeSingle();

    if (permError) {
      console.error('❌ 查询权限记录失败:', permError);
      return false;
    }

    if (!permission) {
      console.log('❌ 未找到权限记录', { resourceId, resourceType, authUid });
      return false;
    }

    // 检查权限是否过期
    if (permission.expired_at && new Date(permission.expired_at) < new Date()) {
      console.warn('⚠️ 权限记录已过期，自动标记为 expired');
      await supabase
        .from('permissions')
        .update({ status: 'expired' })
        .eq('id', permission.id);
      return false;
    }

    // 检查权限类型
    if (permissionType === 'edit') {
      const hasEdit = permission.permission_type === 'edit';
      console.log('✅ 编辑权限检查:', hasEdit);
      return hasEdit;
    }

    const hasView = permission.permission_type === 'view' || permission.permission_type === 'edit';
    console.log('✅ 查看权限检查:', hasView);
    return hasView;
  } catch (err) {
    console.error('❌ 权限检查失败:', err);
    return false;
  }
}
