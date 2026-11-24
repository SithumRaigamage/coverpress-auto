import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cover } from '../../api/types';
import { ToastProvider } from '../../components/Toast';
import { ReviewBoard } from './ReviewBoard';

const cover: Cover = {
  id: 'c1',
  projectId: 'p1',
  title: 'Iron Tide',
  platform: 'PS5',
  mode: 'auto',
  status: 'needs_review',
  error: null,
  score: 72,
  issues: [{ level: 'warn', code: 'landscape', msg: 'Art is landscape — heavy crop.' }],
  decidedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  renderId: 'r1',
  renderVersion: 1,
  artUrl: null,
  thumbUrl: '/api/renders/r1/front.png',
  wrapUrl: '/api/renders/r1/wrap.png',
  projectName: 'My library',
  approvedRenderId: null,
  versions: [2, 1].map((n) => ({
    id: `r${n}`,
    version: n,
    createdAt: '2026-01-01T00:00:00Z',
    score: n === 2 ? 72 : 58,
    status: 'needs_review' as const,
    issues: [{ level: 'warn', code: 'landscape', msg: n === 2 ? 'Art is landscape — heavy crop.' : 'Art is soft.' }],
    mode: n === 2 ? ('variant' as const) : null,
    front: { source: 'RAWG', kind: 'screenshot', width: 1280, height: 720 },
    approved: false,
    frontUrl: `/api/renders/r${n}/front.png`,
    wrapUrl: `/api/renders/r${n}/wrap.png`,
  })),
};

let decision: { status: number; body: unknown } = { status: 200, body: { id: 'c1', status: 'approved', decidedAt: 'now' } };
const calls: string[] = [];
const bodies: unknown[] = [];

beforeEach(() => {
  calls.length = 0;
  bodies.length = 0;
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method || 'GET'} ${url}`);
    if (init?.body) bodies.push(JSON.parse(String(init.body)));
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/decision')) {
      // Hold the response briefly so the optimistic state is observable.
      await new Promise((r) => setTimeout(r, 30));
      return json(decision.body, decision.status);
    }
    if (url.startsWith('/api/covers')) return json({ covers: [cover], pending: 0 });
    if (url.startsWith('/api/projects')) return json({ projects: [], usage: {}, plan: {}, pending: 0 });
    return json({}, 404);
  });
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/review', element: <ReviewBoard /> }], { initialEntries: ['/review'] });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// Column headings carry their count ("Needs review 1"), so match the label as a prefix.
const column = (name: string) => screen.getByRole('region', { name: new RegExp(`^${name}`) });

describe('ReviewBoard', () => {
  it('approves optimistically and rolls back with a message when the server refuses', async () => {
    decision = { status: 500, body: { error: 'The request failed.' } };
    setup();
    const card = await within(column('Needs review')).findByRole('article', { name: /Iron Tide/ });
    expect(within(card).getByText('Art is landscape — heavy crop.')).toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: 'Approve Iron Tide version 2' }));
    // Optimistic: the card moves before the server answers.
    expect(await within(column('Approved')).findByRole('article', { name: /Iron Tide/ })).toBeInTheDocument();
    // Rolled back once the 500 arrives, with the server's sentence in a toast.
    expect(await within(column('Needs review')).findByRole('article', { name: /Iron Tide/ })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not approve Iron Tide: The request failed.');
  });

  it('A approves the focused card from the keyboard', async () => {
    decision = { status: 200, body: { id: 'c1', status: 'approved', decidedAt: 'now' } };
    setup();
    const card = await within(column('Needs review')).findByRole('article', { name: /Iron Tide/ });
    act(() => card.focus());
    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => expect(calls).toContain('POST /api/covers/c1/decision'));
  });

  it('ignores shortcuts while typing in a field', async () => {
    setup();
    await within(column('Needs review')).findByRole('article', { name: /Iron Tide/ });
    const select = screen.getByRole('combobox', { name: 'Shelf' });
    fireEvent.keyDown(select, { key: 'a' });
    expect(calls.some((c) => c.includes('/decision'))).toBe(false);
  });

  it('shows one card with a version switcher and approves the version on screen', async () => {
    decision = { status: 200, body: { id: 'c1', status: 'approved', decidedAt: 'now', approvedRenderId: 'r1' } };
    setup();
    const card = await within(column('Needs review')).findByRole('article', { name: /Iron Tide/ });
    const versions = within(card).getByRole('radiogroup', { name: 'Versions of Iron Tide' });
    expect(within(versions).getByRole('radio', { name: 'Show version 2' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(versions).getByRole('radio', { name: 'Show version 1' }));
    expect(within(card).getByText('Art is soft.')).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Approve Iron Tide version 1' }));
    await waitFor(() => expect(bodies).toContainEqual({ decision: 'approved', renderId: 'r1' }));
  });
});
