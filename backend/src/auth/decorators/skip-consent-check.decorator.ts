import { SetMetadata } from '@nestjs/common';

export const SKIP_CONSENT_CHECK_KEY = 'skipConsentCheck';
export const SkipConsentCheck = () => SetMetadata(SKIP_CONSENT_CHECK_KEY, true);
