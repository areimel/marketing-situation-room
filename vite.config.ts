import { defineConfig, type Plugin } from 'vite';
import headlines from './api/agency-headlines.js';

function agencyApi(): Plugin {
  const serve: NonNullable<Plugin['configureServer']> = server => {
    server.middlewares.use('/api/agency-headlines', async (req, res) => {
      const response = await headlines(new Request('http://localhost/api/agency-headlines', { method: req.method }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    });
  };
  return { name: 'agency-headlines', configureServer: serve, configurePreviewServer: serve };
}

export default defineConfig({
  plugins: [agencyApi()],
  build: { target: 'es2020' },
});
