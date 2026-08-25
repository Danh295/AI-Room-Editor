import { describe, it, expect } from 'vitest';
import {
  parseLength,
  formatLength,
  formatArea,
  MM_PER_INCH,
  MM_PER_FOOT,
} from './units.js';

describe('parseLength — imperial input', () => {
  it('reads feet-and-inches with a prime and a double prime', () => {
    expect(parseLength(`12'4"`, 'imperial')).toBe(3759);
  });

  it('reads a mixed fraction in the inches half', () => {
    // 12ft = 3657.6, 4.5in = 114.3 -> 3771.9 -> 3772
    expect(parseLength(`12' 4 1/2"`, 'imperial')).toBe(3772);
  });

  it('accepts a hyphen between whole inches and the fraction', () => {
    expect(parseLength(`12'4-1/2"`, 'imperial')).toBe(3772);
  });

  it('reads word units', () => {
    expect(parseLength('12 ft 4 in', 'imperial')).toBe(3759);
    expect(parseLength('12 feet 4 inches', 'imperial')).toBe(3759);
  });

  it('reads inches alone, with or without a unit', () => {
    expect(parseLength('148in', 'imperial')).toBe(3759);
    expect(parseLength('148"', 'imperial')).toBe(3759);
    expect(parseLength('148', 'imperial')).toBe(3759);
  });

  it('reads a bare fraction as inches', () => {
    expect(parseLength('1/2"', 'imperial')).toBe(13); // 12.7 -> 13
  });

  it('reads decimal feet', () => {
    expect(parseLength('12.5ft', 'imperial')).toBe(Math.round(12.5 * MM_PER_FOOT));
  });

  it('treats an unqualified second token after feet as inches, not the display unit', () => {
    // "12' 4" must be 12ft4in even though bare numbers default to inches here.
    expect(parseLength(`12' 4`, 'imperial')).toBe(3759);
    expect(parseLength(`12' 4`, 'metric')).toBe(3759);
  });
});

describe('parseLength — metric input', () => {
  it('reads a bare number as millimeters', () => {
    expect(parseLength('3759', 'metric')).toBe(3759);
  });

  it('reads explicit metric units', () => {
    expect(parseLength('3759mm', 'metric')).toBe(3759);
    expect(parseLength('375.9cm', 'metric')).toBe(3759);
    expect(parseLength('3.759m', 'metric')).toBe(3759);
    expect(parseLength('3.76 m', 'metric')).toBe(3760);
  });

  it('reads long-form metric unit names', () => {
    expect(parseLength('3.76 meters', 'metric')).toBe(3760);
    expect(parseLength('3.76 metres', 'metric')).toBe(3760);
    expect(parseLength('376 centimeters', 'metric')).toBe(3760);
    expect(parseLength('3760 millimeters', 'metric')).toBe(3760);
  });

  it('honours an explicit imperial unit even in metric mode', () => {
    expect(parseLength(`12'4"`, 'metric')).toBe(3759);
  });
});

describe('parseLength — normalization', () => {
  it('accepts typographic prime and quote characters', () => {
    expect(parseLength('12′4″', 'imperial')).toBe(3759);
    expect(parseLength('12’4”', 'imperial')).toBe(3759);
  });

  it('is case insensitive and tolerates extra whitespace', () => {
    expect(parseLength('  12 FT   4 IN  ', 'imperial')).toBe(3759);
  });
});

describe('parseLength — rejection', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['abc', 'letters only'],
    ['twelve feet', 'spelled-out number'],
    ['12 x 4', 'a dimension pair, not a length'],
    ['12 potato', 'unknown unit'],
    ['-5', 'negative'],
    ['1/0', 'divide by zero'],
    ['12 ft 4 in extra', 'trailing garbage'],
    ['$40', 'a price'],
  ])('rejects %j (%s)', (input) => {
    expect(parseLength(input, 'imperial')).toBeNull();
  });

  it('rejects non-string input defensively', () => {
    // @ts-expect-error deliberately passing the wrong type
    expect(parseLength(null, 'imperial')).toBeNull();
    // @ts-expect-error deliberately passing the wrong type
    expect(parseLength(148, 'imperial')).toBeNull();
  });
});

