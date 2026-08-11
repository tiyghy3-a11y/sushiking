import { Hono } from 'hono';
import type { Env } from './db/types';
import { activities } from './routes/activities';
import { batches } from './routes/batches';
import { contributors } from './routes/contributors';
import { images } from './routes/images';
import { mountains } from './routes/mountains';
import { photos } from './routes/photos';
import { progress } from './routes/progress';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true }));

app.route('/api/mountains', mountains);
app.route('/api/activities', activities);
app.route('/api/photos', photos);
app.route('/api/contributors', contributors);
app.route('/api/import-batches', batches);
app.route('/api/progress', progress);
app.route('/img', images);

app.notFound((c) =>
  c.req.path.startsWith('/api/') ? c.json({ error: 'not found' }, 404) : c.env.ASSETS.fetch(c.req.raw),
);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || 'internal error' }, 500);
});

export default app;
