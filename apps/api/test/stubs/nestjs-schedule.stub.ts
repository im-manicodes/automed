/* eslint-disable @typescript-eslint/no-unused-vars */
// @nestjs/schedule v12 es ESM-only; stub mínimo para tests en Jest (CJS).
export class SchedulerRegistry {
  addInterval(_name: string, _timer: unknown): void {}
  doesExist(_type: string, _name: string): boolean {
    return false;
  }
  deleteInterval(_name: string): void {}
}
