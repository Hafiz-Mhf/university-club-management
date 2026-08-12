import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkeletonList } from '@/components/ui/skeleton-list';

describe('SkeletonList', () => {
  it('draws the requested number of placeholder rows', () => {
    const { container } = render(<SkeletonList rows={5} />);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(5);
  });

  it('defaults to three rows', () => {
    const { container } = render(<SkeletonList />);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
  });

  it('announces itself as busy so screen readers report the load', () => {
    render(<SkeletonList label="Loading events" />);
    const status = screen.getByRole('status', { name: 'Loading events' });
    expect(status).toHaveAttribute('aria-busy', 'true');
  });

  it('applies the row height it was given', () => {
    const { container } = render(<SkeletonList rows={1} rowClassName="h-24" />);
    expect(container.querySelector('[data-slot="skeleton"]')).toHaveClass('h-24');
  });
});
