// config.js - 配置和常量模块

/**
 * 本地存储键名
 */
export const VIEW_KEY = "xhs_view_v7";
export const CATS_KEY = "xhs_cats_v7";

/**
 * 数据库配置
 */
export const DB_NAME = "xhs_phone_sheet_v7";

/**
 * Supabase配置
 */
export const SUPABASE_TABLE = "xhsphone_snapshot";
export const SUPABASE_DEFAULT_KEY = "default";

/**
 * 默认视图配置
 */
export const DEFAULT_VIEW = Object.freeze({
  viewVersion: 9,
  pad: 4,
  colScale: 0.7,
  zebraOn: true,
  zebraColor: "#e2f0ff",
  fontFamily: "PingFang SC, -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif",
  fontWeight: "normal",
  titleText: "号码管理",
  titleColor: "#208BEE",
  btnColor: "#639BD5",
});

/**
 * 默认分类配置
 */
export const DEFAULT_CATS = Object.freeze([
  { id: "enterprise", name: "企业号", color: "#007aff" },
  { id: "olina", name: "Olina用", color: "#34c759" },
  { id: "jasper", name: "嘉用", color: "#ff9f0a" },
  { id: "usable", name: "可用", color: "#8e8e93" },
]);

/**
 * 初始化Supabase配置（如果不存在）
 */
export function initSupabaseConfig() {
  if (!localStorage.getItem("xhs_supabase_url")) {
    localStorage.setItem(
      "xhs_supabase_url",
      "https://tmeqccupnsvxexbrlflo.supabase.co"
    );
  }
  if (!localStorage.getItem("xhs_supabase_anon_key")) {
    localStorage.setItem(
      "xhs_supabase_anon_key",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtZXFjY3VwbnN2eGV4YnJsZmxvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0OTg2MjAsImV4cCI6MjA3ODA3NDYyMH0.9ZJz6Cwpjo5HLGXRNMBtj-J57gX47Aj42_0ILmkxbho"
    );
  }
}

/**
 * 获取Supabase配置
 */
export function getSupabaseConfig() {
  const SUPABASE_URL = (window.SUPABASE_URL || localStorage.getItem("xhs_supabase_url") || "").trim();
  const SUPABASE_ANON_KEY = (window.SUPABASE_ANON_KEY || localStorage.getItem("xhs_supabase_anon_key") || "").trim();
  return { SUPABASE_URL, SUPABASE_ANON_KEY };
}
