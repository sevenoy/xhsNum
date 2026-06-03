// js/sync.js
import { 
  getAllRows, readCats, readView, saveCats, saveView, 
  overwriteAllRows, clearDirty, isLocalDirty 
} from './data.js';
import { supabase, getCurrentUserName, getCurrentUserId } from './supabaseClient.js';
import { SUPABASE_DEFAULT_KEY, SUPABASE_TABLE } from './config.js';

let lastSyncTimestamp = Number(localStorage.getItem('last_sync_time') || '0');
let isAutoSyncStarted = false;
let isAutoSyncStarting = false;
let realtimeChannel = null;
let lastPromptedVersion = localStorage.getItem('last_prompted_snapshot_name') || '';
const SAVE_COOLDOWN_MS = 5000;
const AUTO_CLOUD_SAVE_DEBOUNCE_MS = 2000;
const EMPTY_AUTO_SAVE_ALLOWED_REASONS = new Set(['clear-all-confirmed']);

function nowMs() {
  return Date.now();
}

function getClientId() {
  let id = sessionStorage.getItem('xhs_client_id');
  if (!id) {
    const randomPart = Math.random().toString(36).slice(2);
    id = `xhs_${Date.now()}_${randomPart}`;
    sessionStorage.setItem('xhs_client_id', id);
  }
  return id;
}

function isCloudSaving() {
  return window.__xhsCloudSaving === true;
}

function setCloudSaving(saving) {
  window.__xhsCloudSaving = saving;
}

function setLocalDirty(dirty) {
  window.__xhsLocalDirty = dirty;
  window.__xhsLocalUnsavedChanges = dirty;
  if (dirty) {
    localStorage.setItem('xhs_last_local_change_at', String(nowMs()));
  }
}

function hasLocalDirty() {
  return window.__xhsLocalDirty === true || isLocalDirty();
}

function markLocalSynced() {
  setLocalDirty(false);
  clearDirty();
}

function startSaveCooldown() {
  window.__xhsCloudSaveCooldownUntil = nowMs() + SAVE_COOLDOWN_MS;
}

function isSaveCooldownActive() {
  return Number(window.__xhsCloudSaveCooldownUntil || 0) > nowMs();
}

function setSaveStatus(message, type = 'info', timeout = 2800) {
  const el = document.querySelector('#saveStatus');
  if (el) {
    el.textContent = message;
    el.className = `save-status show ${type}`;
    if (timeout > 0) {
      clearTimeout(setSaveStatus._timer);
      setSaveStatus._timer = setTimeout(() => {
        el.classList.remove('show');
      }, timeout);
    }
  }
  showToast(message, type, timeout);
}

function markPromptedVersion(version) {
  if (!version) return;
  lastPromptedVersion = version;
  localStorage.setItem('last_prompted_snapshot_name', version);
}

function markPromptedRow(row) {
  const version = snapshotVersionFromRow(row);
  if (version) {
    markPromptedVersion(version);
    return;
  }
  const snapshotName = row?.payload?.snapshot_label ||
    generateSnapshotName(row?.updated_by_name || '未知用户', row?.updated_at);
  markPromptedVersion(snapshotName);
}

function snapshotVersionFromRow(row) {
  if (!row) return '';
  const snapshotName = row.payload?.snapshot_label ||
    generateSnapshotName(row.updated_by_name || '未知用户', row.updated_at);
  return `${row.updated_at || ''}|${snapshotName}`;
}

function shouldBlockEmptyAutoSave(rows, source, reason) {
  return source === 'auto' &&
    (!Array.isArray(rows) || rows.length === 0) &&
    !EMPTY_AUTO_SAVE_ALLOWED_REASONS.has(reason);
}

