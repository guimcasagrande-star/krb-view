import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      // xmlbuilder2 (via vtk.js) importa o módulo `events` do Node.
      events: fileURLToPath(new URL('./src/viewer/shims/events.ts', import.meta.url)),
    },
  },
  // O dicom-image-loader cria seus workers com new URL(..., import.meta.url);
  // o pré-empacotamento do Vite quebraria esse caminho.
  optimizeDeps: {
    exclude: ['@cornerstonejs/dicom-image-loader'],
    include: [
      'dicom-parser',
      // Uma única cópia: o loader (fora do pré-empacotamento) e o core precisam compartilhar
      // o mesmo registro de provedores de metadados.
      '@cornerstonejs/metadata',
      // Codecs em CommonJS/UMD: precisam virar ESM para o loader importar o default.
      '@cornerstonejs/codec-openjph/wasmjs',
      '@cornerstonejs/codec-openjpeg/decodewasmjs',
      '@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs',
      '@cornerstonejs/codec-charls/decodewasmjs',
      '@cornerstonejs/codec-libjxl/decodewasmjs',
    ],
  },
  worker: { format: 'es' },
});
