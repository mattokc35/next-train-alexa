/**
 * Minimal, dependency-free CSV parser for GTFS text files. GTFS allows
 * quoted fields with embedded commas/newlines (per the CSV spec), so we
 * can't just split on commas — this handles quoted fields (`"a, b"`,
 * `""`-escaped quotes) while staying small enough not to warrant a full CSV
 * library dependency for five tiny, well-formed files.
 */
export function parseCsv(text: string): Record<string, string>[] {
  // Strip a leading UTF-8 BOM (PATH's stops.txt has one) and normalize
  // line endings.
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const rows = splitCsvRows(normalized);
  if (rows.length === 0) {
    return [];
  }
  const header = rows[0];
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    header.forEach((key, i) => {
      record[key] = row[i] ?? '';
    });
    return record;
  });
}

function splitCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  // Flush the trailing field/row (files don't always end with a newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}
