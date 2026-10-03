import {defineConfig} from 'vite';
import {resolve} from 'node:path';
export default defineConfig({base:'./',build:{rollupOptions:{input:{prototype:resolve(import.meta.dirname,'index.html'),desktop:resolve(import.meta.dirname,'desktop.html'),capture:resolve(import.meta.dirname,'capture.html')}}}});
