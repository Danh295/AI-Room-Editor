/**
 * Who a keypress belongs to.
 *
 * Every window-level shortcut handler has to ask the same question — is this
 * key meant for the element that has focus, or for us? — and when the answer
 * lived inline in each handler the copies drifted apart. One definition here.
 *
 * Duck-typed rather than `instanceof HTMLElement`, so the rules are testable
 * without a DOM.
 */

interface ElementLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

/** Focus is somewhere the user types, so letters and Space are text. */
export function isTextEntry(target: EventTarget | null): boolean {
  const el = target as ElementLike | null;
  if (!el) return false;
  if (el.tagName && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
  return Boolean(el.isContentEditable);
}
