import { Injectable, Logger } from '@nestjs/common';
import { MicrosoftService } from '../auth/microsoft.service';
import { GraphAttachment, GraphMessage, GraphPage } from './graph-mapper';

const BASE = 'https://graph.microsoft.com/v1.0';
const SELECT =
  'id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,body,bodyPreview,hasAttachments,isDraft';
const MAX_RETRIES = 5;

/** El deltaLink guardado ya no es válido (410 Gone): hay que reiniciar el delta. */
export class DeltaExpiredError extends Error {}

export const MAIL_FOLDERS = ['inbox', 'sentitems'] as const;
export type MailFolder = (typeof MAIL_FOLDERS)[number];

export interface DeltaPage {
  messages: GraphMessage[];
  /** Presente solo en la última página. */
  deltaLink?: string;
}

@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);

  constructor(private readonly auth: MicrosoftService) {}

  /** Espera entre reintentos; se puede sustituir en tests. */
  sleep(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
  }

  /** GET con renovación de token en 401, y reintentos con Retry-After en 429/503/504. */
  async request(
    url: string,
    init: { raw?: boolean; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.auth.getAccessToken();
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, ...init.headers },
      });
      if (res.ok) return res;
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.auth.getAccessToken(true);
        continue;
      }
      if ([429, 503, 504].includes(res.status) && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        const waitMs =
          Number.isFinite(retryAfter) && res.headers.get('Retry-After') !== null
            ? retryAfter * 1000
            : Math.min(2 ** attempt * 1000, 30_000);
        this.logger.warn(`Graph ${res.status}; reintento en ${waitMs}ms`);
        await this.sleep(waitMs);
        continue;
      }
      if (res.status === 410) throw new DeltaExpiredError('deltaLink expirado');
      throw new Error(
        `Graph respondió ${res.status} en ${new URL(url).pathname}`,
      );
    }
  }

  private async json<T>(
    url: string,
    headers?: Record<string, string>,
  ): Promise<T> {
    return (await this.request(url, { headers })).json() as Promise<T>;
  }

  /**
   * Recorre las páginas del delta de una carpeta (inbox o sentitems). Con deltaLink continúa desde ahí;
   * sin él, empieza un delta completo. Lanza DeltaExpiredError si el link expiró.
   */
  async *deltaMessages(
    folder: MailFolder,
    deltaLink?: string | null,
  ): AsyncGenerator<DeltaPage> {
    let url =
      deltaLink ??
      `${BASE}/me/mailFolders/${folder}/messages/delta?$select=${SELECT}`;
    const headers = {
      Prefer: 'odata.maxpagesize=25, outlook.body-content-type="text"',
    };
    for (;;) {
      const page = await this.json<GraphPage<GraphMessage>>(url, headers);
      const next = page['@odata.nextLink'];
      yield { messages: page.value ?? [], deltaLink: page['@odata.deltaLink'] };
      if (!next) return;
      url = next;
    }
  }

  async listAttachments(messageId: string): Promise<GraphAttachment[]> {
    const out: GraphAttachment[] = [];
    let url: string | undefined =
      `${BASE}/me/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline`;
    while (url) {
      const page: GraphPage<GraphAttachment> = await this.json(url);
      out.push(...(page.value ?? []));
      url = page['@odata.nextLink'];
    }
    return out;
  }

  async downloadAttachment(
    messageId: string,
    attachmentId: string,
  ): Promise<Buffer> {
    const res = await this.request(
      `${BASE}/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`,
    );
    return Buffer.from(await res.arrayBuffer());
  }
}
