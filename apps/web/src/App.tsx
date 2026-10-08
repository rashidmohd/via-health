import { useTranslation } from 'react-i18next'
import { NavLink, Route, Routes } from 'react-router-dom'
import { PlaceholderPage } from './features/PlaceholderPage'
import { NAV_ITEMS } from './features/nav'

export default function App() {
  const { t } = useTranslation()
  return (
    <div className="layout">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">Sessio</div>
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.key}>
              <NavLink to={item.path} end={item.path === '/'}>
                {t(`nav.${item.key}`)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main>
        <Routes>
          {NAV_ITEMS.map((item) => (
            <Route key={item.key} path={item.path} element={<PlaceholderPage navKey={item.key} />} />
          ))}
        </Routes>
      </main>
    </div>
  )
}
