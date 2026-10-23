import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  // İki preload: arayüz köprüsü ve eklenti penceresinin yalnızca port ileten preload'u
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: 'src/preload/index.js', plugin: 'src/preload/plugin.js' }
      }
    }
  },
  renderer: { plugins: [react()] }
});
