import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useSession } from '../context/session-context'
import CambiarPasswordDialog from './CambiarPasswordDialog'

const items = [
  { to: '/tickets', label: 'Tickets', icon: '📋' },
  { to: '/plantilla', label: 'Plantilla', icon: '📝' },
  { to: '/ajustes', label: 'Ajustes', icon: '⚙️' },
]

function UserMenu() {
  const { session, logout } = useSession()
  const [open, setOpen] = useState(false)
  const [changing, setChanging] = useState(false)
  if (session.status !== 'authenticated') return null
  return (
    <div className="relative">
      <button type="button" className="btn btn-secondary !min-h-11 !px-3 !py-1.5 text-sm" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
        <span aria-hidden>👤&nbsp;</span>Mi cuenta
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-64 space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
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

/** La revisión de dudas aprovecha todo el ancho en escritorio (lg); el resto de páginas se queda en max-w-3xl. */
const RUTA_REVISION = /^\/tickets\/[^/]+\/revision\/[^/]+/

export default function Layout() {
  const { pathname } = useLocation()
  const ancho = RUTA_REVISION.test(pathname) ? 'max-w-3xl lg:max-w-7xl' : 'max-w-3xl'
  return (
    <div className={`mx-auto flex min-h-dvh ${ancho} flex-col`}>
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
        <h1 className="text-xl font-bold">Automed</h1>
        <UserMenu />
      </header>
      <main className="flex-1 p-4 pb-28">
        <Outlet />
      </main>
      <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white">
        <ul className={`mx-auto flex ${ancho}`}>
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
                <span aria-hidden className="text-xl">{i.icon}</span>
                {i.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
