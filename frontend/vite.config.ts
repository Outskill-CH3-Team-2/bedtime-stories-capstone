import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, path.resolve(__dirname, '../'), '');
    
    const frontendPort = parseInt(env.FRONTEND_PORT || '3000', 10); 
    const backendUrl = env.VITE_BACKEND_URL || `http://localhost:${env.BACKEND_PORT || '8000'}`;

    return {
      envDir: '../',
      server: {
        port: frontendPort, 
        strictPort: true, 
        host: '0.0.0.0',
      },
      plugins: [
        tailwindcss(), 
        react(),
        // NEW: Inject the dynamic backend URL into index.html
        {
          name: 'html-transform',
          transformIndexHtml(html) {
            return html.replace(/%VITE_BACKEND_URL%/g, backendUrl);
          }
        }
      ],
      define: {
        'import.meta.env.VITE_BACKEND_URL': JSON.stringify(backendUrl),
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});