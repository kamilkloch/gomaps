import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { SetupPage } from './pages/SetupPage'
import { ExplorerPage } from './pages/ExplorerPage'
import { ShortlistsPage } from './pages/ShortlistsPage'

const navStyle = {
  display: 'flex',
  gap: '1rem',
  padding: '1rem',
  borderBottom: '1px solid #ccc',
  alignItems: 'center',
} as const

const linkStyle = {
  textDecoration: 'none',
  color: '#555',
  fontWeight: 500,
} as const

const activeLinkStyle = {
  ...linkStyle,
  color: '#1a73e8',
  fontWeight: 700,
} as const

export function App() {
  return (
    <BrowserRouter>
      <nav style={navStyle}>
        <strong style={{ marginRight: '1rem' }}>GoMaps</strong>
        <NavLink to="/setup" style={({ isActive }) => isActive ? activeLinkStyle : linkStyle}>
          Setup
        </NavLink>
        <NavLink to="/explorer" style={({ isActive }) => isActive ? activeLinkStyle : linkStyle}>
          Explorer
        </NavLink>
        <NavLink to="/shortlists" style={({ isActive }) => isActive ? activeLinkStyle : linkStyle}>
          Shortlists
        </NavLink>
      </nav>

      <Routes>
        <Route path="/" element={<Navigate to="/setup" replace />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/explorer" element={<ExplorerPage />} />
        <Route path="/shortlists" element={<ShortlistsPage />} />
      </Routes>
    </BrowserRouter>
  )
}
