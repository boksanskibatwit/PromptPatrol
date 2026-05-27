import { Link, Route, Routes, useLocation } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import MFA from './pages/Mfa.jsx';

function Dashboard() {
  return <h1>Dashboard (Logged in)</h1>;
}

export default function App() {
  const location = useLocation();
  const isLoginPage = location.pathname === '/login';

  if (isLoginPage) {
    return <Login />;
  }

  return (
    <div className="app">
      <nav className="nav">
        <Link to="/">Home</Link>
        <Link to="/login">Login</Link>
      </nav>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/mfa" element={<MFA />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="*" element={<p>Not found</p>} />
      </Routes>
    </div>
  );
}
