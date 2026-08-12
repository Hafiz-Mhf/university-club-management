import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Refreshing } from '@/components/ui/refreshing';

describe('Refreshing', () => {
  it('keeps the current content on screen while refreshing', () => {
    render(
      <Refreshing active>
        <p>Ada Lovelace</p>
      </Refreshing>,
    );
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('marks the region busy and announces the refresh', () => {
    render(
      <Refreshing active label="Refreshing members">
        <p>Ada Lovelace</p>
      </Refreshing>,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Refreshing members');
    expect(screen.getByText('Ada Lovelace').closest('[aria-busy="true"]')).not.toBeNull();
  });

  it('is inert when not refreshing', () => {
    const { container } = render(
      <Refreshing active={false}>
        <p>Ada Lovelace</p>
      </Refreshing>,
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(container.firstElementChild).not.toHaveClass('opacity-60');
  });

  it('dims the stale content while the new data is in flight', () => {
    const { container } = render(
      <Refreshing active>
        <p>Ada Lovelace</p>
      </Refreshing>,
    );
    expect(container.firstElementChild).toHaveClass('opacity-60');
  });
});
