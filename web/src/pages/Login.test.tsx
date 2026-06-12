import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock('../lib/api.js', () => ({ login: vi.fn().mockResolvedValue('jwt-token') }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

import Login from './Login.js';

function renderLogin() {
  return render(<MemoryRouter><Login /></MemoryRouter>);
}

describe('Login', () => {
  beforeEach(() => {
    navigateMock.mockClear();
  });

  it('renders email and password fields', () => {
    renderLogin();
    expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/password/i)).toBeInTheDocument();
  });

  it('calls login with form values on submit', async () => {
    const { login } = await import('../lib/api.js');
    renderLogin();
    await userEvent.type(screen.getByPlaceholderText(/email/i), 'user@test.com');
    await userEvent.type(screen.getByPlaceholderText(/password/i), 'pass');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(login).toHaveBeenCalledWith('user@test.com', 'pass');
    expect(navigateMock).toHaveBeenCalledWith('/c', { replace: true });
  });
});
