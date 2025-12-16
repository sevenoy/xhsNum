// js/config.js
export const SUPABASE_URL = localStorage.getItem("xhs_supabase_url") || "";
export const SUPABASE_ANON_KEY = localStorage.getItem("xhs_supabase_anon_key") || "";
export const SUPABASE_TABLE = "xhsphone_snapshot";
export const SUPABASE_DEFAULT_KEY = "default";
export const DB_NAME = "xhs_phone_sheet_v7";
export const VIEW_KEY = "xhs_view_v7";
export const CATS_KEY = "xhs_cats_v7";

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

export const DEFAULT_CATS = Object.freeze([
  { id: "enterprise", name: "企业号", color: "#007aff" },
  { id: "olina", name: "Olina用", color: "#34c759" },
  { id: "jasper", name: "嘉用", color: "#ff9f0a" },
  { id: "usable", name: "可用", color: "#8e8e93" },
]);
