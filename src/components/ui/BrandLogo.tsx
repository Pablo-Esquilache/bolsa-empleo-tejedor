import React from 'react';

interface BrandLogoProps {
  variant?: 'navbar' | 'stacked' | 'badge' | 'symbol';
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ variant = 'navbar', className = '' }) => {
  if (variant === 'badge') {
    return (
      <img
        src="/apple-touch-icon.png"
        alt="Bolsa de Empleo Tejedor"
        className={`w-10 h-10 rounded-xl shadow-sm object-cover shrink-0 ${className}`}
      />
    );
  }

  if (variant === 'symbol') {
    return (
      <img
        src="/logo-symbol.png"
        alt="Bolsa de Empleo Tejedor"
        className={`h-9 w-auto object-contain shrink-0 ${className}`}
      />
    );
  }

  if (variant === 'stacked') {
    return (
      <div className={`flex flex-col items-center gap-2 ${className}`}>
        <img
          src="/apple-touch-icon.png"
          alt="Bolsa de Empleo Tejedor"
          className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl shadow-md object-cover shrink-0"
        />
        <div className="text-center">
          <p className="text-sm font-bold text-slate-200 uppercase tracking-wider leading-none">
            Bolsa de Empleo
          </p>
          <p className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight leading-tight">
            Tejedor
          </p>
        </div>
      </div>
    );
  }

  // Default 'navbar': exactly matching 'Encabezado / Web' and 'Ejemplo en barra de navegación'
  return (
    <div className={`flex items-center gap-2.5 sm:gap-3 select-none ${className}`}>
      {/* Icono de app en recuadro azul redondeado */}
      <img
        src="/favicon-64.png"
        srcSet="/favicon-64.png 1x, /icon-192.png 2x"
        alt="Bolsa de Empleo Tejedor"
        width={40}
        height={40}
        className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl shadow-sm object-cover shrink-0 ring-1 ring-slate-900/5"
      />

      {/* Línea divisoria vertical sutil */}
      <div className="h-7 w-px bg-slate-200" aria-hidden="true" />

      {/* Tipografía oficial en dos líneas */}
      <div className="flex flex-col leading-none justify-center">
        <span className="text-[11px] sm:text-xs font-bold text-slate-800 tracking-tight">
          Bolsa de Empleo
        </span>
        <span className="text-base sm:text-lg font-extrabold text-brand-600 tracking-tight -mt-0.5">
          Tejedor
        </span>
      </div>
    </div>
  );
};
