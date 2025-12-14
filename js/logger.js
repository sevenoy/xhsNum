// logger.js - 日志工具模块

/**
 * 简单的日志工具
 * 提供统一的日志接口，方便调试和排查问题
 */
export const logger = {
  log: (...args) => {
    console.log('[LOG]', ...args);
  },
  
  warn: (...args) => {
    console.warn('[WARN]', ...args);
  },
  
  error: (...args) => {
    console.error('[ERROR]', ...args);
  },
  
  info: (...args) => {
    console.info('[INFO]', ...args);
  },
  
  debug: (...args) => {
    if (process?.env?.NODE_ENV === 'development' || localStorage.getItem('xhs_debug') === 'true') {
      console.debug('[DEBUG]', ...args);
    }
  }
};
