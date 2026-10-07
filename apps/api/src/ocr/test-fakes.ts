import { EventEmitter } from 'events';
import type { ProcessRunner, SpawnedProcess } from './process-runner';

/** Proceso hijo simulado para tests: emite salida y termina a demanda. */
export class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill() {
    this.killed = true;
    this.emit('exit', null, 'SIGTERM');
    return true;
  }
  out(text: string) {
    this.stdout.emit('data', Buffer.from(text));
  }
  err(text: string) {
    this.stderr.emit('data', Buffer.from(text));
  }
  end(code: number) {
    this.stdout.emit('end');
    this.stderr.emit('end');
    this.emit('exit', code, null);
  }
}

export function fakeRunner(over: Partial<ProcessRunner> = {}) {
  const children: FakeChild[] = [];
  const spawnCalls: { cmd: string; args: string[]; opts: any }[] = [];
  const runner: ProcessRunner = {
    execFile: jest.fn().mockRejectedValue(new Error('ENOENT')),
    spawn: jest.fn((cmd, args, opts) => {
      const c = new FakeChild();
      children.push(c);
      spawnCalls.push({ cmd, args, opts });
      return c as unknown as SpawnedProcess;
    }),
    freePort: jest.fn().mockResolvedValue(45678),
    health: jest.fn().mockResolvedValue({ ok: true, fallbackReason: null }),
    ...over,
  };
  return { runner, children, spawnCalls };
}
