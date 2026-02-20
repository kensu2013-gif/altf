import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useStore } from './store/useStore';
import { Layout } from './components/layout/Layout';

import { AnimatePresence } from 'framer-motion';
import { PageTransition } from './components/ui/PageTransition';
import { lazy, Suspense } from 'react';

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
const AdminUsers = lazy(() => import('./pages/admin/Users'));
const AdminOrders = lazy(() => import('./pages/AdminPage'));
const AdminQuotes = lazy(() => import('./pages/admin/Quotes')); // [RENAME]
const AdminInventory = lazy(() => import('./pages/admin/Inventory'));
const AdminSettings = lazy(() => import('./pages/admin/Settings'));

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

  if (user?.role !== 'admin') {
    // If authenticated but not admin, redirect to search (or access denied page)
    return <Navigate to="/search" replace />;
  }

  return <Outlet />;
}

// Public Route (Redirect if already logged in)
function PublicRoute() {
  const { isAuthenticated, user } = useStore((state) => state.auth);

  if (isAuthenticated) {
    if (user?.role === 'admin') {
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
              <Route path="users" element={<PageTransition><AdminUsers /></PageTransition>} />
              <Route path="orders" element={<PageTransition><AdminOrders /></PageTransition>} />
              <Route path="quotes" element={<PageTransition><AdminQuotes /></PageTransition>} />
              <Route path="inventory" element={<PageTransition><AdminInventory /></PageTransition>} />
              <Route path="settings" element={<PageTransition><AdminSettings /></PageTransition>} />
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

function App() {
  return (
    <BrowserRouter>
      <AnimatedRoutes />
    </BrowserRouter>
  );
}

export default App;
