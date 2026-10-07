import qrcode from 'qrcode-generator'
import { useMemo } from 'react'

/** QR (imagen SVG en data URL) de un texto; se genera en el navegador, sin pedir nada a internet. */
export default function CodigoQr({ texto, alt }: { texto: string; alt: string }) {
  const src = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(texto)
    qr.make()
    return qr.createDataURL(6, 8)
  }, [texto])
  return <img src={src} alt={alt} width={240} height={240} className="mx-auto size-60 rounded-lg bg-white" />
}
