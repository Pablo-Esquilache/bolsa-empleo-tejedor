import React, { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
          theme?: 'light' | 'dark' | 'auto';
        }
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

interface TurnstileWidgetProps {
  onTokenChange: (token: string) => void;
  resetSignal?: number;
}

const TURNSTILE_SCRIPT_ID = 'cf-turnstile-script';
const TURNSTILE_SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export const TurnstileWidget: React.FC<TurnstileWidgetProps> = ({
  onTokenChange,
  resetSignal = 0,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();

  useEffect(() => {
    if (!siteKey) return;

    let cancelled = false;

    const mountWidget = () => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      if (widgetIdRef.current) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore cleanup error
        }
        widgetIdRef.current = null;
      }

      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: 'light',
        callback: (token: string) => {
          onTokenChange(token);
        },
        'expired-callback': () => {
          onTokenChange('');
        },
        'error-callback': () => {
          onTokenChange('');
        },
      });
    };

    if (window.turnstile) {
      mountWidget();
    } else {
      let script = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement('script');
        script.id = TURNSTILE_SCRIPT_ID;
        script.src = TURNSTILE_SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      const handleLoad = () => mountWidget();
      script.addEventListener('load', handleLoad);
      return () => {
        cancelled = true;
        script?.removeEventListener('load', handleLoad);
        if (widgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.remove(widgetIdRef.current);
          } catch {
            // ignore
          }
          widgetIdRef.current = null;
        }
      };
    }

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetSignal > 0 && widgetIdRef.current && window.turnstile) {
      onTokenChange('');
      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch {
        // ignore
      }
    }
  }, [resetSignal]);

  if (!siteKey) {
    return (
      <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 text-center">
        Verificación anti-bots pendiente de configurar (<code>VITE_TURNSTILE_SITE_KEY</code>).
      </div>
    );
  }

  return (
    <div className="flex justify-center my-2">
      <div ref={containerRef} />
    </div>
  );
};
