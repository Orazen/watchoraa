import { defineConfig } from 'vitest/config';

// Root vitest runs the frontend unit tests only (src/). The server has its
// own test suite + DATABASE_URL requirements and is run via `cd server && npm test`.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['server/**', 'node_modules/**', 'dist/**'],
  },
});
