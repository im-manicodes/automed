/** Contrato de GET /api/attachments/:id/pages (apps/api/src/attachments). */
export type RegionStatus = 'dudoso' | 'corregido' | 'ok';

export interface ApiRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  confidence: number;
  status: RegionStatus;
  textoUsuario: string | null;
}

export interface ApiPage {
  pageNumber: number;
  width: number;
  height: number;
  imageUrl: string;
  regions: ApiRegion[];
}

export interface ApiPagesResponse {
  attachmentId: string;
  filename: string;
  status: string;
  pages: ApiPage[];
}

export interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Una duda del flujo, con la página a la que pertenece. */
export interface Duda {
  id: string;
  pageNumber: number;
  bbox: Bbox;
  /** Lectura sugerida por el OCR (puede venir vacía). */
  sugerencia: string;
  /** Texto ya corregido en una sesión anterior (si existe). */
  textoGuardado: string | null;
}