describe('formatLength — imperial', () => {
  it('renders feet and whole inches', () => {
    expect(formatLength(3759, 'imperial')).toBe(`12' 4"`);
  });

  it('renders a reduced fraction', () => {
    expect(formatLength(3772, 'imperial')).toBe(`12' 4 1/2"`);
  });

  it('reduces eighths to lowest terms', () => {
    expect(formatLength(Math.round(4.25 * MM_PER_INCH), 'imperial')).toBe(`4 1/4"`);
    expect(formatLength(Math.round(4.75 * MM_PER_INCH), 'imperial')).toBe(`4 3/4"`);
    expect(formatLength(Math.round(4.125 * MM_PER_INCH), 'imperial')).toBe(`4 1/8"`);
  });

  it('omits the feet part below one foot', () => {
    expect(formatLength(Math.round(4.5 * MM_PER_INCH), 'imperial')).toBe(`4 1/2"`);
  });

  it('omits the inches part when it lands exactly on a foot', () => {
    expect(formatLength(MM_PER_FOOT, 'imperial')).toBe(`1'`);
    expect(formatLength(3 * MM_PER_FOOT, 'imperial')).toBe(`3'`);
  });

  it('carries the rounding up rather than emitting 12 inches', () => {
    // 11.99" is within 1/8" of a foot and must not render as 0' 12".
    expect(formatLength(Math.round(11.99 * MM_PER_INCH), 'imperial')).toBe(`1'`);
  });

  it('renders zero', () => {
    expect(formatLength(0, 'imperial')).toBe(`0"`);
  });

  it('honours a coarser fraction denominator', () => {
    const mm = Math.round(4.125 * MM_PER_INCH); // 4 1/8"
    expect(formatLength(mm, 'imperial', { fractionDenominator: 2 })).toBe(`4"`);
  });
});

describe('formatLength — metric', () => {
  it('switches to meters at and above 1000mm', () => {
    expect(formatLength(3759, 'metric')).toBe('3.76 m');
    expect(formatLength(1000, 'metric')).toBe('1 m');
  });

  it('trims trailing zeros in the meter form', () => {
    expect(formatLength(2500, 'metric')).toBe('2.5 m');
    expect(formatLength(4000, 'metric')).toBe('4 m');
  });

  it('stays in millimeters below one meter', () => {
    expect(formatLength(750, 'metric')).toBe('750 mm');
    expect(formatLength(0, 'metric')).toBe('0 mm');
  });
});

describe('formatLength — edge cases', () => {
  it('returns an em dash for non-finite input', () => {
    expect(formatLength(Number.NaN, 'metric')).toBe('—');
    expect(formatLength(Number.POSITIVE_INFINITY, 'imperial')).toBe('—');
  });

  it('drops the unit suffix in compact mode', () => {
    expect(formatLength(3759, 'metric', { compact: true })).toBe('3.76');
    expect(formatLength(750, 'metric', { compact: true })).toBe('750');
  });
});

describe('round trips', () => {
  // The property that matters: what we render, we can read back to the same
  // stored value (within imperial's 1/8" quantization).
  it.each([0, 1000, 2438, 3759, 3772, 5000, 12_700])(
    'imperial round trip for %imm',
    (mm) => {
      const text = formatLength(mm, 'imperial');
      const back = parseLength(text, 'imperial');
      expect(back).not.toBeNull();
      expect(Math.abs(back! - mm)).toBeLessThanOrEqual(Math.ceil(MM_PER_INCH / 8));
    },
  );

  it.each([0, 750, 1000, 2500, 3759, 12_700])('metric round trip for %imm', (mm) => {
    const text = formatLength(mm, 'metric');
    const back = parseLength(text, 'metric');
    expect(back).not.toBeNull();
    // Meters render to 2dp, so tolerate 5mm of display quantization.
    expect(Math.abs(back! - mm)).toBeLessThanOrEqual(5);
  });
});

describe('formatArea', () => {
  it('renders square feet', () => {
    const tenByTwelveFt = 10 * MM_PER_FOOT * (12 * MM_PER_FOOT);
    expect(formatArea(tenByTwelveFt, 'imperial')).toBe('120.0 sq ft');
  });

  it('renders square meters', () => {
    expect(formatArea(1_000_000 * 12, 'metric')).toBe('12.0 m²');
  });
});
