// js/sync.js
import { 
  getAllRows, readCats, readView, saveCats, saveView, 
  overwriteAllRows, clearDirty, isLocalDirty 
} from './data.js';
import { supabase, getCurrentUserName, getCurrentUserId } from './supabaseClient.js';
import { SUPABASE_DEFAULT_KEY, SUPABASE_TABLE } from './config.js';

let lastSyncTimestamp = Number(localStorage.getItem('last_sync_time') || '0');
let isAutoSyncStarted = false;

/* 1. 加载云端数据 */
export async function cloudLoad(keyOrSilent = SUPABASE_DEFAULT_KEY, silent = false) {
  // 兼容旧调用方式：如果第一个参数是 boolean，则视为 silent
  let key = SUPABASE_DEFAULT_KEY;
  let isSilent = false;
  
  if (typeof keyOrSilent === 'boolean') {
    isSilent = keyOrSilent;
    key = SUPABASE_DEFAULT_KEY;
  } else if (typeof keyOrSilent === 'string') {
    key = keyOrSilent;
    isSilent = silent;
  }

  if (!supabase) { if(!isSilent) alert('未配置 Supabase'); return; }

  // 如果本地有修改，必须确认覆盖
  if (!isSilent && isLocalDirty()) {
    const ok = confirm('⚠️ 本地有未保存修改。\n\n加载云端数据将覆盖本地修改。\n\n是否继续？');
    if (!ok) return;
  }

  try {
    // 必须倒序取最新一条
    const { data, error } = await supabase
      .from(SUPABASE_TABLE)
      .select('payload, updated_at, updated_by_name')
      .eq('key', key)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) throw error;
    const row = data?.[0];
    
    if (!row) {
      if (!isSilent) console.log("云端无数据");
      return; 
    }

    const serverTime = new Date(row.updated_at).getTime();
    // 如果是手动加载（非静默），总是加载，不检查时间戳
    // 只有自动同步时才检查时间戳
    if (isSilent && serverTime <= lastSyncTimestamp) {
      console.log('云端数据不比本地新，跳过加载');
      return;
    }

    const payload = row.payload || {};
    
    // 事务写入本地，防止写一半失败
    await overwriteAllRows(payload.rows || []);
    
    // 静默更新配置
    if (payload.cats) saveCats(payload.cats, true);
    if (payload.view) saveView(payload.view, true);

    lastSyncTimestamp = serverTime;
    localStorage.setItem('last_sync_time', String(serverTime));

    clearDirty();
    
    // 更新本地时间戳
    lastSyncTimestamp = serverTime;
    localStorage.setItem('last_sync_time', String(serverTime));
    
    // 刷新界面
    if (window.renderTable) await window.renderTable();
    if (window.refreshFilters) await window.refreshFilters();
    
    if (isSilent) {
      showToast(`🔄 已同步 ${row.updated_by_name || '其他设备'} 的修改`);
    } else {
      alert('✅ 已加载云端最新数据');
    }

  } catch (err) {
    console.error(err);
    if (!isSilent) alert('加载失败: ' + (err.message || err));
  }
}

