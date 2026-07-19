import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RatingScale } from '@/components/feedback/rating-scale';

it('renders one button per value in the range, inclusive', () => {
  render(<RatingScale min={1} max={5} value={undefined} onChange={vi.fn()} label="Content" />);
  expect(screen.getAllByRole('button')).toHaveLength(5);
});

it('renders 11 buttons for a 0-10 scale', () => {
  render(<RatingScale min={0} max={10} value={undefined} onChange={vi.fn()} label="NPS" />);
  expect(screen.getAllByRole('button')).toHaveLength(11);
});

it('calls onChange with the clicked value', async () => {
  const onChange = vi.fn();
  render(<RatingScale min={1} max={5} value={undefined} onChange={onChange} label="Content" />);
  await userEvent.click(screen.getByRole('button', { name: '4' }));
  expect(onChange).toHaveBeenCalledWith(4);
});

it('marks the selected value pressed', () => {
  render(<RatingScale min={1} max={5} value={3} onChange={vi.fn()} label="Content" />);
  expect(screen.getByRole('button', { name: '3' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: '4' })).toHaveAttribute('aria-pressed', 'false');
});
