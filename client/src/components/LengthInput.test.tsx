// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import LengthInput from './LengthInput.js';

afterEach(cleanup);

/*
  5000 mm doesn't survive the imperial display: it shows as 16' 4 7/8" and
  parses back as 5001. Any value like it exposes a write the user never made,
  which is the whole bug — selecting a wall and clicking away lengthened it.
*/
const LOSSY_MM = 5000;

function setup({ autoFocus = false } = {}) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const { getByLabelText } = render(
    <LengthInput
      value={LOSSY_MM}
      units="imperial"
      onCommit={onCommit}
      onCancel={onCancel}
      autoFocus={autoFocus}
      aria-label="Length"
    />,
  );
  const input = getByLabelText('Length') as HTMLInputElement;
  return { input, onCommit, onCancel };
}

/** Type into the field the way React sees it: a change event with a new value. */
function type(input: HTMLInputElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
}

describe('LengthInput', () => {
  it('writes nothing when focused and left without an edit', () => {
    const { input, onCommit } = setup();

    act(() => input.focus());
    act(() => input.blur());

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('writes nothing when an auto-focused field is left without an edit', () => {
    // The exact path from the report: selecting a wall auto-focuses its
    // Length field, and clicking anywhere else blurred it into a commit.
    const { input, onCommit } = setup({ autoFocus: true });
    expect(document.activeElement).toBe(input);

    act(() => input.blur());

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('writes nothing when Enter is pressed without an edit', () => {
    const { input, onCommit } = setup();

    act(() => input.focus());
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('treats typing back exactly what was shown as no change', () => {
    const { input, onCommit } = setup();
    const shown = input.value;

    act(() => input.focus());
    type(input, '1');
    type(input, shown);
    act(() => input.blur());

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits a real edit once, on blur', () => {
    const { input, onCommit } = setup();

    act(() => input.focus());
    type(input, "20'");
    act(() => input.blur());

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(6096);
  });

  it('commits a real edit exactly once on Enter, even though Enter also blurs', () => {
    const { input, onCommit } = setup();

    act(() => input.focus());
    type(input, "20'");
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(6096);
    expect(document.activeElement).not.toBe(input);
  });

  it('throws the edit away on Escape instead of committing it', () => {
    const { input, onCommit, onCancel } = setup();
    const shown = input.value;

    act(() => input.focus());
    type(input, "20'");
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(input.value).toBe(shown);
  });

  it('refuses unparseable input and restores what was shown', () => {
    const { input, onCommit } = setup();
    const shown = input.value;

    act(() => input.focus());
    type(input, 'banana');
    act(() => input.blur());

    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe(shown);
  });
});
