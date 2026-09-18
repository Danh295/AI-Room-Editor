import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The store is plain TypeScript; the pieces under test here deliberately
    // don't touch the DOM, so there's no reason to pay for jsdom.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
