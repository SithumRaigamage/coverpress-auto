import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Link, useRouteError } from 'react-router';
import { errorMessage } from '../api/client';
import { ErrorPanel, Skeleton } from '../components/ui';
import { Shelves } from '../features/shelves/Shelves';
import { Shell } from './shell';

// Keep the first paint to the shelves shell. Other screens bring their own
// heavier form/primitive dependencies only when opened.
const Shelf = lazy(() => import('../features/shelves/Shelf').then((module) => ({ default: module.Shelf })));
const Review = lazy(() => import('../features/review/Review').then((module) => ({ default: module.Review })));
const PrintSheet = lazy(() => import('../features/print/PrintSheet').then((module) => ({ default: module.PrintSheet })));
const Settings = lazy(() => import('../features/settings/Settings').then((module) => ({ default: module.Settings })));
const Legal = lazy(() => import('../features/legal/Legal').then((module) => ({ default: module.Legal })));

function Loading() {
  return (
    <div className="screen" aria-busy="true" aria-label="Loading">
      <Skeleton className="skeleton--title" />
      <Skeleton className="skeleton--panel" />
    </div>
  );
}

function deferred(element: ReactNode) {
  return <Suspense fallback={<Loading />}>{element}</Suspense>;
}

function RouteError() {
  const error = useRouteError();
  return (
    <div className="screen">
      <ErrorPanel message={errorMessage(error)} onRetry={() => window.location.assign('/')} />
    </div>
  );
}

function NotFound() {
  return (
    <div className="screen">
      <div className="empty-state">
        <h3>Page not found</h3>
        <p>That route doesn't exist in the local workbench.</p>
        <Link className="btn btn--primary btn--md" to="/">Back to shelves</Link>
      </div>
    </div>
  );
}

/** React Router 7 data mode. The URL is the source of truth for shelf + cover selection. */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Shelves /> },
      { path: 'shelves/:id', element: deferred(<Shelf />) },
      { path: 'shelves/:id/review', element: deferred(<Review />) },
      { path: 'shelves/:id/print', element: deferred(<PrintSheet />) },
      { path: 'settings', element: deferred(<Settings />) },
      { path: 'legal', element: deferred(<Legal />) },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
