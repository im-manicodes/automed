import { resolve } from 'node:path';
import { bootstrapHashes } from './bootstrap-hash';
import { DEFAULT_BOOTSTRAP_DIR, createRelayServer } from './server';

const env = process.env;
const { server } = createRelayServer({
  dataDir: resolve(env.RELAY_DATA_DIR ?? './data'),
  // Solo el arranque (apps/relay/bootstrap); el front lo entrega el escritorio por el canal cifrado.
  bootstrapDir: env.BOOTSTRAP_DIR ? resolve(env.BOOTSTRAP_DIR) : undefined,
  // Con HTTPS delante (lo normal) las cookies llevan Secure; RELAY_COOKIE_SECURE=0 solo para pruebas.
  cookieSecure: env.RELAY_COOKIE_SECURE !== '0',
  // Si se define, solo escritorios con este token pueden registrar deviceIds nuevos.
  registrationToken: env.RELAY_REGISTRATION_TOKEN || undefined,
  trustProxy: env.RELAY_TRUST_PROXY === '1',
  log: (l) => console.log(l),
});

console.log(`arranque sha256 ${bootstrapHashes(env.BOOTSTRAP_DIR ? resolve(env.BOOTSTRAP_DIR) : DEFAULT_BOOTSTRAP_DIR).combined}`);
const port = Number(env.PORT ?? 8080);
server.listen(port, env.HOST ?? '0.0.0.0', () => console.log(`auto-med relay escuchando en :${port}`));
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => server.close(() => process.exit(0)));
