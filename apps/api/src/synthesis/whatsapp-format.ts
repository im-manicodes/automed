/** Saneado final del texto que redacta el LLM para pegarlo en WhatsApp. */

export const WHATSAPP_MAX_CHARS = 1200;

/** Deja solo formato WhatsApp (*negrita*, _cursiva_, viñetas «•»), sin encabezados ni tablas. */
export function sanearParaWhatsApp(
  raw: string,
  max = WHATSAPP_MAX_CHARS,
): string {
  let text = raw.replace(/\r\n?/g, '\n').trim();
  const fence = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(text);
  if (fence) text = fence[1];
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(line))
      continue;
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
      l = l
        .replace(/\*\*(?=\S)([^\n]+?)(?<=\S)\*\*/g, '*$1*')
        .replace(/__(?=\S)([^\n]+?)(?<=\S)__/g, '*$1*');
      l = l.replace(
        /\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g,
        (_m, t: string, u: string) => (t === u ? u : `${t} (${u})`),
      );
    }
    out.push(l.trimEnd());
  }
  text = out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length > max) {
    const cut = text.slice(0, max);
    const nl = cut.lastIndexOf('\n');
    text =
      (nl > max * 0.6
        ? cut.slice(0, nl)
        : cut.replace(/\s+\S*$/, '')
      ).trimEnd() + '\n…';
  }
  return text;
}
