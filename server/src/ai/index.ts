import type { AiProvider } from './provider.js';
import { GeminiProvider } from './gemini.js';

export * from './provider.js';

let cached: AiProvider | null | undefined;

/**
 * The configured provider, or null when no key is set.
 *
 * Built once and reused: constructing a client per request is wasteful and
 * makes connection reuse impossible. `undefined` means "not yet resolved",
 * `null` means "resolved, and there is no provider" — the distinction keeps a
 * keyless setup from re-checking on every call.
 */
export function getProvider(): AiProvider | null {
  if (cached !== undefined) return cached;

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    cached = new GeminiProvider(geminiKey);
    return cached;
  }

  // Anthropic is a documented alternative but not implemented yet; saying so
  // beats silently behaving as though no key exists.
  if (process.env.ANTHROPIC_API_KEY) {
    console.warn(
      '[ai] ANTHROPIC_API_KEY is set but the Anthropic provider is not implemented yet; set GEMINI_API_KEY instead.',
    );
  }

  cached = null;
  return cached;
}

export function providerName(): 'gemini' | 'anthropic' | null {
  return getProvider()?.name ?? null;
}