function normalizeRowsForCompare(rowsData) {
  if (!Array.isArray(rowsData)) return [];
  return rowsData
    .map((r) => {
      if (!r) return null;
      return {
        phone: String(r.phone || '').trim(),
        owner: String(r.owner || '').trim(),
        wx_real: String(r.wx_real || '').trim(),
        wx_name: String(r.wx_name || '').trim(),
        xhs_name: String(r.xhs_name || '').trim(),
        note1: String(r.note1 || '').trim(),
        row_color: String(r.row_color || '').trim(),
        order: String(r.order ?? 0).trim()
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const phoneA = a.phone || '';
      const phoneB = b.phone || '';
      if (phoneA !== phoneB) return phoneA.localeCompare(phoneB);
      const ownerA = a.owner || '';
      const ownerB = b.owner || '';
      if (ownerA !== ownerB) return ownerA.localeCompare(ownerB);
      return (a.xhs_name || '').localeCompare(b.xhs_name || '');
    });
}

function normalizeCatsForCompare(catsData) {
  if (!Array.isArray(catsData)) return [];
  return catsData
    .map(c => ({
      id: String(c.id || '').trim(),
      name: String(c.name || '').trim(),
      color: String(c.color || '').trim()
    }))
    .sort((a, b) => (a.id || '').localeCompare(b.id || ''));
}

function normalizeViewForCompare(v) {
  if (!v) return {};
  const knownViewFields = [
    'pad', 'colScale', 'zebraOn', 'zebraColor', 'fontFamily',
    'fontWeight', 'titleText', 'titleColor', 'btnColor'
  ];
  const normalized = {};
  knownViewFields.forEach(key => {
    if (key in v) {
      const val = v[key];
      if (val === null || val === undefined) {
        normalized[key] = '';
      } else if (typeof val === 'number') {
        normalized[key] = val;
      } else {
        normalized[key] = String(val);
      }
    }
  });
  return Object.keys(normalized).sort().reduce((acc, key) => {
    acc[key] = normalized[key];
    return acc;
  }, {});
}

function normalizePlatformsForCompare(platformsData) {
  if (!Array.isArray(platformsData)) return [];
  return platformsData
    .map(platform => ({
      id: String(platform.id || '').trim(),
      name: String(platform.name || '').trim(),
      builtin: Boolean(platform.builtin)
    }))
    .filter(platform => platform.id && platform.name)
    .sort((a, b) => (a.id || '').localeCompare(b.id || ''));
}

function normalizePlatformProfilesForCompare(profilesData) {
  if (!Array.isArray(profilesData)) return [];
  return profilesData
    .map(profile => ({
      row_id: String(profile.row_id || '').trim(),
      platform_id: String(profile.platform_id || '').trim(),
      value: String(profile.value || '').trim()
    }))
    .filter(profile => profile.row_id && profile.platform_id && profile.value)
    .sort((a, b) => {
      const rowCompare = (a.row_id || '').localeCompare(b.row_id || '');
      if (rowCompare !== 0) return rowCompare;
      return (a.platform_id || '').localeCompare(b.platform_id || '');
    });
}

function shouldIgnoreOwnRealtimeEvent(row) {
  if (!row) return false;
  const meta = row.payload?.__meta || {};
  const eventClientId = meta.clientId;
  const clientId = getClientId();
  if (eventClientId && eventClientId === clientId) {
    return true;
  }

  const version = snapshotVersionFromRow(row);
  const lastSavedVersion = window.__xhsLastLocalSavedSnapshotVersion ||
    localStorage.getItem('xhs_last_local_saved_snapshot_version') ||
    '';
  if (version && lastSavedVersion && version === lastSavedVersion) {
    return true;
  }

  return false;
}

function hasUnsafeRemoteApplyState() {
  const activeElement = document.activeElement;
  const activeDataEdit = typeof window.isXhsDataEditElement === 'function'
    ? window.isXhsDataEditElement(activeElement)
    : false;
  return window.__xhsEditingDataField === true ||
    activeDataEdit ||
    window.__xhsPendingLocalFieldSave === true ||
    hasLocalDirty() ||
    isCloudSaving() ||
    window.__xhsApplyingRemote === true;
}

async function applyRemoteUpdateIfSafe(remoteUpdate, reason = 'realtime') {
  if (!remoteUpdate) return { status: 'no_pending' };
  if (hasUnsafeRemoteApplyState()) {
    window.__xhsPendingRemoteUpdate = remoteUpdate;
    setSaveStatus('检测到其他设备更新，退出编辑后自动同步', 'warning', 6000);
    return { status: 'deferred' };
  }

  window.__xhsPendingRemoteUpdate = null;
  setSaveStatus('检测到其他设备更新，正在同步', 'info', 0);
  const result = await cloudLoad({ source: 'realtime-auto', silent: true, key: SUPABASE_DEFAULT_KEY });
  if (result?.status === 'loaded' || result?.status === 'skipped_not_newer') {
    window.__xhsLastAppliedRemoteVersion = remoteUpdate.version || '';
    setSaveStatus('已同步其他设备最新修改', 'success', 3200);
  }
  return result || { status: 'loaded', reason };
}

export async function applyPendingRemoteUpdateIfSafe(reason = 'pending') {
  const pending = window.__xhsPendingRemoteUpdate;
  if (!pending) return { status: 'no_pending' };
  return applyRemoteUpdateIfSafe(pending, reason);
}

export function afterLocalRowsSaved(reason = 'local-save') {
  if (window.__xhsApplyingRemote === true) {
    console.log('⏭️ 远端数据应用中，跳过自动云端保存', { reason });
    return;
  }
  setLocalDirty(true);
  setSaveStatus('本地已保存，等待云端同步', 'warning', 2600);
  scheduleAutoCloudSave(reason);
}

export function scheduleAutoCloudSave(reason = 'local-save') {
  if (window.__xhsApplyingRemote === true) return;
  window.__xhsLastAutoCloudSaveReason = reason;

  if (isCloudSaving()) {
    window.__xhsPendingAutoCloudSave = true;
    return;
  }

  if (window.__xhsAutoCloudSaveTimer) {
    clearTimeout(window.__xhsAutoCloudSaveTimer);
  }
  window.__xhsAutoCloudSaveTimer = setTimeout(() => {
    window.__xhsAutoCloudSaveTimer = null;
    runAutoCloudSave(window.__xhsLastAutoCloudSaveReason || reason);
  }, AUTO_CLOUD_SAVE_DEBOUNCE_MS);
}

export async function runAutoCloudSave(reason = 'local-save') {
  if (window.__xhsApplyingRemote === true) return { status: 'applying_remote' };
  if (isCloudSaving()) {
    window.__xhsPendingAutoCloudSave = true;
    return { status: 'busy' };
  }

  setSaveStatus('正在自动同步云端', 'info', 0);
  const result = await cloudSave({ source: 'auto', reason });

  if (result?.status === 'saved' || result?.status === 'no_change') {
    markLocalSynced();
    setSaveStatus('已自动同步云端', 'success', 3200);
    await applyPendingRemoteUpdateIfSafe('auto-save-complete');
  } else if (result?.status === 'not_logged_in') {
    setLocalDirty(true);
    setSaveStatus('本地已保存，登录后可同步', 'warning', 4200);
  } else if (result?.status === 'blocked_empty') {
    setLocalDirty(true);
    setSaveStatus('本地为空，为避免覆盖云端，已阻止自动同步', 'warning', 5200);
  } else if (result?.status === 'cloud_newer') {
    setLocalDirty(true);
    setSaveStatus('检测到其他设备更新，点击云端加载', 'warning', 6000);
  } else if (result?.status !== 'busy') {
    setLocalDirty(true);
    setSaveStatus('自动同步失败，点击保存云端重试', 'error', 5200);
  }

  if (window.__xhsPendingAutoCloudSave === true) {
    window.__xhsPendingAutoCloudSave = false;
    scheduleAutoCloudSave(window.__xhsLastAutoCloudSaveReason || reason);
  }

  return result;
}

// 获取最后已知的快照名称（用于检测快照变化）
function getLastSnapshotName() {
  return localStorage.getItem('last_snapshot_name') || '';
}

// 保存最后已知的快照名称
function saveLastSnapshotName(name) {
  if (name) {
    localStorage.setItem('last_snapshot_name', name);
    markPromptedVersion(name);
  }
}

// 生成快照名称（用户名+日期时间格式）
function generateSnapshotName(userName, updatedAt) {
  const formatDateTime = (ts) => {
    try {
      const d = new Date(ts);
      const Y = d.getFullYear();
      const M = String(d.getMonth() + 1).padStart(2, '0');
      const D = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return `${Y}${M}${D}${h}${m}`;
    } catch {
      return '';
    }
  };
  
  const dateTimeStr = formatDateTime(updatedAt);
  return `${userName} ${dateTimeStr}`;
}

/* 1. 加载云端数据 */
export async function cloudLoad(keyOrSilent = SUPABASE_DEFAULT_KEY, silent = false) {
  // 兼容旧调用方式：如果第一个参数是 boolean，则视为 silent
  let key = SUPABASE_DEFAULT_KEY;
  let isSilent = false;
  let source = 'manual';
  let force = false;

  if (keyOrSilent && typeof keyOrSilent === 'object') {
    key = keyOrSilent.key || SUPABASE_DEFAULT_KEY;
    isSilent = Boolean(keyOrSilent.silent);
    source = keyOrSilent.source || (isSilent ? 'auto' : 'manual');
    force = Boolean(keyOrSilent.force);
  } else if (typeof keyOrSilent === 'boolean') {
    isSilent = keyOrSilent;
    key = SUPABASE_DEFAULT_KEY;
  } else if (typeof keyOrSilent === 'string') {
    key = keyOrSilent;
    isSilent = silent;
  }

  const isRealtimeAuto = source === 'realtime-auto';

  if (!supabase) {
    if(!isSilent) alert('未配置 Supabase');
    return { status: 'not_configured' };
  }

  // 如果本地有修改，必须确认覆盖
  if (!isSilent && hasLocalDirty()) {
    const ok = confirm('⚠️ 本地有未保存修改。\n\n加载云端数据将覆盖本地修改。\n\n是否继续？');
    if (!ok) return { status: 'cancelled' };
  }

  try {
    if (isRealtimeAuto) {
      window.__xhsApplyingRemote = true;
    }

    // 更新 lastSyncTimestamp（从 localStorage 重新读取，确保多标签页同步）
    const savedTime = localStorage.getItem('last_sync_time');
    if (savedTime) lastSyncTimestamp = parseInt(savedTime);
    
    console.log('🔍 开始查询云端数据', { 
      key,
      isSilent,
      force,
      currentLastSync: lastSyncTimestamp
    });
    
    // 必须倒序取最新一条（手动加载时强制从网络获取最新数据）
    const queryOptions = {
      eq: ['key', key],
      order: { column: 'updated_at', ascending: false },
      limit: 1
    };
    
    // 如果是手动加载，添加时间戳参数强制从网络获取
    const { data, error } = await supabase
      .from(SUPABASE_TABLE)
      .select('payload, updated_at, updated_by_name')
      .eq('key', key)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('❌ 查询云端数据失败:', error);
      throw error;
    }
    
    if (!data) {
      console.log('⚠️ 云端无数据');
      if (!isSilent) alert('云端无数据');
      return { status: 'no_data' };
    }
    
    const row = data;
    const serverTime = new Date(row.updated_at).getTime();
    
    console.log('📊 查询结果:', {
      serverTime,
      lastSyncTimestamp,
      serverTimeNewer: serverTime > lastSyncTimestamp,
      updatedBy: row.updated_by_name,
      rowsCount: (row.payload?.rows || []).length
    });
    
    // 如果是手动加载（非静默），总是加载，不检查时间戳
    // 只有自动同步时才检查时间戳
    if (isSilent && !force && serverTime <= lastSyncTimestamp) {
      console.log('⏭️ 云端数据不比本地新，跳过加载', {
        serverTime,
        lastSyncTimestamp,
        diff: serverTime - lastSyncTimestamp 
      });
      return { status: 'skipped_not_newer' };
    }
    
    // 手动加载时，即使时间戳相同也强制加载（确保获取最新数据）
    if (!isSilent || force) {
      console.log('📥 强制加载云端数据', {
        serverTime,
        lastSyncTimestamp,
        updatedBy: row.updated_by_name
      });
    }
    
    console.log('📥 开始加载云端数据', { 
      key,
      isSilent,
      force,
      serverTime,
      lastSyncTimestamp,
      updatedBy: row.updated_by_name 
    });

    const payload = row.payload || {};
    
    console.log('📥 准备加载数据:', {
      rowsCount: (payload.rows || []).length,
      hasCats: !!payload.cats,
      hasView: !!payload.view,
      updatedBy: row.updated_by_name
    });
    
    // 事务写入本地，防止写一半失败
    console.log('📝 开始写入数据到本地数据库...', {
      rowsCount: (payload.rows || []).length,
      firstRow: payload.rows?.[0] ? {
        phone: payload.rows[0].phone,
        xhs_name: payload.rows[0].xhs_name
      } : null,
      userAgent: navigator.userAgent
    });
    
    // iOS Safari 兼容性：添加重试机制
    let retryCount = 0;
    const maxRetries = 3;
    while (retryCount < maxRetries) {
      try {
        await overwriteAllRows(payload.rows || []);
        break; // 成功则退出循环
      } catch (writeErr) {
        retryCount++;
        console.error(`❌ 数据写入失败 (尝试 ${retryCount}/${maxRetries}):`, writeErr);
        
        if (retryCount >= maxRetries) {
          throw new Error(`数据写入失败，已重试 ${maxRetries} 次: ${writeErr.message}`);
        }
        
        // 等待一段时间后重试（iOS Safari 可能需要时间释放资源）
        await new Promise(resolve => setTimeout(resolve, 500 * retryCount));
      }
    }
    
    // 验证数据是否已写入
    const verifyRows = await getAllRows();
    console.log('✅ 数据已写入本地数据库', {
      expectedCount: (payload.rows || []).length,
      actualCount: verifyRows.length,
      firstRow: verifyRows[0] ? {
        phone: verifyRows[0].phone,
        xhs_name: verifyRows[0].xhs_name
      } : null
    });
    
    // iOS Safari 验证：如果数据条数不匹配，可能是写入失败
    if (verifyRows.length !== (payload.rows || []).length) {
      console.warn('⚠️ 数据条数不匹配，可能写入不完整', {
        expected: (payload.rows || []).length,
        actual: verifyRows.length
      });
      
      // 如果是iOS，尝试再次写入
      if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        console.log('🔄 iOS设备检测到数据不匹配，尝试重新写入...');
        try {
          await overwriteAllRows(payload.rows || []);
          const reVerifyRows = await getAllRows();
          console.log('✅ 重新写入后验证:', {
            expected: (payload.rows || []).length,
            actual: reVerifyRows.length
          });
        } catch (retryErr) {
          console.error('❌ 重新写入失败:', retryErr);
        }
      }
    }
    
    // 静默更新配置
    if (payload.cats) {
      saveCats(payload.cats, true);
      console.log('✅ 分类配置已更新');
    }
    if (payload.view) {
      saveView(payload.view, true);
      console.log('✅ 视图配置已更新');
    }
    if (typeof window.applyXhsPlatformSnapshot === 'function') {
      await window.applyXhsPlatformSnapshot({
        platforms: payload.platforms,
        platformProfiles: payload.platformProfiles
      });
      console.log('✅ 平台资料已更新', {
        platformsCount: Array.isArray(payload.platforms) ? payload.platforms.length : 0,
        platformProfilesCount: Array.isArray(payload.platformProfiles) ? payload.platformProfiles.length : 0
      });
    }

    // 更新本地时间戳（只更新一次）
    lastSyncTimestamp = serverTime;
    localStorage.setItem('last_sync_time', String(serverTime));
    
    // 更新最后已知的快照名称
    const snapshotName = payload.snapshot_label || generateSnapshotName(row.updated_by_name || '未知用户', row.updated_at);
    saveLastSnapshotName(snapshotName);
    markPromptedRow(row);
    
    console.log('✅ 已更新本地时间戳和快照名称', { 
      serverTime, 
      lastSyncTimestamp,
      rowsCount: (payload.rows || []).length,
      updatedBy: row.updated_by_name,
      snapshotName
    });

    markLocalSynced();
    
    // 强制刷新界面（确保异步完成）
    console.log('🔄 开始刷新界面...');
    if (window.renderTable) {
      try {
        await window.renderTable();
        console.log('✅ 表格已刷新');
      } catch (renderErr) {
        console.error('❌ 刷新表格失败:', renderErr);
      }
    } else {
      console.warn('⚠️ window.renderTable 不存在');
    }
    
    if (window.refreshFilters) {
      try {
        await window.refreshFilters();
        console.log('✅ 筛选器已刷新');
      } catch (filterErr) {
        console.error('❌ 刷新筛选器失败:', filterErr);
      }
    } else {
      console.warn('⚠️ window.refreshFilters 不存在');
    }
    
    // 验证数据是否已加载
    const loadedRows = await getAllRows();
    console.log('✅ 验证：本地数据条数', loadedRows.length);
    
    // 再次验证：检查第一条数据是否已更新
    if (loadedRows.length > 0 && payload.rows && payload.rows.length > 0) {
      const firstLocalRow = loadedRows.find(r => r.phone === payload.rows[0].phone);
      const firstCloudRow = payload.rows[0];
      if (firstLocalRow && firstCloudRow) {
        console.log('🔍 数据验证对比:', {
          phone: firstLocalRow.phone,
          localXhsName: firstLocalRow.xhs_name,
          cloudXhsName: firstCloudRow.xhs_name,
          match: firstLocalRow.xhs_name === firstCloudRow.xhs_name
        });
        
        if (firstLocalRow.xhs_name !== firstCloudRow.xhs_name) {
          console.warn('⚠️ 警告：数据可能未正确加载！', {
            local: firstLocalRow.xhs_name,
            cloud: firstCloudRow.xhs_name
          });
        }
      }
    }
    
    if (isSilent) {
      setSaveStatus('已同步其他设备最新修改', 'success', 3200);
    } else {
      alert('✅ 已加载云端最新数据');
    }

    return { status: 'loaded', updated_at: row.updated_at, updated_by_name: row.updated_by_name };

  } catch (err) {
    console.error(err);
    if (!isSilent) alert('加载失败: ' + (err.message || err));
    return { status: 'error', error: err };
  } finally {
    if (isRealtimeAuto) {
      window.__xhsApplyingRemote = false;
    }
  }
}

