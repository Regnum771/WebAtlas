import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // '@/…' is for shadcn-generated files only; hand-written code uses relative imports.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [tailwindcss(), react()],
  // Root-absolute: the app always serves from the origin root, and BrowserRouter does hard
  // navigations (the OIDC callback, a refresh) to routes 2+ segments deep (/dang-nhap/xong,
  // /quan-ly/...). A relative base resolves ./assets/... against that deeper path instead of
  // root, so the built bundle 404s there and the app never boots.
  base: '/',
})
