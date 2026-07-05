const assert = require("assert");
const { EXPORT_HEADERS, toCSV } = require("../js/csv-export.js");

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

const cats = [
  { id: "internal-color-id", name: "嘉用", color: "#ff9f0a" },
  { id: "zhuhai-id", name: "珠海", color: "#007aff" },
];

const directCsv = toCSV(
  [
    {
      id: "row-1",
      phone: "13800000000",
      owner: "Olina",
      wx_real: "实名",
      wx_name: "微信名",
      xhs_name: "小红书名",
      category: "珠海",
      douyin_name: "澳门羊羊羊",
      note1: "备注",
      row_color: "internal-color-id",
      order: 1,
    },
  ],
  { cats }
);

const directLines = directCsv.split("\n");
const directHeaders = directLines[0].split(",");
const directCells = parseCsvLine(directLines[1]);
const directRow = Object.fromEntries(directHeaders.map((header, index) => [header, directCells[index]]));

assert.deepStrictEqual(directHeaders, EXPORT_HEADERS);
assert(!directHeaders.includes("row_color"));
assert.strictEqual(directRow.category, "珠海");
assert.strictEqual(directRow.douyin_name, "澳门羊羊羊");

const mappedCsv = toCSV(
  [
    {
      id: "row-2",
      phone: "13900000000",
      row_color: "zhuhai-id",
      order: 2,
    },
  ],
  {
    cats,
    platformProfiles: new Map([
      ["row-2:douyin", { row_id: "row-2", platform_id: "douyin", value: "澳门羊羊羊" }],
    ]),
  }
);

const mappedHeaders = mappedCsv.split("\n")[0].split(",");
const mappedCells = parseCsvLine(mappedCsv.split("\n")[1]);
const mappedRow = Object.fromEntries(mappedHeaders.map((header, index) => [header, mappedCells[index]]));

assert.strictEqual(mappedRow.category, "珠海");
assert.strictEqual(mappedRow.douyin_name, "澳门羊羊羊");
assert.strictEqual(mappedRow.row_color, undefined);
