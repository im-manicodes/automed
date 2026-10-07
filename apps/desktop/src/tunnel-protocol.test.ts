import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('tunnel-protocol.ts es idéntico al protocolo del relay (apps/relay/src/protocol.ts)', () => {
  const a = readFileSync(join(__dirname, 'tunnel-protocol.ts'), 'utf8');
  const b = readFileSync(join(__dirname, '../../relay/src/protocol.ts'), 'utf8');
  expect(a).toBe(b);
});
