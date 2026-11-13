/** Parse CSV text (RFC 4180: quoted fields, "" escapes, newlines inside quotes) into rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim()));
}

export interface BeerRow {
  brewery_id: string;
  name: string;
  style: string | null;
  abv: string | null;
  availability: string | null;
}

/** Header names accepted for each column (the sheet's beers tab uses the beer_ ones). */
const COLUMNS: Record<keyof BeerRow, string[]> = {
  brewery_id: ['brewery_id'],
  name: ['beer_name', 'name'],
  style: ['beer_style', 'style'],
  abv: ['beer_abv', 'abv'],
  availability: ['beer_availability', 'availability'],
};

/** "5.2", "5.2%" -> "5.2"; anything else ("TBD") -> null, since the page appends "%". */
export function normalizeAbv(value: string): string | null {
  const v = value.trim().replace(/%$/, '').trim();
  return /^\d+(\.\d+)?$/.test(v) ? v : null;
}

export interface ParsedBeers {
  beers: BeerRow[];
  /** Line number (1-based, header is line 1) and reason for each row left out. */
  skipped: string[];
  /** Rows whose ABV wasn't a number and was dropped ("TBD"). */
  unknownAbv: number;
}

/** Beer rows from the CSV: trimmed, ABV and "Unknown" availability cleaned, duplicates dropped. */
export function beersFromCsv(text: string): ParsedBeers {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error('The CSV is empty');
  const names = header.map((h) => h.trim().toLowerCase());
  const index = Object.fromEntries(
    Object.entries(COLUMNS).map(([key, aliases]) => [
      key,
      names.findIndex((n) => aliases.includes(n)),
    ])
  ) as Record<keyof BeerRow, number>;
  for (const key of ['brewery_id', 'name'] as const)
    if (index[key] < 0)
      throw new Error(
        `The CSV has no ${COLUMNS[key].join(' or ')} column (header: ${header.join(', ')})`
      );

  const beers: BeerRow[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  let unknownAbv = 0;
  rows.forEach((row, i) => {
    const line = i + 2;
    const cell = (key: keyof BeerRow) =>
      index[key] < 0 ? '' : (row[index[key]] ?? '').trim();
    const beer: BeerRow = {
      brewery_id: cell('brewery_id'),
      name: cell('name'),
      style: cell('style') || null,
      abv: normalizeAbv(cell('abv')),
      availability:
        cell('availability') && !/^unknown$/i.test(cell('availability'))
          ? cell('availability')
          : null,
    };
    if (!beer.brewery_id || !beer.name) {
      skipped.push(`line ${line}: missing brewery_id or beer name`);
      return;
    }
    const key = `${beer.brewery_id}|${beer.name.toLowerCase()}`;
    if (seen.has(key)) {
      skipped.push(
        `line ${line}: duplicate of "${beer.name}" for brewery ${beer.brewery_id}`
      );
      return;
    }
    seen.add(key);
    if (cell('abv') && !beer.abv) unknownAbv++;
    beers.push(beer);
  });
  return { beers, skipped, unknownAbv };
}
