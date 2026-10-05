import type { Request } from 'express';

export interface AuthUser {
  id: string;
  email: string;
  nombre: string;
}

export type AuthedRequest = Request & { user?: AuthUser };
