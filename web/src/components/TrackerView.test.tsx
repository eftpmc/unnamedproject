import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TrackerView from './TrackerView.js';

const docs = [
  { id: '1', space_id: 's', path: 'a.md', title: 'Acme', type: 'application', status: 'applied', frontmatter: {}, source_session_id: null, created_at: 0, updated_at: 0 },
  { id: '2', space_id: 's', path: 'b.md', title: 'Beta', type: 'application', status: 'interview', frontmatter: {}, source_session_id: null, created_at: 0, updated_at: 0 },
];

describe('TrackerView', () => {
  it('renders a column per status', () => {
    render(<TrackerView documents={docs} onOpen={() => {}} />);
    expect(screen.getByText('applied')).toBeInTheDocument();
    expect(screen.getByText('interview')).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });
});
