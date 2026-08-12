import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TabStrip } from '@/components/ui/tab-strip';

const TABS = [
  { id: 'organization' as const, label: 'Organization' },
  { id: 'account' as const, label: 'My Account' },
];

function setup(value: 'organization' | 'account' = 'organization') {
  const onChange = vi.fn();
  render(<TabStrip label="Settings sections" tabs={TABS} value={value} onChange={onChange} />);
  return { onChange };
}

describe('TabStrip', () => {
  it('exposes the ARIA tabs pattern', () => {
    setup();
    expect(screen.getByRole('tablist', { name: 'Settings sections' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Organization' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'My Account' })).toHaveAttribute('aria-selected', 'false');
  });

  it('points each tab at the panel it controls', () => {
    setup();
    expect(screen.getByRole('tab', { name: 'My Account' })).toHaveAttribute(
      'aria-controls',
      'tabpanel-account',
    );
  });

  it('keeps a single tab stop and moves selection with arrow keys', async () => {
    const { onChange } = setup();
    const selected = screen.getByRole('tab', { name: 'Organization' });
    expect(selected).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'My Account' })).toHaveAttribute('tabindex', '-1');

    selected.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('account');
  });

  it('wraps at the ends and supports Home/End', async () => {
    const { onChange } = setup('organization');
    screen.getByRole('tab', { name: 'Organization' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenCalledWith('account');

    await userEvent.keyboard('{End}');
    expect(onChange).toHaveBeenCalledWith('account');
  });

  it('changes tab on click', async () => {
    const { onChange } = setup();
    await userEvent.click(screen.getByRole('tab', { name: 'My Account' }));
    expect(onChange).toHaveBeenCalledWith('account');
  });
});
