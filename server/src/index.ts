import { createApp } from './app.js';
import { env } from './env.js';

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`BlindNav server listening on http://127.0.0.1:${env.PORT}`);
});
