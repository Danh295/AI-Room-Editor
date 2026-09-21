import { describe, expect, it } from 'vitest';
import { isTextEntry } from './keyboard.js';

/** A stand-in element: enough of the DOM surface for the rules to read. */
function el(
  tagName: string,
  opts: { editable?: boolean; matches?: boolean } = {},
): EventTarget {
  return {
    tagName,
    isContentEditable: opts.editable ?? false,
    closest: () => (opts.matches ? {} : null),
  } as unknown as EventTarget;
}

describe('isTextEntry', () => {
  it('is true for the fields a user types into', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(isTextEntry(el(tag))).toBe(true);
    }
  });

  it('is true for contentEditable regions', () => {
    expect(isTextEntry(el('DIV', { editable: true }))).toBe(true);
  });

  it('is false for everything else, including buttons and no target', () => {
    expect(isTextEntry(el('BUTTON'))).toBe(false);
    expect(isTextEntry(el('DIV'))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});
