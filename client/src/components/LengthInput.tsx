import { useEffect, useState } from 'react';
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

  // Re-sync when the underlying value or unit system changes, but never while
  // the user is mid-edit — that would rewrite what they're typing.
  useEffect(() => {
    if (!editing) setText(formatLength(value, units));
  }, [value, units, editing]);

  function commit() {
    const parsed = parseLength(text, units);
    if (parsed === null) {
      setInvalid(true);
      return false;
    }
    setInvalid(false);
    onCommit(parsed);
    setText(formatLength(parsed, units));
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
        e.target.select();
      }}
      onChange={(e) => {
        setText(e.target.value);
        if (invalid) setInvalid(false);
      }}
      onBlur={() => {
        setEditing(false);
        if (!commit()) setText(formatLength(value, units));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (commit()) (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
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
