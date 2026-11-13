import { describe, expect, it } from 'vitest';
import { beersFromCsv, normalizeAbv, parseCsv } from './beers-csv';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, commas and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });
});

describe('normalizeAbv', () => {
  it('keeps numbers and drops the rest', () => {
    expect(normalizeAbv(' 5.2 ')).toBe('5.2');
    expect(normalizeAbv('6%')).toBe('6');
    expect(normalizeAbv('TBD')).toBeNull();
    expect(normalizeAbv('')).toBeNull();
  });
});

describe('beersFromCsv', () => {
  const header = 'brewery_id,beer_name,beer_style,beer_abv,beer_availability';

  it('maps the sheet columns and cleans values', () => {
    expect(
      beersFromCsv(
        `${header}\n1,1623 Pilsner,Pilsner,5.2,Year-round\n2,Blueberry Sour,,TBD,Unknown\n`
      )
    ).toEqual({
      beers: [
        {
          brewery_id: '1',
          name: '1623 Pilsner',
          style: 'Pilsner',
          abv: '5.2',
          availability: 'Year-round',
        },
        {
          brewery_id: '2',
          name: 'Blueberry Sour',
          style: null,
          abv: null,
          availability: null,
        },
      ],
      skipped: [],
      unknownAbv: 1,
    });
  });

  it('skips incomplete and duplicate rows', () => {
    const { beers, skipped } = beersFromCsv(
      `${header}\n1,IPA,,,\n1,ipa,,,\n,Lager,,,\n`
    );
    expect(beers).toHaveLength(1);
    expect(skipped).toEqual([
      'line 3: duplicate of "ipa" for brewery 1',
      'line 4: missing brewery_id or beer name',
    ]);
  });

  it('requires brewery_id and name columns', () => {
    expect(() => beersFromCsv('brewery,beer\n1,IPA\n')).toThrow(/brewery_id/);
  });
});
