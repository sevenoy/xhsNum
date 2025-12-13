// utils.js - 工具函数模块

/**
 * DOM选择器快捷方式
 */
export const $ = (sel) => document.querySelector(sel);

/**
 * 格式化时间戳
 * @param {number|string} ts - 时间戳
 * @returns {string} 格式化后的时间字符串
 */
export function fmtTime(ts) {
  try {
    const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, "0");
    const D = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${Y}-${M}-${D} ${h}:${m}`;
  } catch {
    return "";
  }
}

/**
 * 生成唯一ID
 * @returns {string} 唯一ID
 */
export function uid() {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
  ).toUpperCase();
}

/**
 * HTML转义
 * @param {string} s - 要转义的字符串
 * @returns {string} 转义后的字符串
 */
export function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * HTML反转义
 * @param {string} s - 要反转义的字符串
 * @returns {string} 反转义后的字符串
 */
export function unescapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

/**
 * 十六进制颜色转RGBA
 * @param {string} hex - 十六进制颜色值
 * @param {number} alpha - 透明度 (0-1)
 * @returns {string} RGBA颜色字符串
 */
export function hexToRgba(hex, alpha) {
  if (!hex) return "transparent";
  hex = (hex || "").replace("#", "");
  if (hex.length === 3) hex = hex.split("").map((x) => x + x).join("");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * 截断文本
 * @param {string} text - 要截断的文本
 * @param {number} maxChars - 最大字符数
 * @returns {string} 截断后的文本
 */
export function truncateText(text, maxChars = 10) {
  if (!text) return "";
  const str = String(text);
  if (str.length <= maxChars) return str;
  return str.slice(0, maxChars) + "...";
}

/**
 * 分词函数（用于搜索）
 * @param {string} s - 输入字符串
 * @returns {string[]} 分词结果
 */
export function tokenize(s) {
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * 匹配数字子串（用于电话号码搜索）
 * @param {string} phone - 电话号码
 * @param {string} queryDigits - 查询的数字
 * @returns {boolean} 是否匹配
 */
export function matchDigitsSubstr(phone, queryDigits) {
  const digits = String(phone || "").replace(/\D+/g, "");
  return digits.includes(queryDigits);
}
