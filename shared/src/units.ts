/**
 * Length parsing and formatting.
 *
 * Every dimension in the app is stored as an integer number of **millimeters**.
 * Imperial vs. metric is purely a display and input concern, handled here and
 * nowhere else — no other module should divide by 25.4.
 */

export type UnitSystem = 'imperial' | 'metric';

export const MM_PER_INCH = 25.4;
export const MM_PER_FOOT = MM_PER_INCH * 12;

/** Multiplier from a recognized unit token to millimeters. */
const UNIT_TO_MM: Record<string, number> = {
  mm: 1,
  millimeter: 1,
  millimeters: 1,
  cm: 10,
  centimeter: 10,
  centimeters: 10,
  m: 1000,
  meter: 1000,
  meters: 1000,
  metre: 1000,
  metres: 1000,
  '"': MM_PER_INCH,
  in: MM_PER_INCH,
  inch: MM_PER_INCH,
  inches: MM_PER_INCH,
  "'": MM_PER_FOOT,
  ft: MM_PER_FOOT,
  foot: MM_PER_FOOT,
  feet: MM_PER_FOOT,
};

const FEET_UNITS = new Set(["'", 'ft', 'foot', 'feet']);

/**
 * One numeric token plus its optional trailing unit.
 *
 * The number may be a decimal (`4.5`), a bare fraction (`1/2`), or a mixed
 * fraction (`4 1/2` or `4-1/2`). Written with the `x` flag equivalent expanded
 * for readability:
 *
 *   ( \d+/\d+  |  \d+(\.\d+)? ( [-\s]+ \d+/\d+ )? )   \s*   (unit)?
 *
 * Both alternation groups are ordered longest-match-first, because JS regex
 * alternation is first-win rather than greedy:
 *
 *  - the bare fraction must precede the decimal branch, or `1/2"` matches just
 *    the `1` and leaves `/` behind as unparsed garbage;
 *  - `m` must come after `metres`, or "meters" matches the bare `m` and leaves
 *    "eters" behind.
 */