/* 2. 保存到云端 */
export async function cloudSave(options = {}) {
  const source = options?.source || 'manual';
  const reason = options?.reason || source;
  const isAuto = source === 'auto';

  if (isCloudSaving()) {
    setSaveStatus('正在保存，请稍候', 'info');
    return { status: 'busy' };
  }
  if (!supabase) {
    setSaveStatus('未配置 Supabase', 'error', 4000);
    return { status: 'not_configured' };
  }

  const btn = document.querySelector('#btnSaveCloud');
  const cleanText = btn ? (btn.dataset.cleanText || btn.textContent || '保存云端') : '保存云端';
  
  if (btn) { 
    if (!btn.dataset.cleanText) btn.dataset.cleanText = cleanText.replace(' *', '').replace('⏳ ', '');
    btn.disabled = true; 
    btn.textContent = '保存中...'; 
  }
  setCloudSaving(true);
  setSaveStatus('云端保存中', 'info', 0);

  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      if (isAuto) {
        return { status: 'not_logged_in' };
      }
      throw new Error("请先登录");
    }

    // 获取本地数据
    const rows = await getAllRows();
    const cats = readCats();
    const view = readView();
    const platformSnapshot = typeof window.getXhsPlatformSnapshot === 'function'
      ? await window.getXhsPlatformSnapshot()
      : { platforms: [], platformProfiles: [] };

    if (shouldBlockEmptyAutoSave(rows, source, reason)) {
      setSaveStatus('本地为空，为避免覆盖云端，已阻止自动同步', 'warning', 5200);
      return { status: 'blocked_empty' };
    }

    // 获取云端最新快照（检查数据库真实状态）
    const { data: cloudData } = await supabase
      .from(SUPABASE_TABLE)
      .select('payload, updated_at, updated_by_name')
      .eq('key', SUPABASE_DEFAULT_KEY)
      .order('updated_at', { ascending: false })
      .limit(1);

    const cloudRow = cloudData?.[0];
    
    // 关键：先检查数据库是否有更新（检测其他设备的改动）
    if (cloudRow) {
      const cloudTime = new Date(cloudRow.updated_at).getTime();
      // 如果云端数据比本地同步时间新，说明数据库被改动了
      if (cloudTime > lastSyncTimestamp) {
        console.log('⚠️ 检测到数据库有更新（可能是其他设备保存了）');
        // 继续比较数据内容，如果内容相同，说明只是时间戳更新了
      }
    }
    
    // 如果有云端数据，进行数据比较
    if (cloudRow && cloudRow.payload) {
      const latestRows = cloudRow.payload.rows || [];
      const latestCats = cloudRow.payload.cats || [];
      const latestView = cloudRow.payload.view || {};
      const latestPlatforms = cloudRow.payload.platforms || [];
      const latestPlatformProfiles = Array.isArray(cloudRow.payload.platformProfiles)
        ? cloudRow.payload.platformProfiles
        : null;

      const currentRowsData = normalizeRowsForCompare(rows);
      const latestRowsData = normalizeRowsForCompare(latestRows);
      
      // 添加详细调试日志
      console.log('🔍 数据比较调试:', {
        currentRowsCount: currentRowsData.length,
        latestRowsCount: latestRowsData.length,
        currentFirst3: currentRowsData.slice(0, 3).map(r => ({ phone: r.phone, xhs_name: r.xhs_name })),
        latestFirst3: latestRowsData.slice(0, 3).map(r => ({ phone: r.phone, xhs_name: r.xhs_name }))
      });
      
      const rowsEqual = JSON.stringify(currentRowsData) === JSON.stringify(latestRowsData);
      
      if (!rowsEqual) {
        // 找出不同的行
        const currentMap = new Map(currentRowsData.map(r => [r.phone, r]));
        const latestMap = new Map(latestRowsData.map(r => [r.phone, r]));
        
        const differences = [];
        latestMap.forEach((latestRow, phone) => {
          const currentRow = currentMap.get(phone);
          if (!currentRow) {
            differences.push({ phone, type: '新增', latest: latestRow });
          } else if (JSON.stringify(currentRow) !== JSON.stringify(latestRow)) {
            differences.push({ 
              phone, 
              type: '修改', 
              current: currentRow, 
              latest: latestRow,
              diff: {
                xhs_name: currentRow.xhs_name !== latestRow.xhs_name ? { current: currentRow.xhs_name, latest: latestRow.xhs_name } : null,
                wx_name: currentRow.wx_name !== latestRow.wx_name ? { current: currentRow.wx_name, latest: latestRow.wx_name } : null,
                note1: currentRow.note1 !== latestRow.note1 ? { current: currentRow.note1, latest: latestRow.note1 } : null
              }
            });
          }
        });
        
        currentMap.forEach((currentRow, phone) => {
          if (!latestMap.has(phone)) {
            differences.push({ phone, type: '删除', current: currentRow });
          }
        });
        
        console.log('🔍 发现数据差异:', differences.slice(0, 5));
      } else {
        console.log('✅ 数据完全相同');
      }

      // 标准化并比较 cats
      const currentCatsData = normalizeCatsForCompare(cats);
      const latestCatsData = normalizeCatsForCompare(latestCats);
      const catsEqual = JSON.stringify(currentCatsData) === JSON.stringify(latestCatsData);

      // 标准化并比较 view（只比较已知的视图配置字段）
      const currentViewData = normalizeViewForCompare(view);
      const latestViewData = normalizeViewForCompare(latestView);
      const viewEqual = JSON.stringify(currentViewData) === JSON.stringify(latestViewData);
      const currentPlatformsData = normalizePlatformsForCompare(platformSnapshot.platforms || []);
      const latestPlatformsData = normalizePlatformsForCompare(latestPlatforms);
      const platformsEqual = JSON.stringify(currentPlatformsData) === JSON.stringify(latestPlatformsData);
      const currentPlatformProfilesData = normalizePlatformProfilesForCompare(platformSnapshot.platformProfiles || []);
      const latestPlatformProfilesData = normalizePlatformProfilesForCompare(latestPlatformProfiles || []);
      const platformProfilesEqual = latestPlatformProfiles === null
        ? currentPlatformProfilesData.length === 0
        : JSON.stringify(currentPlatformProfilesData) === JSON.stringify(latestPlatformProfilesData);

      // 关键检查：如果数据内容相同，但数据库时间戳更新了，说明其他设备保存了相同数据
      const cloudTime = new Date(cloudRow.updated_at).getTime();
      const dataContentEqual = rowsEqual && catsEqual && viewEqual && platformsEqual && platformProfilesEqual;
      
      console.log('🔍 数据比较结果:', {
        rowsEqual,
        catsEqual,
        viewEqual,
        platformsEqual,
        platformProfilesEqual,
        latestSnapshotHasPlatformProfiles: latestPlatformProfiles !== null,
        currentPlatformProfilesCount: currentPlatformProfilesData.length,
        latestPlatformProfilesCount: latestPlatformProfilesData.length,
        dataContentEqual,
        cloudTime,
        lastSyncTimestamp,
        cloudTimeNewer: cloudTime > lastSyncTimestamp,
        updatedBy: cloudRow.updated_by_name
      });
      
      if (dataContentEqual) {
        // 数据内容相同
        if (cloudTime > lastSyncTimestamp) {
          // 数据库时间戳更新了，说明其他设备保存了（即使内容相同）
          const who = cloudRow.updated_by_name || '其他设备';
          console.log('ℹ️ 数据内容相同，但云端时间戳更新了', { who, cloudTime, lastSyncTimestamp });
          if (btn) {
            btn.disabled = false;
            btn.textContent = btn.dataset.cleanText || cleanText;
          }
          setSaveStatus('云端无变化', 'info');
          // 更新本地时间戳，避免重复提示
          lastSyncTimestamp = cloudTime;
          localStorage.setItem('last_sync_time', String(cloudTime));
          return { status: 'no_change' };
        } else {
          // 数据内容相同，且时间戳也没更新，说明确实没有改动
          console.log('ℹ️ 数据内容相同，时间戳也没更新');
          if (btn) {
            btn.disabled = false;
            btn.textContent = btn.dataset.cleanText || cleanText;
          }
          setSaveStatus('云端无变化', 'info');
          return { status: 'no_change' };
        }
      } else {
        // 数据内容不同，检查是否有冲突（基于服务器时间戳）
        console.log('⚠️ 数据内容不同，检查冲突', { cloudTime, lastSyncTimestamp, cloudTimeNewer: cloudTime > lastSyncTimestamp });
        if (cloudTime > lastSyncTimestamp) {
          // 云端数据更新（基于服务器时间戳），只提示用户手动处理，避免保存时覆盖本地编辑
          const who = cloudRow.updated_by_name || '其他设备';
          console.log('⚠️ 检测到云端有更新，已暂停本次保存并等待用户手动处理', { who, cloudTime, lastSyncTimestamp });
          
          if (btn) {
            btn.disabled = false;
            btn.textContent = btn.dataset.cleanText || cleanText;
          }
          
          setSaveStatus(`检测到 ${who} 的云端更新，点击“云端加载”查看`, 'warning', 6000);

          // 不继续保存，也不自动加载，避免覆盖本地未确认的数据
          return { status: 'cloud_newer' };
        } else {
          console.log('✅ 数据有改动，且云端没有更新，可以正常保存');
        }
      }
    }

    const payload = {
      ver: 1,
      rows: rows,
      cats: cats,
      view: view,
      platforms: platformSnapshot.platforms || [],
      platformProfiles: platformSnapshot.platformProfiles || [],
      __meta: {
        schemaVersion: 2,
        clientId: getClientId(),
        savedAt: Date.now(),
        source,
        reason,
        appVersion: window.APP_VERSION || ''
      }
    };
    const userName = getCurrentUserName();

    // Upsert (依赖 SQL 中的 UNIQUE key 约束)
    const { data: saved, error } = await supabase
      .from(SUPABASE_TABLE)
      .upsert({
        key: SUPABASE_DEFAULT_KEY,
        owner_id: userId,
        payload: payload,
        updated_at: new Date().toISOString(),
        updated_by_name: userName
      }, { onConflict: 'key' }) // 明确指定冲突键
      .select('updated_at')
      .single();

    if (error) throw error;

    // 使用服务端返回的时间更新本地
    const serverTime = new Date(saved.updated_at).getTime();
    lastSyncTimestamp = serverTime;
    localStorage.setItem('last_sync_time', String(serverTime));
    window.__xhsLastLocalCloudSaveAt = nowMs();
    window.__xhsLastLocalSavedSnapshotUpdatedAt = serverTime;
    localStorage.setItem('xhs_last_local_saved_snapshot_updated_at', String(serverTime));
    
    // 更新最后已知的快照名称（保存后，当前快照名称就是最新的）
    const snapshotName = generateSnapshotName(userName, saved.updated_at);
    saveLastSnapshotName(snapshotName);
    const savedVersion = `${saved.updated_at || ''}|${snapshotName}`;
    window.__xhsLastLocalSavedSnapshotVersion = savedVersion;
    localStorage.setItem('xhs_last_local_saved_snapshot_version', savedVersion);
    console.log('✅ 已更新本地时间戳和快照名称', { 
      serverTime, 
      snapshotName 
    });

    markLocalSynced();
    setSaveStatus(isAuto ? '已自动同步云端' : '已保存到云端', 'success');
    return { status: 'saved' };

  } catch (err) {
    console.error(err);
    if (isAuto) {
      setLocalDirty(true);
      setSaveStatus('自动同步失败，点击保存云端重试', 'error', 5000);
    } else {
      setSaveStatus('保存失败: ' + (err.message || err), 'error', 5000);
    }
    return { status: 'error', error: err };
  } finally {
    setCloudSaving(false);
    startSaveCooldown();
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.cleanText || cleanText; }
    if (window.__xhsPendingAutoCloudSave === true && source !== 'auto') {
      window.__xhsPendingAutoCloudSave = false;
      scheduleAutoCloudSave(window.__xhsLastAutoCloudSaveReason || 'pending');
    }
  }
}

