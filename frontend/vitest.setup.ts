import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Without vitest `globals: true`, testing-library can't auto-register its
// cleanup hook — unmount between tests explicitly or renders accumulate.
afterEach(cleanup);
