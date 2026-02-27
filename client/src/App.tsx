import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { SetupPage } from './pages/SetupPage'
import { ExplorerPage } from './pages/ExplorerPage'
import { ShortlistsPage } from './pages/ShortlistsPage'
import { ProjectsPage } from './pages/ProjectsPage'

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
      <nav style={navStyle} data-testid="app-nav">
        <strong style={{ marginRight: '1rem' }}>GoMaps</strong>
        <NavLink data-testid="nav-projects" to="/projects" style={({ isActive }) => isActive ? activeLinkStyle : linkStyle}>
          Projects
        </NavLink>
        <NavLink data-testid="nav-explorer" to="/explorer" style={({ isActive }) => isActive ? activeLinkStyle : linkStyle}>
          Explorer
        </NavLink>
        <NavLink data-testid="nav-shortlists" to="/shortlists" style={({ isActive }) => isActive ? activeLinkStyle : linkStyle}>
          Shortlists
        </NavLink>
        <NavLink data-testid="nav-settings" to="/settings" style={({ isActive }) => isActive ? activeLinkStyle : linkStyle}>
          Settings
        </NavLink>
        <span style={{ marginLeft: 'auto', borderRadius: '999px', background: '#223c70', color: '#dbe7ff', width: '2rem', height: '2rem', display: 'grid', placeItems: 'center', fontWeight: 700 }}>U</span>
      </nav>

      <Routes>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:projectId/setup" element={<SetupPage />} />
        <Route path="/projects/:projectId/explorer" element={<ExplorerPage />} />
        <Route path="/setup" element={<Navigate to="/projects" replace />} />
        <Route path="/explorer" element={<ExplorerPage />} />
        <Route path="/shortlists" element={<ShortlistsPage />} />
        <Route path="/settings" element={<div style={{ padding: '1rem' }}>Settings coming soon.</div>} />
      </Routes>
    </BrowserRouter>
  )
}
