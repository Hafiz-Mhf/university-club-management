'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useScanAttendance } from '@/features/attendance/use-attendance';
import { ApiError } from '@/lib/api';

// BarcodeDetector isn't in TypeScript's default DOM lib yet.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike;
  }
}

type Feedback = { kind: 'success' | 'error'; message: string } | null;

export function QrScanner({ orgId, eventId }: { orgId: string; eventId: string }) {
  const scan = useScanAttendance(orgId, eventId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [manualToken, setManualToken] = useState('');
  const lastValueRef = useRef<string | null>(null);

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'BarcodeDetector' in window);
  }, []);

  useEffect(() => {
    if (!supported) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let frame: number;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const Detector = window.BarcodeDetector!;
        const detector = new Detector({ formats: ['qr_code'] });

        const tick = async () => {
          if (stopped) return;
          if (videoRef.current && videoRef.current.readyState >= 2) {
            try {
              const results = await detector.detect(videoRef.current);
              const value = results[0]?.rawValue;
              if (value && value !== lastValueRef.current) {
                lastValueRef.current = value;
                submit(value);
              }
            } catch {
              // transient decode failure — try again next frame
            }
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch {
        setSupported(false); // camera denied/unavailable — fall back to manual entry
      }
    }
    start();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally
    // re-running only on `supported` (camera start/stop), not on every
    // `submit` closure recreated by render; `submit` calls `scan.mutate`,
    // whose reference is stable across renders for this hook instance, so
    // the closure captured at effect-setup time stays correct.
  }, [supported]);

  function submit(token: string) {
    setFeedback(null);
    scan.mutate(token, {
      onSuccess: () => {
        setFeedback({ kind: 'success', message: 'Checked in.' });
        setTimeout(() => {
          setFeedback(null);
          lastValueRef.current = null;
        }, 2000);
      },
      onError: (e) => {
        setFeedback({
          kind: 'error',
          message: e instanceof ApiError ? e.message : 'Something went wrong',
        });
        setTimeout(() => {
          setFeedback(null);
          lastValueRef.current = null;
        }, 2000);
      },
    });
  }

  if (supported === null) return null;

  return (
    <div className="flex flex-col gap-3">
      {feedback && (
        <p
          role="alert"
          className={
            feedback.kind === 'success'
              ? 'rounded-md bg-success/10 px-3 py-2 text-sm text-success'
              : 'rounded-md bg-danger/10 px-3 py-2 text-sm text-danger'
          }
        >
          {feedback.message}
        </p>
      )}

      {supported ? (
        <video ref={videoRef} className="w-full max-w-sm rounded-lg" muted playsInline />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (manualToken.trim()) {
              submit(manualToken.trim());
              setManualToken('');
            }
          }}
          className="flex max-w-sm gap-2"
        >
          <Input
            placeholder="Paste or type check-in token"
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
            aria-label="Check-in token"
          />
          <Button type="submit" disabled={scan.isPending || !manualToken.trim()}>
            {scan.isPending && <Loader2 className="size-4 animate-spin" />}
            Check in
          </Button>
        </form>
      )}
    </div>
  );
}