const TOKEN_RE =
  /(\d+\/\d+|\d+(?:\.\d+)?(?:[-\s]+\d+\/\d+)?)\s*(millimeters?|mm|centimeters?|cm|met(?:er|re)s?|m|in(?:ch(?:es)?)?|"|feet|foot|ft|')?/g;

/** Turn `4`, `4.5`, `1/2`, `4 1/2`, or `4-1/2` into a number. */
function parseNumeric(raw: string): number | null {
  const mixed = raw.match(/^(\d+(?:\.\d+)?)[-\s]+(\d+)\/(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const num = Number(mixed[2]);
    const den = Number(mixed[3]);
    if (den === 0) return null;
    return whole + num / den;
  }

  const frac = raw.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const den = Number(frac[2]);
    if (den === 0) return null;
    return Number(frac[1]) / den;
  }

  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a free-form length into millimeters, or `null` if it can't be read.
 *
 * Accepts, among others:
 *   12'4"   12' 4 1/2"   12ft 4in   148"   148in   12.5ft
 *   3759    3759mm       375.9cm    3.76m
 *
 * A number with no unit follows `system`: inches under imperial (people type
 * "96" for a 96-inch sofa), millimeters under metric. The exception is a second
 * unitless token after a feet value — `12' 4` means 4 inches, not 4 of whatever
 * the display mode is.
 *
 * Parsing is strict: anything left over after the recognized tokens (a stray
 * word, a second unit, punctuation) rejects the whole input rather than
 * silently reading a prefix.
 */
export function parseLength(input: string, system: UnitSystem): number | null {
  if (typeof input !== 'string') return null;

  // Normalize typographic quotes and primes to their ASCII equivalents, and
  // collapse whitespace. ′/″ are the prime marks; ‘-” are
  // the curly quotes a browser or a pasted spec sheet may hand us.
  const normalized = input
    .toLowerCase()
    .replace(/[′‘’´`]/g, "'")
    .replace(/[″“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized === '') return null;
  if (normalized.startsWith('-')) return null; // negative lengths are meaningless

  let totalMm = 0;
  let sawFeet = false;
  let tokenCount = 0;

  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(normalized)) !== null) {
    const [, numberPart, unitPart] = match;

    const value = parseNumeric(numberPart!.trim());
    if (value === null) return null;

    let mmPerUnit: number;
    if (unitPart) {
      const factor = UNIT_TO_MM[unitPart];
      if (factor === undefined) return null;
      mmPerUnit = factor;
      if (FEET_UNITS.has(unitPart)) sawFeet = true;
    } else if (tokenCount > 0 && sawFeet) {
      mmPerUnit = MM_PER_INCH; // the inches half of a feet-inches pair
    } else {
      mmPerUnit = system === 'imperial' ? MM_PER_INCH : 1;
    }

    totalMm += value * mmPerUnit;
    tokenCount += 1;
  }

  if (tokenCount === 0) return null;

  // Strict check: everything that wasn't a token must be separators.
  const leftover = normalized.replace(TOKEN_RE, '').replace(/\s/g, '');
  if (leftover !== '') return null;

  if (!Number.isFinite(totalMm) || totalMm < 0) return null;
  return Math.round(totalMm);
}

/** Reduce `n/8` to lowest terms, e.g. 4/8 -> 1/2, 6/8 -> 3/4. */
function reduceEighths(eighths: number): [number, number] {
  let num = eighths;
  let den = 8;
  while (num % 2 === 0 && den % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  return [num, den];
}

export interface FormatOptions {
  /** Imperial rounding granularity as a denominator: 8 = nearest 1/8". Default 8. */
  fractionDenominator?: 2 | 4 | 8 | 16;
  /** Omit the unit suffix — for compact canvas labels. Default false. */
  compact?: boolean;
}

/**
 * Render millimeters for display.
 *
 *   imperial -> 12' 4 1/2"   |   4 1/2"   |   12'
 *   metric   -> 3.76 m       |   750 mm
 *
 * Imperial values snap to the nearest 1/8" by default, matching how furniture
 * and construction dimensions are actually quoted. The rounding carries
 * properly: 11.99" renders as 1', not 0' 12".
 */
export function formatLength(
  mm: number,
  system: UnitSystem,
  options: FormatOptions = {},
): string {
  if (!Number.isFinite(mm)) return '—';

  const negative = mm < 0;
  const abs = Math.abs(mm);
  const sign = negative ? '-' : '';

  if (system === 'metric') {
    if (abs >= 1000) {
      // Trim trailing zeros: 3.76 m, 4 m, 2.5 m
      const meters = (abs / 1000).toFixed(2).replace(/\.?0+$/, '');
      return options.compact ? `${sign}${meters}` : `${sign}${meters} m`;
    }
    const rounded = Math.round(abs);
    return options.compact ? `${sign}${rounded}` : `${sign}${rounded} mm`;
  }

  const den = options.fractionDenominator ?? 8;
  const ticks = Math.round((abs / MM_PER_INCH) * den);
  const totalInches = Math.floor(ticks / den);
  const remainder = ticks % den;

  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;

  // Normalize the remainder to eighths-style reduction regardless of `den`.
  let fractionLabel = '';
  if (remainder > 0) {
    const scaled = (remainder * 8) / den;
    if (Number.isInteger(scaled)) {
      const [n, d] = reduceEighths(scaled);
      fractionLabel = `${n}/${d}`;
    } else {
      fractionLabel = `${remainder}/${den}`;
    }
  }

  const parts: string[] = [];
  if (feet > 0) parts.push(`${feet}'`);

  if (inches > 0 || fractionLabel) {
    const inchText = [inches > 0 ? String(inches) : '', fractionLabel]
      .filter(Boolean)
      .join(' ');
    parts.push(`${inchText}"`);
  }

  if (parts.length === 0) return '0"';
  return sign + parts.join(' ');
}

/**
 * Convenience for area readouts (room square footage / square meters).
 */
export function formatArea(mm2: number, system: UnitSystem): string {
  if (!Number.isFinite(mm2)) return '—';
  if (system === 'metric') {
    return `${(mm2 / 1_000_000).toFixed(1)} m²`;
  }
  const sqft = mm2 / (MM_PER_FOOT * MM_PER_FOOT);
  return `${sqft.toFixed(1)} sq ft`;
}

/** The grid step a new project starts on: 1 inch, or 10 mm. */
export function defaultGridStep(system: UnitSystem): number {
  return system === 'imperial' ? Math.round(MM_PER_INCH) : 10;
}
