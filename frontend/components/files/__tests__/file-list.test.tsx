import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let filesState: { data: unknown; isPending: boolean; isFetching: boolean; isError: boolean };

vi.mock('@/features/files/use-files', () => ({
  useFiles: () => filesState,
  useDownloadFile: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteFile: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/features/members/use-members', () => ({
  useMembers: () => ({ data: [], isError: false }),
}));

import { FileList } from '@/components/files/file-list';

const FILE = {
  id: 'f1',
  title: 'Constitution.pdf',
  category: 'SOP',
  uploadedByUserId: 'u1',
  fileSizeBytes: 2048,
  createdAt: new Date().toISOString(),
};

describe('FileList', () => {
  beforeEach(() => {
    filesState = { data: [FILE], isPending: false, isFetching: false, isError: false };
  });

  it('shows a skeleton on first load rather than an empty tab', () => {
    filesState = { data: undefined, isPending: true, isFetching: true, isError: false };
    render(<FileList orgId="org1" canManage />);
    expect(screen.getByRole('status', { name: 'Loading files' })).toBeInTheDocument();
  });

  it('keeps the files on screen while a refresh is in flight', () => {
    filesState = { data: [FILE], isPending: false, isFetching: true, isError: false };
    render(<FileList orgId="org1" canManage />);
    expect(screen.getByText('Constitution.pdf')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Refreshing files');
  });

  it('shows no busy state once the data has settled', () => {
    render(<FileList orgId="org1" canManage />);
    expect(screen.getByText('Constitution.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
