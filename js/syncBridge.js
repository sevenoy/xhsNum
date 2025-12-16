// js/syncBridge.js
// 目的：桥接模块，把新的同步逻辑挂到 window，兼容旧 app.js 的全局调用方式

import {
  cloudSave,
  cloudLoad,
  initAutoSync,
  renderCloudHistory,
  cloudHealthCheck
} from './sync.js';

import { supabase } from './supabaseClient.js';

// 兼容旧全局函数名（旧 app.js 可能到处直接调用）
window.cloudSave = cloudSave;
window.cloudLoad = cloudLoad;
window.initAutoSync = initAutoSync;
window.renderCloudHistory = renderCloudHistory;
window.cloudHealthCheck = cloudHealthCheck;

// 登录后自动启动同步监听（不依赖 app.js）
if (supabase) {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' || (event === 'INITIAL_SESSION' && session)) {
      initAutoSync();
    }
  });
}

