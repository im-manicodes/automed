import { useState } from 'react'
import type { IconType } from 'react-icons'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useSession } from '../context/session-context'
import CambiarPasswordDialog from './CambiarPasswordDialog'
import { LuClipboardList, LuFileText, LuSettings, LuUser } from 'react-icons/lu'

const items: { to: string; label: string; icon: IconType }[] = [
  { to: '/tickets', label: 'Tickets', icon: LuClipboardList },
  { to: '/plantilla', label: 'Plantillas', icon: LuFileText },
  { to: '/ajustes', label: 'Ajustes', icon: LuSettings },
]

function UserMenu({ enSidebar = false }: { enSidebar?: boolean }) {
  const { session, logout } = useSession()
  const [open, setOpen] = useState(false)
  const [changing, setChanging] = useState(false)
  if (session.status !== 'authenticated') return null
  return (
    <div className="relative">
      <button type="button" className={`btn btn-secondary gap-2 !min-h-11 !px-3 !py-1.5 text-sm ${enSidebar ? 'w-full justify-start' : ''}`} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
        <LuUser className="size-5 shrink-0" aria-hidden />Mi cuenta
      </button>
      {open && (
        <div role="menu" className={`absolute z-40 w-64 space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-lg ${enSidebar ? 'bottom-full left-0 mb-2' : 'right-0 mt-2'}`}>
          <p className="text-base font-semibold">{session.user.nombre}</p>
          <p className="break-all text-sm text-slate-700">{session.user.email}</p>
          <button type="button" role="menuitem" className="btn btn-secondary w-full" onClick={() => { setOpen(false); setChanging(true) }}>Cambiar contraseña</button>
          <button type="button" role="menuitem" className="btn btn-secondary w-full" onClick={() => void logout()}>Salir</button>
        </div>
      )}
      {changing && <CambiarPasswordDialog onClose={() => setChanging(false)} />}
    </div>
  )
}

/** La revisión de dudas aprovecha todo el ancho disponible en tablet/escritorio; el resto de páginas usa un ancho de lectura. */
const RUTA_REVISION = /^\/tickets\/[^/]+\/revision\/[^/]+/
/** El detalle de un ticket también ocupa todo el ancho (resumen a la izquierda, panel a la derecha). */
const RUTA_DETALLE = /^\/tickets\/[^/]+\/?$/

export default function Layout() {
  const { pathname } = useLocation()
  const ancho = RUTA_REVISION.test(pathname)
    ? 'max-w-3xl md:max-w-7xl'
    : RUTA_DETALLE.test(pathname)
      ? 'max-w-3xl md:max-w-none'
      : 'max-w-3xl md:max-w-5xl'
  return (
    <div className="min-h-dvh">
      {/* >= md: barra lateral fija */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-48 flex-col border-r border-slate-200 bg-white md:flex lg:w-60">
        <h1 className="px-5 py-5 text-xl font-bold">Automed</h1>
        <nav aria-label="Principal" className="flex-1 px-3">
          <ul className="space-y-1">
            {items.map((i) => (
              <li key={i.to}>
                <NavLink
                  to={i.to}
                  className={({ isActive }) =>
                    `flex min-h-12 items-center gap-3 rounded-xl px-3 text-base font-medium ${
                      isActive ? 'bg-blue-50 font-semibold text-blue-800' : 'text-slate-700 hover:bg-slate-100'
                    }`
                  }
                >
                  <i.icon className="size-6" aria-hidden />
                  {i.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-slate-200 p-3">
          <UserMenu enSidebar />
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col md:pl-48 lg:pl-60">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 md:hidden">
          <h1 className="text-xl font-bold">Automed</h1>
          <UserMenu />
        </header>
        <main className={`mx-auto w-full flex-1 p-4 pb-28 md:p-6 md:pb-6 ${ancho}`}>
          <Outlet />
        </main>
      </div>

      {/* < md: barra inferior */}
      <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white md:hidden">
        <ul className="mx-auto flex max-w-3xl">
          {items.map((i) => (
            <li key={i.to} className="flex-1">
              <NavLink
                to={i.to}
                className={({ isActive }) =>
                  `flex min-h-14 flex-col items-center justify-center text-sm font-medium ${
                    isActive ? 'text-blue-700 underline underline-offset-4' : 'text-slate-700'
                  }`
                }
              >
                <i.icon className="size-6" aria-hidden />
                {i.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
