type ReqLike = { ip?: string };

/** IP del cliente para los límites de intentos (Express ya resuelve `trust proxy`). */
export function clientIp(req: ReqLike): string {
  return String(req.ip);
}
