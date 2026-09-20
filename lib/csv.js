// Minimal CSV parser for the server-side import feature.
// Handles quoted fields, escaped quotes ("") and CRLF.
// Returns an array of rows (each row an array of strings).
export function parseCsv(text) {
  const s = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;

  const pushRow = () => {
    if (row.length > 1 || (row.length === 1 && row[0] !== '')) rows.push(row);
    row = [];
    cur = '';
  };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cur);
      pushRow();
    } else {
      cur += c;
    }
  }
  row.push(cur);
  pushRow();
  return rows;
}

/** Map a raw CSV row to an object using normalized headers. */
export function rowsToObjects(rows) {
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => String(h).trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = (r[i] ?? '').trim();
    });
    return obj;
  });
}
