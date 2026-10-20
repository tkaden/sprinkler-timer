import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: { include: ['site/**/*.js', 'scripts/**/*.mjs'], reporter: ['text'] },
  },
});
