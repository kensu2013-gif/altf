
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useStore } from './store/useStore';
import { Layout } from './components/layout/Layout';

import { AnimatePresence } from 'framer-motion';
import { PageTransition } from './components/ui/PageTransition';
import { lazy, Suspense, useEffect } from 'react';

// Lazy Load Pages
const AccessGate = lazy(() => import('./pages/AccessGate'));
const Search = lazy(() => import('./pages/Search'));
const Cart = lazy(() => import('./pages/Cart'));
const QuoteLoader = lazy(() => import('./pages/QuoteLoader'));
const MyPage = lazy(() => import('./pages/MyPage'));

// Auth Pages
const Login = lazy(() => import('./pages/auth/Login'));
const Signup = lazy(() => import('./pages/auth/Signup'));

// Policy Pages
const TermsOfService = lazy(() => import('./pages/policy/TermsOfService'));
const PrivacyPolicy = lazy(() => import('./pages/policy/PrivacyPolicy'));
const MarketingConsent = lazy(() => import('./pages/policy/MarketingConsent'));

// Admin Pages
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminMembers = lazy(() => import('./pages/admin/Members'));
const AdminManagers = lazy(() => import('./pages/admin/Managers'));
const AdminOrders = lazy(() => import('./pages/AdminPage'));
const AdminQuotes = lazy(() => import('./pages/admin/Quotes')); // [RENAME]
const PendingOrders = lazy(() => import('./pages/admin/Pending'));
const AdminInventory = lazy(() => import('./pages/admin/Inventory'));
const AdminSettings = lazy(() => import('./pages/admin/Settings'));
const AdminProfile = lazy(() => import('./pages/admin/Profile'));
const AdminActiveUsers = lazy(() => import('./pages/admin/ActiveUsers'));

// ... (keep existing code)


// Protected Route Wrapper (User)
function ProtectedRoute() {
  const isAuth = useStore((state) => state.auth.isAuthenticated);
  const location = useLocation();

  if (!isAuth) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <Outlet />;
}

// Admin Route Wrapper
function AdminRoute() {
  const { isAuthenticated, user } = useStore((state) => state.auth);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user?.role !== 'MASTER' && user?.role !== 'MANAGER' && user?.role !== 'admin') {
    // If authenticated but not admin, redirect to search (or access denied page)
    return <Navigate to="/search" replace />;
  }

  return <Outlet />;
}

// Public Route (Redirect if already logged in)
function PublicRoute() {
  const { isAuthenticated, user } = useStore((state) => state.auth);

  if (isAuthenticated) {
    if (user?.role === 'MASTER' || user?.role === 'MANAGER' || user?.role === 'admin') {
      return <Navigate to="/admin/orders" replace />;
    }
    return <Navigate to="/welcome" replace />;
  }
  return <Outlet />;
}

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
    </div>
  );
}

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Suspense fallback={<LoadingFallback />}>
        <Routes location={location} key={location.pathname}>
          {/* Auth Routes (No Layout) */}
          <Route element={<PublicRoute />}>
            <Route path="/login" element={<PageTransition><Login /></PageTransition>} />
            <Route path="/signup" element={<PageTransition><Signup /></PageTransition>} />
            {/* Legacy routes backup */}
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/access" element={<Navigate to="/login" replace />} />
          </Route>

          {/* Universal Public Routes (Accessible by all) */}
          <Route path="/policy/terms" element={<PageTransition><TermsOfService /></PageTransition>} />
          <Route path="/policy/privacy" element={<PageTransition><PrivacyPolicy /></PageTransition>} />
          <Route path="/policy/marketing" element={<PageTransition><MarketingConsent /></PageTransition>} />

          {/* Admin Routes (Admin Layout) */}
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="/admin/orders" replace />} />
              <Route path="members" element={<PageTransition><AdminMembers /></PageTransition>} />
              <Route path="managers" element={<PageTransition><AdminManagers /></PageTransition>} />
              <Route path="orders" element={<PageTransition><AdminOrders /></PageTransition>} />
              <Route path="quotes" element={<PageTransition><AdminQuotes /></PageTransition>} />
              <Route path="pending" element={<PageTransition><PendingOrders /></PageTransition>} />
              <Route path="inventory" element={<PageTransition><AdminInventory /></PageTransition>} />
              <Route path="settings" element={<PageTransition><AdminSettings /></PageTransition>} />
              <Route path="profile" element={<PageTransition><AdminProfile /></PageTransition>} />
              <Route path="active-users" element={<PageTransition><AdminActiveUsers /></PageTransition>} />
            </Route>
          </Route>

          {/* User Protected App Routes (Main Layout) */}
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout><Outlet /></Layout>}>
              <Route path="/welcome" element={<PageTransition><AccessGate /></PageTransition>} />
              <Route path="/search" element={<PageTransition><Search /></PageTransition>} />
              <Route path="/quote" element={<PageTransition><Cart /></PageTransition>} />
              <Route path="/q/:quoteId" element={<PageTransition><QuoteLoader /></PageTransition>} />

              {/* New My Page Route */}
              <Route path="/my-page" element={<PageTransition><MyPage /></PageTransition>} />

              {/* Redirect old /orders to /my-page */}
              <Route path="/orders" element={<Navigate to="/my-page" replace />} />

              <Route path="/cart" element={<Navigate to="/quote" replace />} />
            </Route>
          </Route>

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AnimatePresence>
  );
}

import { ErrorBoundary } from './components/ErrorBoundary';

function SessionManager() {
  const { auth, logout } = useStore();
  const location = useLocation();

  useEffect(() => {
    if (!auth.isAuthenticated || !auth.token) return;

    let lastActivity = Date.now();
    const TIMEOUT_MS = 3 * 60 * 60 * 1000; // 3 hours

    const updateActivity = () => {
      lastActivity = Date.now();
    };

    window.addEventListener('mousemove', updateActivity);
    window.addEventListener('keydown', updateActivity);
    window.addEventListener('click', updateActivity);
    window.addEventListener('scroll', updateActivity, true);

    const intervalId = setInterval(async () => {
      if (Date.now() - lastActivity > TIMEOUT_MS) {
        alert('장시간 활동이 없어 자동 로그아웃 되었습니다.');
        logout();
        return;
      }

      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/auth/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: auth.token, activity: `Browsing: ${location.pathname}`, user: auth.user })
        });

        if (res.status === 401) {
          alert('다른 기기에서 로그인되어 현재 연결이 종료되었습니다.');
          logout();
        }
      } catch (e) {
        console.error('Heartbeat failed:', e);
      }
    }, 30 * 1000); // 30 seconds

    return () => {
      window.removeEventListener('mousemove', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('click', updateActivity);
      window.removeEventListener('scroll', updateActivity, true);
      clearInterval(intervalId);
    };
  }, [auth.isAuthenticated, auth.token, auth.user, logout, location.pathname]);

  return null;
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <SessionManager />
        <AnimatedRoutes />
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;

