import { defineConfig } from 'vite';
import path from 'node:path';
import { builtinModules } from 'node:module';

// https://vitejs.dev/config
// Output .cjs so Electron loads as CommonJS (package.json has "type": "module")
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

export default defineConfig({
  resolve: {
    conditions: ['node'],
  },
  build: {
    target: 'node20',
    lib: {
      entry: 'src/main.js',
      fileName: () => '[name].cjs',
      formats: ['cjs'],
    },
    rollupOptions: {
      // Keep Node/Electron modules external for desktop runtime.
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
