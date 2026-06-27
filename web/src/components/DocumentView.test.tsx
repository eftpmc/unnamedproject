import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import DocumentView from './DocumentView.js';

vi.mock('../lib/api.js', () => ({ updateDocument: vi.fn(async () => ({})) }));
import { updateDocument } from '../lib/api.js';

const doc = { id: 'd1', space_id: 's1', path: 'a.md', title: 'A', type: null, status: null, frontmatter: {}, source_session_id: null, created_at: 0, updated_at: 0, body: '# Hello' };

describe('DocumentView', () => {
  it('renders markdown then edits and saves', async () => {
    render(<DocumentView spaceId="s1" doc={doc} onSaved={() => {}} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: '# Changed' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(updateDocument).toHaveBeenCalledWith('s1', 'd1', { body: '# Changed' }));
  });
});
