(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.XhsCsvExport = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  const EXPORT_HEADERS = [
    "phone",
    "owner",
    "wx_real",
    "wx_name",
    "xhs_name",
    "category",
    "douyin_name",
    "note1",
    "order",
  ];

  function csvCell(value) {
    const s = String(value ?? "");
    return `"${s.replaceAll('"', '""')}"`;
  }

  function normalizeCats(cats) {
    if (!Array.isArray(cats)) return [];
    return cats
      .filter((cat) => cat && (cat.id || cat.name || cat.color))
      .map((cat) => ({
        id: String(cat.id || "").trim(),
        name: String(cat.name || "").trim(),
        color: String(cat.color || "").trim(),
      }));
  }

  function catNameByToken(cats, token) {
    const value = String(token || "").trim();
    if (!value) return "";
    const found = cats.find((cat) => cat.id === value || cat.color === value);
    return found ? found.name : "";
  }

  function directCategoryValue(row, cats) {
    const directKeys = ["categoryName", "category_name", "category_label", "category"];
    for (const key of directKeys) {
      const value = String(row?.[key] || "").trim();
      if (!value) continue;
      return catNameByToken(cats, value) || value;
    }
    return "";
  }

  function categoryNameForRow(row, catsInput) {
    const cats = normalizeCats(catsInput);
    const direct = directCategoryValue(row, cats);
    if (direct) return direct;

    const idKeys = [
      "categoryId",
      "category_id",
      "cat_id",
      "colorId",
      "color_id",
      "row_color",
      "legacyRowColor",
    ];
    for (const key of idKeys) {
      const mapped = catNameByToken(cats, row?.[key]);
      if (mapped) return mapped;
    }
    return "";
  }

  function valueFromPlatformRecord(record) {
    if (record == null) return "";
    if (typeof record === "string" || typeof record === "number") {
      return String(record).trim();
    }
    if (typeof record === "object") {
      return String(
        record.value ??
          record.name ??
          record.account ??
          record.username ??
          record.displayName ??
          ""
      ).trim();
    }
    return "";
  }

  function valueFromPlatformProfiles(row, profilesInput, platformId) {
    if (!row || !profilesInput) return "";
    const rowId = String(row.id || row.row_id || "");
    if (!rowId) return "";

    if (profilesInput instanceof Map) {
      return valueFromPlatformRecord(profilesInput.get(`${rowId}:${platformId}`));
    }

    if (Array.isArray(profilesInput)) {
      const found = profilesInput.find((profile) => {
        return (
          String(profile?.row_id || profile?.rowId || "") === rowId &&
          String(profile?.platform_id || profile?.platformId || "") === platformId
        );
      });
      return valueFromPlatformRecord(found);
    }

    if (typeof profilesInput === "object") {
      return valueFromPlatformRecord(
        profilesInput[`${rowId}:${platformId}`] ||
          profilesInput[rowId]?.[platformId] ||
          profilesInput[rowId]
      );
    }

    return "";
  }

  function douyinNameForRow(row, options) {
    const directKeys = ["douyin_name", "douyin", "dy_name", "douyinName", "dyName"];
    for (const key of directKeys) {
      const value = String(row?.[key] || "").trim();
      if (value) return value;
    }

    const platformObjects = [row?.platforms, row?.platformProfiles, row?.profiles];
    for (const item of platformObjects) {
      const value = valueFromPlatformRecord(item?.douyin);
      if (value) return value;
    }

    return valueFromPlatformProfiles(row, options?.platformProfiles, "douyin");
  }

  function exportValue(row, header, options) {
    switch (header) {
      case "category":
        return categoryNameForRow(row, options?.cats);
      case "douyin_name":
        return douyinNameForRow(row, options);
      default:
        return row?.[header] ?? "";
    }
  }

  function toCSV(rows, options = {}) {
    const out = [EXPORT_HEADERS.join(",")];
    for (const row of rows || []) {
      out.push(
        EXPORT_HEADERS.map((header) => csvCell(exportValue(row, header, options))).join(",")
      );
    }
    return out.join("\n");
  }

  return {
    EXPORT_HEADERS,
    categoryNameForRow,
    douyinNameForRow,
    toCSV,
  };
});