/* 2. 保存到云端 */
export async function cloudSave() {
  if (!supabase) { alert('未配置 Supabase'); return; }

  const btn = document.querySelector('#btnSaveCloud');
  const cleanText = btn ? (btn.dataset.cleanText || btn.textContent || '保存云端') : '保存云端';
  
  if (btn) { 
    if (!btn.dataset.cleanText) btn.dataset.cleanText = cleanText.replace(' *', '').replace('⏳ ', '');
    btn.disabled = true; 
    btn.textContent = '⏳ 保存中...'; 
  }

  try {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error("请先登录");

    // 获取本地数据
    const rows = await getAllRows();
    const cats = readCats();
    const view = readView();

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

      // 标准化 rows 数据（只比较数据字段，忽略元数据）
      const normalizeRow = (r) => {
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
      };

      // 排序 rows（按 phone 排序，确保顺序一致）
      const sortRows = (rowsData) => {
        return rowsData
          .map(normalizeRow)
          .filter(r => r !== null)
          .sort((a, b) => {
            const phoneA = a.phone || '';
            const phoneB = b.phone || '';
            if (phoneA !== phoneB) return phoneA.localeCompare(phoneB);
            const ownerA = a.owner || '';
            const ownerB = b.owner || '';
            if (ownerA !== ownerB) return ownerA.localeCompare(ownerB);
            return (a.xhs_name || '').localeCompare(b.xhs_name || '');
          });
      };

      const currentRowsData = sortRows(rows);
      const latestRowsData = sortRows(latestRows);
      const rowsEqual = JSON.stringify(currentRowsData) === JSON.stringify(latestRowsData);

      // 标准化并比较 cats
      const normalizeCats = (catsData) => {
        if (!Array.isArray(catsData)) return [];
        return catsData
          .map(c => ({
            id: String(c.id || '').trim(),
            name: String(c.name || '').trim(),
            color: String(c.color || '').trim()
          }))
          .sort((a, b) => (a.id || '').localeCompare(b.id || ''));
      };

      const currentCatsData = normalizeCats(cats);
      const latestCatsData = normalizeCats(latestCats);
      const catsEqual = JSON.stringify(currentCatsData) === JSON.stringify(latestCatsData);

      // 标准化并比较 view（只比较已知的视图配置字段）
      const KNOWN_VIEW_FIELDS = [
        'pad', 'colScale', 'zebraOn', 'zebraColor', 'fontFamily', 
        'fontWeight', 'titleText', 'titleColor', 'btnColor'
      ];

      const normalizeViewData = (v) => {
        if (!v) return {};
        const normalized = {};
        KNOWN_VIEW_FIELDS.forEach(key => {
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
      };

      const currentViewData = normalizeViewData(view);
      const latestViewData = normalizeViewData(latestView);
      const viewEqual = JSON.stringify(currentViewData) === JSON.stringify(latestViewData);

      // 关键检查：如果数据内容相同，但数据库时间戳更新了，说明其他设备保存了相同数据
      const cloudTime = new Date(cloudRow.updated_at).getTime();
      const dataContentEqual = rowsEqual && catsEqual && viewEqual;
      
      if (dataContentEqual) {
        // 数据内容相同
        if (cloudTime > lastSyncTimestamp) {
          // 数据库时间戳更新了，说明其他设备保存了（即使内容相同）
          const who = cloudRow.updated_by_name || '其他设备';
          if (btn) {
            btn.disabled = false;
            btn.textContent = btn.dataset.cleanText || cleanText;
          }
          alert(`ℹ️ 没有数据改动\n\n当前数据与云端最新快照（${who}保存）完全相同，无需保存。\n\n请修改数据后再保存到云端。`);
          // 更新本地时间戳，避免重复提示
          lastSyncTimestamp = cloudTime;
          localStorage.setItem('last_sync_time', String(cloudTime));
          return;
        } else {
          // 数据内容相同，且时间戳也没更新，说明确实没有改动
          if (btn) {
            btn.disabled = false;
            btn.textContent = btn.dataset.cleanText || cleanText;
          }
          alert('ℹ️ 没有数据改动\n\n当前数据与最新快照完全相同，无需保存。\n\n请修改数据后再保存到云端。');
          return;
        }
      } else {
        // 数据内容不同，检查是否有冲突
        if (cloudTime > lastSyncTimestamp) {
          // 数据库被其他设备更新了，且内容不同，需要确认覆盖
          const who = cloudRow.updated_by_name || '其他人';
          const ok = confirm(`⚠️ 冲突警告\n\n"${who}" 刚刚更新了数据。\n\n继续保存将覆盖对方修改。\n\n【确定】覆盖\n【取消】先拉取最新`);
          if (!ok) {
            if (btn) {
              btn.disabled = false;
              btn.textContent = btn.dataset.cleanText || cleanText;
            }
            await cloudLoad(false);
            return;
          }
        }
      }
    }

    const payload = {
      ver: 1,
      rows: rows,
      cats: cats,
      view: view
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

    clearDirty();
    alert('✅ 保存成功');

  } catch (err) {
    console.error(err);
    alert('保存失败: ' + (err.message || err));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.cleanText || cleanText; }
  }
}

/* 3. 自动同步监听 */
export async function initAutoSync() {
  if (isAutoSyncStarted) return;
  if (!supabase) return;
  
  const myUid = await getCurrentUserId();
  if (!myUid) return;

  isAutoSyncStarted = true;
  console.log('📡 开启极简同步监听...');

  const savedTime = localStorage.getItem('last_sync_time');
  if (savedTime) lastSyncTimestamp = parseInt(savedTime);

  supabase
    .channel('smart-auto-sync')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: SUPABASE_TABLE, filter: `key=eq.${SUPABASE_DEFAULT_KEY}` },
      (evt) => {
        const newRow = evt.new;
        if (!newRow) return;

        const serverTime = new Date(newRow.updated_at).getTime();

        // 简单的时间戳判定：只更新比本地新的
        if (serverTime <= lastSyncTimestamp) return;

        if (isLocalDirty()) {
          showToast(`🔔 ${newRow.updated_by_name || '其他设备'} 更新了数据，请先保存或手动加载`);
          return;
        }

        console.log('🔄 自动刷新...');
        cloudLoad(true);
      }
    )
    .subscribe();
}

function showToast(msg) {
  const div = document.createElement('div');
  div.id = 'sync-toast';
  div.style.cssText = `
    position: fixed; top: 80px; left: 50%; transform: translateX(-50%);
    background: rgba(255, 149, 0, 0.95); color: #fff; padding: 10px 24px;
    border-radius: 24px; font-size: 14px; z-index: 9999; font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15); animation: fadeIn 0.3s; pointer-events: none;
  `;
  div.innerText = msg;
  document.body.appendChild(div);
  setTimeout(() => {
    div.style.transition = 'opacity 0.5s';
    div.style.opacity = '0';
    setTimeout(() => div.remove(), 500);
  }, 4000);
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
    const { data, error } = await supabase
      .from(SUPABASE_TABLE)
      .select("key,payload,updated_at,owner_id,updated_by_name")
      .eq('key', SUPABASE_DEFAULT_KEY)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('❌ 加载历史失败:', error);
      panel.innerHTML = `<div style="padding:8px 10px;color:#ff3b30;">加载失败: ${error.message}</div>`;
      return;
    }

    if (!data || !data.length) {
      panel.innerHTML = `<div style="padding:8px 10px;color:#888;">暂无云端数据</div>`;
      return;
    }

    const row = data[0];
    const userName = row.updated_by_name || '未知用户';
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
    let snapshotName = row.payload?.snapshot_label;
    if (!snapshotName || snapshotName.trim() === '') {
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
