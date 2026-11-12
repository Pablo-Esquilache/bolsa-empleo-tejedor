import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { X, Scale, ShieldCheck } from 'lucide-react';
import {
  LEGAL_VERSION_DISPLAY,
  PRIVACY,
  TERMS_CANDIDATE,
  TERMS_COMMON,
  TERMS_EMPLOYER,
} from '../../lib/legalTexts';
import { CONTACT_EMAIL, OWNER_NAME, SITE_NAME } from '../../lib/siteConfig';

export type LegalModalTab = 'terms' | 'privacy';
export type LegalModalRole = 'candidate' | 'employer' | 'all';

interface OpenLegalModalOptions {
  tab?: LegalModalTab;
  role?: LegalModalRole;
}

interface LegalModalContextValue {
  openLegalModal: (options?: OpenLegalModalOptions) => void;
  closeLegalModal: () => void;
}

const LegalModalContext = createContext<LegalModalContextValue>({
  openLegalModal: () => {},
  closeLegalModal: () => {},
});

export function useLegalModal(): LegalModalContextValue {
  return useContext(LegalModalContext);
}

export const LegalModalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<LegalModalTab>('terms');
  const [roleScope, setRoleScope] = useState<LegalModalRole>('all');
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);

  const openLegalModal = useCallback((options?: OpenLegalModalOptions) => {
    lastFocusedElementRef.current = document.activeElement as HTMLElement | null;
    setActiveTab(options?.tab || 'terms');
    setRoleScope(options?.role || 'all');
    setIsOpen(true);
  }, []);

  const closeLegalModal = useCallback(() => {
    setIsOpen(false);
    setTimeout(() => {
      lastFocusedElementRef.current?.focus?.();
    }, 0);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    closeButtonRef.current?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeLegalModal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, closeLegalModal]);

  const sectionsToRender =
    activeTab === 'privacy'
      ? PRIVACY
      : [
          ...TERMS_COMMON,
          ...(roleScope === 'candidate' || roleScope === 'all' ? TERMS_CANDIDATE : []),
          ...(roleScope === 'employer' || roleScope === 'all' ? TERMS_EMPLOYER : []),
        ];

  return (
    <LegalModalContext.Provider value={{ openLegalModal, closeLegalModal }}>
      {children}

      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
          onClick={closeLegalModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="legal-modal-title"
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl border border-slate-200 max-w-2xl w-full max-h-[88vh] flex flex-col shadow-2xl overflow-hidden"
          >
            {/* Cabecera del modal */}
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50">
              <div>
                <h2 id="legal-modal-title" className="text-lg font-bold text-slate-900">
                  Información Legal y Privacidad — {SITE_NAME}
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Versión vigente: {LEGAL_VERSION_DISPLAY}
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeLegalModal}
                aria-label="Cerrar ventana"
                className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 focus:outline-none focus:ring-2 focus:ring-brand-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Pestañas */}
            <div className="px-5 pt-3 pb-2 border-b border-slate-200 flex gap-2 bg-white">
              <button
                type="button"
                onClick={() => setActiveTab('terms')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand-600 ${
                  activeTab === 'terms'
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Scale className="w-4 h-4" />
                <span>Términos y Condiciones</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('privacy')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand-600 ${
                  activeTab === 'privacy'
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Política de Privacidad</span>
              </button>
            </div>

            {/* Cuerpo con scroll interno */}
            <div className="p-5 overflow-y-auto space-y-4 text-sm text-slate-700 leading-relaxed">
              {sectionsToRender.map((section) => (
                <section key={section.title} className="space-y-1.5">
                  <h3 className="text-sm font-bold text-slate-900">{section.title}</h3>
                  {section.paragraphs.map((paragraph, idx) => (
                    <p key={idx} className="text-xs sm:text-sm text-slate-700">
                      {paragraph}
                    </p>
                  ))}
                </section>
              ))}
            </div>

            {/* Pie del modal */}
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600">
              <div>
                <span className="font-semibold text-slate-800">Responsable:</span> {OWNER_NAME} ·{' '}
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="text-brand-700 hover:underline font-medium"
                >
                  {CONTACT_EMAIL}
                </a>
              </div>
              <button
                type="button"
                onClick={closeLegalModal}
                className="self-end sm:self-auto px-4 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-brand-600"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </LegalModalContext.Provider>
  );
};
