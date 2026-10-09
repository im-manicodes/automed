import { Link } from 'react-router-dom'
import { LuArrowLeft } from 'react-icons/lu'
import { useConfigMicrosoft } from '../../hooks/useConfigMicrosoft'

export default function GuiaMicrosoft() {
  const { data } = useConfigMicrosoft()
  const direccion = data?.redirectUriSugerida ?? '<tu dirección>/api/auth/callback'
  const pasos: { titulo: string; texto: React.ReactNode }[] = [
    { titulo: 'Crea el registro', texto: <>Entra a entra.microsoft.com, ve a Aplicaciones, Registros de aplicaciones y pulsa «Nuevo registro». Ponle el nombre «auto-med» y elige cuentas de cualquier directorio y cuentas personales.</> },
    { titulo: 'Agrega la plataforma Web', texto: <>En Autenticación pulsa «Agregar plataforma», elige «Web» y pega esta dirección de redirección: <code className="break-all rounded bg-slate-50 p-1 text-sm">{direccion}</code></> },
    { titulo: 'Copia el ID de cliente', texto: <>En «Información general» copia el «Id. de aplicación (cliente)». El inquilino déjalo en «common».</> },
    { titulo: 'Da los permisos', texto: <>En Permisos de API, Microsoft Graph, Permisos delegados, agrega Mail.Read, User.Read y offline_access.</> },
    { titulo: 'Secreto (opcional)', texto: <>En «Certificados y secretos» crea un secreto nuevo y copia su «Valor» enseguida: solo se muestra una vez.</> },
    { titulo: 'Pega los datos', texto: <>Vuelve a Ajustes, pega el ID de cliente (y el secreto si lo creaste) y pulsa «Guardar». Después conecta tu Outlook.</> },
  ]
  return (
    <section className="space-y-5">
      <Link to="/ajustes" className="inline-flex min-h-11 items-center gap-1 text-blue-700 underline"><LuArrowLeft className="size-4" aria-hidden />Volver a Ajustes</Link>
      <h2 className="text-2xl font-bold">Guía rápida de Microsoft</h2>
      <p className="text-slate-700">Sigue estos pasos para que la app pueda leer tu correo de Outlook.</p>
      <ol className="space-y-3">
        {pasos.map((p, i) => (
          <li key={p.titulo} className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="font-bold">{i + 1}. {p.titulo}</h3>
            <p className="text-slate-700">{p.texto}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
