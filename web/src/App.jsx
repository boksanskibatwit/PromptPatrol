import { Link, Route, Routes, useLocation } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import MFA from './pages/Mfa.jsx';
import RequestAccount from './pages/RequestAccount.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Redact from './pages/Redact.jsx';
import AdminPanel from './pages/AdminPanel.jsx';
import ResetPassword from './pages/ResetPassword.jsx';

/* Pages that render full-viewport (no shared nav bar) */
const FULL_PAGE_ROUTES = ['/login', '/request-account', '/mfa', '/dashboard', '/redact', '/admin', '/reset-password'];

export default function App() {
  const location = useLocation();
  const isFullPage = FULL_PAGE_ROUTES.includes(location.pathname);

  if (isFullPage) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/request-account" element={<RequestAccount />} />
        <Route path="/mfa" element={<MFA />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/redact" element={<Redact />} />
        <Route path="/admin" element={<AdminPanel />} />
        <Route path="/reset-password" element={<ResetPassword />} />
      </Routes>
    );
  }

  return (
    <div className="app">
      <nav className="nav">
        <Link to="/">Home</Link>
        <Link to="/login">Login</Link>
      </nav>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="*" element={<p>Not found</p>} />
      </Routes>
    </div>
  );
}