/* 3. 自动同步监听 */
export async function initAutoSync() {
  if (isAutoSyncStarted || isAutoSyncStarting || window.__xhsRealtimeInitialized) {
    console.log('⏭️ 自动同步已启动，跳过重复初始化');
    return;
  }
  if (!supabase) {
    console.warn('⚠️ Supabase 未配置，无法启动自动同步');
    return;
  }
  
  isAutoSyncStarting = true;
  const myUid = await getCurrentUserId();
  if (!myUid) {
    isAutoSyncStarting = false;
    return;
  }

  isAutoSyncStarted = true;
  window.__xhsRealtimeInitialized = true;
  console.log('📡 开启极简同步监听...', { userId: myUid });

  if (realtimeChannel || window._syncChannel) {
    try {
      const oldChannel = realtimeChannel || window._syncChannel;
      await supabase.removeChannel(oldChannel);
      console.log('✅ 已移除旧 Realtime channel');
    } catch (err) {
      console.warn('⚠️ 移除旧 Realtime channel 失败:', err);
    }
    realtimeChannel = null;
    window._syncChannel = null;
  }

  const savedTime = localStorage.getItem('last_sync_time');
  if (savedTime) lastSyncTimestamp = parseInt(savedTime);
  
  // 初始化时，如果没有保存的快照名称，尝试从云端获取
  const lastSnapshotName = getLastSnapshotName();
  console.log('📊 初始化时间戳和快照名称:', { 
    lastSyncTimestamp, 
    savedTime,
    lastSnapshotName
  });
  
  // 如果没有保存的快照名称，尝试从云端获取最新快照名称
  if (!lastSnapshotName) {
    try {
      const { data } = await supabase
        .from(SUPABASE_TABLE)
        .select('payload, updated_at, updated_by_name')
        .eq('key', SUPABASE_DEFAULT_KEY)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (data && data.payload) {
        const snapshotName = data.payload.snapshot_label || 
          generateSnapshotName(data.updated_by_name || '未知用户', data.updated_at);
        saveLastSnapshotName(snapshotName);
        console.log('✅ 初始化：已从云端获取快照名称', { snapshotName });
      }
    } catch (err) {
      console.warn('⚠️ 初始化时获取快照名称失败:', err);
    }
  }

  const channel = supabase
    .channel('smart-auto-sync')
    .on(
      'postgres_changes',
      { 
        event: '*', 
        schema: 'public', 
        table: SUPABASE_TABLE, 
        filter: `key=eq.${SUPABASE_DEFAULT_KEY}` 
      },
      async (evt) => {
        console.log('🔔 Realtime 事件触发:', { 
          event: evt.eventType, 
          hasNewRow: !!evt.new,
          hasOldRow: !!evt.old
        });
        
        const newRow = evt.new;
        if (!newRow) {
          console.log('⏭️ 事件中没有新数据，跳过');
          return;
        }

        const serverTime = new Date(newRow.updated_at).getTime();
        
        // 更新 lastSyncTimestamp（从 localStorage 重新读取，确保多标签页同步）
        const savedTime = localStorage.getItem('last_sync_time');
        const currentLastSync = savedTime ? parseInt(savedTime) : 0;
        lastSyncTimestamp = currentLastSync;
        
        // 获取当前快照名称
        const currentSnapshotName = getLastSnapshotName();
        
        // 生成新的快照名称（用于比较）
        const newSnapshotName = newRow.payload?.snapshot_label || 
          generateSnapshotName(newRow.updated_by_name || '未知用户', newRow.updated_at);
        const remoteUpdate = {
          row: newRow,
          version: snapshotVersionFromRow(newRow),
          snapshotName: newSnapshotName,
          serverTime,
          updatedBy: newRow.updated_by_name || '其他设备'
        };

        if (shouldIgnoreOwnRealtimeEvent(newRow)) {
          console.log('⏭️ 忽略自己设备刚保存触发的 Realtime 事件', {
            version: remoteUpdate.version,
            newSnapshotName
          });
          lastSyncTimestamp = Math.max(lastSyncTimestamp, serverTime || 0);
          if (serverTime) localStorage.setItem('last_sync_time', String(lastSyncTimestamp));
          saveLastSnapshotName(newSnapshotName);
          return;
        }

        if (isCloudSaving()) {
          console.log('⏸️ 保存中，挂起 Realtime 更新', {
            isCloudSaving: isCloudSaving(),
            newSnapshotName
          });
          window.__xhsPendingRemoteUpdate = remoteUpdate;
          setSaveStatus('检测到其他设备更新，退出编辑后自动同步', 'warning', 6000);
          return;
        }
        
        console.log('📊 快照名称和时间戳比较:', {
          serverTime,
          lastSyncTimestamp,
          serverTimeNewer: serverTime > lastSyncTimestamp,
          diff: serverTime - lastSyncTimestamp,
          updatedBy: newRow.updated_by_name,
          currentSnapshotName,
          newSnapshotName,
          snapshotNameChanged: currentSnapshotName !== newSnapshotName
        });
        
        // 关键检测：快照名称是否改变（这是检测新快照的主要方式）
        const snapshotNameChanged = currentSnapshotName !== newSnapshotName;
        
        // 如果快照名称改变，说明有新快照，需要更新
        if (!snapshotNameChanged && serverTime <= lastSyncTimestamp) {
          console.log('⏭️ 快照名称未改变且时间戳不比本地新，跳过自动同步', { 
            serverTime, 
            lastSyncTimestamp, 
            diff: serverTime - lastSyncTimestamp,
            currentSnapshotName,
            newSnapshotName
          });
          return;
        }

        const remoteVersion = remoteUpdate.version || snapshotVersionFromRow(newRow) || newSnapshotName;
        if (lastPromptedVersion === remoteVersion) {
          console.log('⏭️ 该云端版本已处理过，跳过重复同步', { remoteVersion, newSnapshotName });
          return;
        }

        // 快照名称改变或时间戳更新，需要同步
        if (snapshotNameChanged) {
          console.log('🔄 检测到快照名称改变，说明有新快照！', { 
            currentSnapshotName,
            newSnapshotName,
            updatedBy: newRow.updated_by_name
          });
        } else {
          console.log('🔄 检测到云端更新（时间戳更新），准备自动同步', { 
            serverTime, 
            lastSyncTimestamp, 
            diff: serverTime - lastSyncTimestamp,
            updatedBy: newRow.updated_by_name 
          });
        }

        // 检测到快照名称改变，弹出提示要求用户更新
        const who = newRow.updated_by_name || '其他设备';
        markPromptedVersion(remoteVersion);
        
        if (hasUnsafeRemoteApplyState()) {
          console.log('⚠️ 本机正在编辑或有本地修改，挂起远端更新', { who, snapshotNameChanged });
          window.__xhsPendingRemoteUpdate = remoteUpdate;
          setSaveStatus('检测到其他设备更新，退出编辑后自动同步', 'warning', 6000);
          return;
        }

        // 本地没有未保存修改，自动加载并刷新 UI
        console.log('🔄 本地空闲，检测到快照更新，自动加载远端数据', {
          serverTime, 
          lastSyncTimestamp, 
          updatedBy: newRow.updated_by_name,
          snapshotNameChanged
        });
        await applyRemoteUpdateIfSafe(remoteUpdate, 'realtime');
      }
    )
    .subscribe((status) => {
      console.log('📡 Realtime 订阅状态:', status);
      if (status === 'SUBSCRIBED') {
        console.log('✅ Realtime 订阅成功，开始监听数据变化');
      } else if (status === 'CHANNEL_ERROR') {
        console.error('❌ Realtime 订阅失败');
      }
    });
  
  // 保存 channel 引用，防止被垃圾回收
  realtimeChannel = channel;
  window._syncChannel = channel;
  isAutoSyncStarting = false;
}

