import { useEffect, useRef, useState } from 'react';
import type { UnitSystem } from '@room/shared';
import { formatLength, parseLength } from '@room/shared';

export interface LengthInputProps {
  /** Current value in millimeters. */
  value: number;
  units: UnitSystem;
  onCommit: (mm: number) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
  placeholder?: string;
  'aria-label'?: string;
}

/**
 * A text field that speaks whatever the user types.
 *
 * It shows a formatted length, accepts free-form input on edit (12'4",
 * 148in, 3759, 3.76m), and only commits on blur or Enter — so a value isn't
 * mangled halfway through typing. Unparseable input is flagged inline and
 * simply not committed, rather than silently resolving to zero.
 *
 * It only ever writes back what the user actually entered. The displayed text
 * is rounded — to the nearest 1/8" in imperial — so parsing it back is lossy:
 * 5000 mm shows as 16' 4 7/8" and reads back as 5001. Committing unedited text
 * on blur meant that merely focusing the field and leaving it changed the
 * value, and selecting a wall (whose length field auto-focuses) and clicking
 * away lengthened it by a millimetre.
 */
export default function LengthInput({
  value,
  units,
  onCommit,
  onCancel,
  autoFocus,
  disabled,
  placeholder,
  'aria-label': ariaLabel,
}: LengthInputProps) {
  const [text, setText] = useState(() => formatLength(value, units));
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);

  /*
    The text the field was showing before the user touched it. Anything still
    equal to it was never entered, so it's never written back. Kept current
    whenever the field isn't being edited rather than only snapshotted on
    focus, so it's right even for a field that was focused before any focus
    handler had a chance to run (autoFocus on mount).
  */
  const shown = useRef(text);

  /*
    Set when Enter or Escape has already dealt with the edit. Both finish by
    blurring the field, and without this the blur handled it again: Enter
    committed twice, and Escape — whose reset hadn't rendered yet when the
    blur fired — committed the very text it was meant to throw away.
  */
  const settled = useRef(false);

  // Re-sync when the underlying value or unit system changes, but never while
  // the user is mid-edit — that would rewrite what they're typing.
  useEffect(() => {
    if (editing) return;
    const formatted = formatLength(value, units);
    setText(formatted);
    shown.current = formatted;
  }, [value, units, editing]);

  /** Returns false only for text that can't be read as a length. */
  function commit(): boolean {
    if (text.trim() === shown.current.trim()) {
      // Nothing entered, so nothing to write.
      setInvalid(false);
      return true;
    }
    const parsed = parseLength(text, units);
    if (parsed === null) {
      setInvalid(true);
      return false;
    }
    setInvalid(false);
    onCommit(parsed);
    const formatted = formatLength(parsed, units);
    setText(formatted);
    shown.current = formatted;
    return true;
  }

  return (
    <input
      className={invalid ? 'length-input invalid' : 'length-input'}
      value={text}
      disabled={disabled}
      autoFocus={autoFocus}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      onFocus={(e) => {
        setEditing(true);
        settled.current = false;
        shown.current = e.target.value;
        e.target.select();
      }}
      onChange={(e) => {
        setText(e.target.value);
        if (invalid) setInvalid(false);
      }}
      onBlur={() => {
        setEditing(false);
        if (settled.current) {
          settled.current = false;
          return;
        }
        if (!commit()) setText(formatLength(value, units));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (commit()) {
            settled.current = true;
            (e.target as HTMLInputElement).blur();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          settled.current = true;
          setInvalid(false);
          setText(formatLength(value, units));
          setEditing(false);
          onCancel?.();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
