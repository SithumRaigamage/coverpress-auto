import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, useRouteError } from 'react-router';
import { errorMessage } from '../api/client';
import { ButtonLink, EmptyState, ErrorPanel, Skeleton } from '../components/ui';
import { Library } from '../features/library/Library';
import { Shell } from './shell';

// The library is the first paint; every other screen loads on demand.
const GameDetail = lazy(() => import('../features/games/GameDetail').then((m) => ({ default: m.GameDetail })));
const RunScreen = lazy(() => import('../features/runs/RunScreen').then((m) => ({ default: m.RunScreen })));
const RunsList = lazy(() => import('../features/runs/RunsList').then((m) => ({ default: m.RunsList })));
const ReviewBoard = lazy(() => import('../features/review/ReviewBoard').then((m) => ({ default: m.ReviewBoard })));
const Shelves = lazy(() => import('../features/shelves/Shelves').then((m) => ({ default: m.Shelves })));
const PrintSheets = lazy(() => import('../features/print/PrintSheets').then((m) => ({ default: m.PrintSheets })));
const PrintSheet = lazy(() => import('../features/print/PrintSheet').then((m) => ({ default: m.PrintSheet })));
const Settings = lazy(() => import('../features/settings/Settings').then((m) => ({ default: m.Settings })));
const Legal = lazy(() => import('../features/legal/Legal').then((m) => ({ default: m.Legal })));

function Loading() {
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-64" />
    </div>
  );
}

const deferred = (element: ReactNode) => <Suspense fallback={<Loading />}>{element}</Suspense>;

function RouteError() {
  const error = useRouteError();
  return (
    <div className="p-8">
      <ErrorPanel message={errorMessage(error)} onRetry={() => window.location.assign('/')} />
    </div>
  );
}

function NotFound() {
  return (
    <EmptyState title="Page not found" action={<ButtonLink variant="primary" to="/">Back to the library</ButtonLink>}>
      That address is not part of Coverpress.
    </EmptyState>
  );
}

export const routes = [
  {
    path: '/',
    element: <Shell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Library /> },
      { path: 'games/:rawgId', element: deferred(<GameDetail />) },
      { path: 'runs', element: deferred(<RunsList />) },
      { path: 'runs/:coverId', element: deferred(<RunScreen />) },
      { path: 'review', element: deferred(<ReviewBoard />) },
      { path: 'shelves', element: deferred(<Shelves />) },
      { path: 'print', element: deferred(<PrintSheets />) },
      { path: 'print/:projectId', element: deferred(<PrintSheet />) },
      { path: 'settings', element: deferred(<Settings />) },
      { path: 'legal', element: deferred(<Legal />) },
      { path: '*', element: <NotFound /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
