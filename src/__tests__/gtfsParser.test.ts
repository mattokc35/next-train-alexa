import { parseCsv } from '../services/gtfsParser';

describe('parseCsv', () => {
  it('parses a simple header + rows into records', () => {
    const text = 'a,b,c\n1,2,3\n4,5,6\n';
    expect(parseCsv(text)).toEqual([
      { a: '1', b: '2', c: '3' },
      { a: '4', b: '5', c: '6' },
    ]);
  });

  it('strips a leading UTF-8 BOM', () => {
    const text = '\uFEFFa,b\n1,2\n';
    expect(parseCsv(text)).toEqual([{ a: '1', b: '2' }]);
  });

  it('handles quoted fields containing commas', () => {
    const text = 'name,desc\nFoo,"a, b, c"\n';
    expect(parseCsv(text)).toEqual([{ name: 'Foo', desc: 'a, b, c' }]);
  });

  it('handles escaped double quotes inside a quoted field', () => {
    const text = 'name,desc\nFoo,"she said ""hi"""\n';
    expect(parseCsv(text)).toEqual([{ name: 'Foo', desc: 'she said "hi"' }]);
  });

  it('handles CRLF line endings', () => {
    const text = 'a,b\r\n1,2\r\n3,4\r\n';
    expect(parseCsv(text)).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('handles a trailing row without a final newline', () => {
    const text = 'a,b\n1,2\n3,4';
    expect(parseCsv(text)).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});
