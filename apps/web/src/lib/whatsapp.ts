/** Enlace para abrir WhatsApp con el texto ya escrito (wa.me tolera ~2000 caracteres de URL). */
export const WHATSAPP_MAX_URL_TEXT = 1500
export function enlaceWhatsApp(texto: string): string | null {
  const encoded = encodeURIComponent(texto)
  return encoded.length <= WHATSAPP_MAX_URL_TEXT ? `https://wa.me/?text=${encoded}` : null
}
