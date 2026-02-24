import { defineConfig } from 'vite';
import path from 'node:path';
import { builtinModules } from 'node:module';

// https://vitejs.dev/config
// Build preload as CommonJS for Electron runtime compatibility.
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

export default defineConfig({
  resolve: {
    conditions: ['node'],
  },
  build: {
    target: 'node20',
    lib: {
      entry: 'src/preload.js',
      fileName: () => 'preload.js',
      formats: ['cjs'],
    },
    rollupOptions: {
      external: (id) => {
        if (id === 'electron') return true;
        if (builtins.has(id)) return true;
        if (id.startsWith('node:')) return true;
        if (id.startsWith('.') || path.isAbsolute(id)) return false;
        return true;
      },
    },
  },
});
