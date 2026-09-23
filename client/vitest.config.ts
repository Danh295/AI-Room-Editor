import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node by default: the store and the keyboard rules are plain TypeScript
    // and don't need a DOM. Component tests opt into jsdom per file with a
    // `@vitest-environment jsdom` docblock, so only they pay for it.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