function showToast(msg, type = 'info', timeout = 2800) {
  if (!msg) return;
  const div = document.createElement('div');
  div.id = 'sync-toast';
  const existing = document.querySelector('#sync-toast');
  if (existing) existing.remove();
  const colors = {
    success: 'rgba(34, 139, 64, 0.95)',
    warning: 'rgba(255, 149, 0, 0.95)',
    error: 'rgba(180, 35, 24, 0.95)',
    info: 'rgba(0, 122, 255, 0.95)'
  };
  div.style.cssText = `
    position: fixed; top: 80px; left: 50%; transform: translateX(-50%);
    background: ${colors[type] || colors.info}; color: #fff; padding: 10px 24px;
    border-radius: 24px; font-size: 14px; z-index: 9999; font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15); animation: fadeIn 0.3s; pointer-events: none;
  `;
  div.innerText = msg;
  document.body.appendChild(div);
  setTimeout(() => {
    div.style.transition = 'opacity 0.5s';
    div.style.opacity = '0';
    setTimeout(() => div.remove(), 500);
  }, timeout);
}

// ===== 兼容旧系统：健康检查 & 历史面板 =====

// 简化版健康检查：验证能否读表，并更新 UI（兼容旧代码）
export async function cloudHealthCheck() {
  const dot = document.querySelector("#cloudDot");
  const text = document.querySelector("#cloudText");
  
  if (!supabase) {
    if (dot) dot.style.background = "#999";
    if (text) text.textContent = "未链接";
    return { ok: false, reason: 'no_supabase' };
  }
  
  try {
    const { error } = await supabase
      .from(SUPABASE_TABLE)
      .select('key')
      .limit(1);

    if (error) {
      if (dot) dot.style.background = "#999";
      if (text) text.textContent = "未链接";
      return { ok: false, reason: error.message };
    }
    
    if (dot) dot.style.background = "#30d158";
    if (text) text.textContent = "已链接";
    return { ok: true };
  } catch (e) {
    if (dot) dot.style.background = "#999";
    if (text) text.textContent = "未链接";
    return { ok: false, reason: e?.message || String(e) };
  }
}

