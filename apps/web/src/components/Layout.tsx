import { NavLink, Outlet } from 'react-router-dom'

const items = [
  { to: '/tickets', label: 'Tickets', icon: '📋' },
  { to: '/plantilla', label: 'Plantilla', icon: '📝' },
  { to: '/ajustes', label: 'Ajustes', icon: '⚙️' },
]

export default function Layout() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="text-xl font-bold">Auto-med</h1>
      </header>
      <main className="flex-1 p-4 pb-24">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white">
        <ul className="mx-auto flex max-w-3xl">
          {items.map((i) => (
            <li key={i.to} className="flex-1">
              <NavLink
                to={i.to}
                className={({ isActive }) =>
                  `flex min-h-14 flex-col items-center justify-center text-sm font-medium ${
                    isActive ? 'text-blue-700' : 'text-slate-600'
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
