import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // DB-ზე ავტორიზებული HTTP round-trip-ები — default 5წ ხანდახან
    // მჭირდია, განსაკუთრებით Neon branch-ის cold-start-ზე.
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