// 简化版历史快照：保证旧 UI 调用不报错（LWW 模式仅 default）
export async function renderCloudHistory() {
  const panel = document.querySelector("#cloudHistoryPanel");
  if (!panel) {
    console.log('[cloud] history panel not found');
    return;
  }

  if (!supabase) {
    panel.innerHTML = `<div style="padding:8px 10px;color:#888;">未配置 Supabase</div>`;
    return;
  }

  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      panel.innerHTML = `<div style="padding:8px 10px;color:#888;">请先登录</div>`;
      return;
    }

    // 查询默认快照（LWW 模式只支持 default）
    // 注意：必须查询最新的，不限制 owner_id，因为可能是其他设备保存的
    // 使用 RLS 策略自动过滤，只查询当前用户有权限的快照
    // 注意：使用 maybeSingle() 而不是 limit(1)，因为只有一个 default key
    const { data, error } = await supabase
      .from(SUPABASE_TABLE)
      .select("key,payload,updated_at,owner_id,updated_by_name")
      .eq('key', SUPABASE_DEFAULT_KEY)
      .order('updated_at', { ascending: false })
      .maybeSingle();

    if (error) {
      console.error('❌ 加载历史失败:', error);
      panel.innerHTML = `<div style="padding:8px 10px;color:#ff3b30;">加载失败: ${error.message}</div>`;
      return;
    }

    if (!data) {
      panel.innerHTML = `<div style="padding:8px 10px;color:#888;">暂无云端数据</div>`;
      return;
    }

    const row = data;
    const rowUserName = row.updated_by_name || '未知用户';
    const metaCount = Array.isArray(row.payload?.rows) ? `${row.payload.rows.length} 条` : "";
    
    // 格式化时间
    const formatTime = (ts) => {
      try {
        const d = new Date(ts);
        const Y = d.getFullYear();
        const M = String(d.getMonth() + 1).padStart(2, '0');
        const D = String(d.getDate()).padStart(2, '0');
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        return `${Y}-${M}-${D} ${h}:${m}`;
      } catch {
        return '';
      }
    };

    // 格式化日期时间（用于快照名称）
    const formatDateTime = (ts) => {
      try {
        const d = new Date(ts);
        const Y = d.getFullYear();
        const M = String(d.getMonth() + 1).padStart(2, '0');
        const D = String(d.getDate()).padStart(2, '0');
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        return `${Y}${M}${D}${h}${m}`;
      } catch {
        return '';
      }
    };

    const t = formatTime(row.updated_at);
    
    // 快照名称：优先使用 payload.snapshot_label，否则使用 用户名+日期时间
    // ✅ 修复：确保总是使用用户名+日期时间格式，不使用"默认快照"
    let snapshotName = row.payload?.snapshot_label;
    const userName = rowUserName;
    
    // 如果没有 snapshot_label 或为空，或者包含"默认快照"字样，都重新生成
    if (!snapshotName || snapshotName.trim() === '' || snapshotName.includes('默认快照')) {
      const dateTimeStr = formatDateTime(row.updated_at);
      snapshotName = `${userName} ${dateTimeStr}`;
    }
    
    // HTML 转义
    const escapeHtml = (str) => {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    };

    const html = `
      <div class="cloud-item latest" data-key="${row.key}" style="cursor: pointer; padding: 12px; border-bottom: 1px solid #eee;">
        <div class="cloud-item-main">
          <div class="cloud-item-name" style="font-weight: 500; margin-bottom: 4px;">${escapeHtml(snapshotName)} <span style="background: #34c759; color: white; padding: 2px 6px; border-radius: 4px; font-size: 12px;">最新</span></div>
          <div class="cloud-item-meta" style="font-size: 12px; color: #666;">${metaCount} · 修改人：${escapeHtml(userName)}</div>
        </div>
        <div class="cloud-item-time" style="font-size: 12px; color: #999; margin-top: 4px;">${escapeHtml(t)}</div>
      </div>
    `;

    panel.innerHTML = html;

    // 绑定点击事件
    panel.querySelectorAll(".cloud-item").forEach((el) => {
      el.addEventListener("click", async () => {
        const key = el.getAttribute("data-key");
        if (!key) return;
        
        if (confirm("确定用该快照覆盖本地数据？")) {
          try {
            // 调用 window 上的 cloudLoad（确保使用桥接的函数）
            const loadFunc = window.cloudLoad || cloudLoad;
            await loadFunc(key, false);
            // 加载后关闭面板
            panel.style.display = "none";
            // 刷新页面数据
            if (window.renderTable) window.renderTable();
            if (window.refreshFilters) window.refreshFilters();
          } catch (err) {
            console.error('加载快照失败:', err);
            alert('加载失败: ' + (err.message || err));
          }
        }
      });
    });

    console.log('[cloud] history rendered: default snapshot');
  } catch (err) {
    console.error('❌ 渲染云端历史失败:', err);
    panel.innerHTML = `<div style="padding:8px 10px;color:#ff3b30;">加载失败: ${err.message}</div>`;
  }
}
