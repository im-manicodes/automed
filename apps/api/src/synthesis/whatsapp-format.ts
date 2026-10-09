/** Saneado final del texto que redacta el LLM para pegarlo en WhatsApp. */

export const WHATSAPP_MAX_CHARS = 3500;

/**
 * Deja solo formato WhatsApp (*negrita*, _cursiva_, `código`, bloques ```, viñetas «•»),
 * sin encabezados ni tablas. Los bloques ``` se conservan tal cual.
 */
export function sanearParaWhatsApp(
  raw: string,
  max = WHATSAPP_MAX_CHARS,
): string {
  let text = raw.replace(/\r\n?/g, '\n').trim();
  // Si TODO el mensaje viene envuelto en una cerca, se desenvuelve.
  const fence = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(text);
  if (fence && !fence[1].includes('```')) text = fence[1];
  const out: string[] = [];
  let inBlock = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      inBlock = !inBlock;
      out.push(line.trim().startsWith('```') ? '```' : line.trimEnd());
      continue;
    }
    if (inBlock) {
      out.push(line.trimEnd());
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) continue;
    if (/^\s*\|[\s|:-]+\|\s*$/.test(line)) continue; // separador de tabla
    let l = line.replace(/<!--[\s\S]*?-->/g, '');
    const h = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/.exec(l);
    if (h) l = `*${h[1].replace(/[*_]/g, '').trim()}*`;
    else if (/^\s*\|.*\|\s*$/.test(l))
      l =
        '• ' +
        l
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim())
          .filter(Boolean)
          .join(' | ');
    else {
      l = l.replace(/^(\s*)[-*+]\s+/, '$1• ');
      // No tocar el contenido de `código` en línea al convertir marcas.
      l = l
        .split(/(`[^`\n]*`)/)
        .map((part, i) =>
          i % 2 === 1
            ? part
            : part
                .replace(/\*\*(?=\S)([^\n]+?)(?<=\S)\*\*/g, '*$1*')
                .replace(/__(?=\S)([^\n]+?)(?<=\S)__/g, '_$1_')
                .replace(
                  /\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g,
                  (_m, t: string, u: string) => (t === u ? u : `${t} (${u})`),
                ),
        )
        .join('');
    }
    out.push(l.trimEnd());
  }
  if (inBlock) out.push('```'); // cerrar bloque abierto
  text = out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > max ? cortarEnParrafo(text, max) : text;
}

/** Corta en límite de párrafo (o de línea) sin dejar bloques ``` abiertos. */
function cortarEnParrafo(text: string, max: number): string {
  const cut = text.slice(0, max);
  const candidates = [cut.lastIndexOf('\n\n'), cut.lastIndexOf('\n')];
  let res = '';
  for (const idx of candidates) {
    if (idx > max * 0.5) {
      res = cut.slice(0, idx);
      break;
    }
  }
  if (!res) res = cut.replace(/\s+\S*$/, '');
  // Si el corte dejó un bloque ``` abierto, se descarta desde su apertura.
  const fences = res.match(/^```/gm)?.length ?? 0;
  if (fences % 2 === 1) res = res.slice(0, res.lastIndexOf('```'));
  return res.trimEnd() + '\n…';
}
