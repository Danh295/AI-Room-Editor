import { describe, expect, it } from 'vitest';
import { isTextEntry, ownsSpace } from './keyboard.js';

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

describe('ownsSpace', () => {
  it('gives Space to a focused button, which is not text entry', () => {
    // The regression: Space-to-pan used to swallow Space on every button.
    const button = el('BUTTON', { matches: true });
    expect(isTextEntry(button)).toBe(false);
    expect(ownsSpace(button)).toBe(true);
  });

  it('gives Space to text fields', () => {
    expect(ownsSpace(el('INPUT'))).toBe(true);
  });

  it('leaves Space free on the page body and the canvas', () => {
    expect(ownsSpace(el('BODY'))).toBe(false);
    expect(ownsSpace(el('CANVAS'))).toBe(false);
    expect(ownsSpace(null)).toBe(false);
  });
});
