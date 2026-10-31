import React from 'react';
import { Check, Plus } from 'lucide-react';

interface ChipSelectorProps {
  label: string;
  options: readonly string[];
  selected: string[];
  onChange: (nextSelected: string[]) => void;
  multiple?: boolean;
  allowOther?: boolean;
  otherValue?: string;
  onOtherChange?: (value: string) => void;
  helperText?: string;
}

export const ChipSelector: React.FC<ChipSelectorProps> = ({
  label,
  options,
  selected,
  onChange,
  multiple = true,
  allowOther = false,
  otherValue = '',
  onOtherChange,
  helperText,
}) => {
  const isOtherSelected = selected.includes('Otro');

  const toggleOption = (option: string) => {
    if (multiple) {
      if (selected.includes(option)) {
        onChange(selected.filter((item) => item !== option));
      } else {
        onChange([...selected, option]);
      }
    } else {
      onChange(selected.includes(option) ? [] : [option]);
    }
  };

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-sm font-semibold text-slate-800">{label}</label>
        {helperText && <p className="text-xs text-slate-500 mt-0.5">{helperText}</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => toggleOption(option)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium transition-all border ${
                active
                  ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                  : 'bg-white text-slate-700 border-slate-300 hover:border-brand-500 hover:bg-brand-50'
              }`}
            >
              {active && <Check className="w-3.5 h-3.5" />}
              <span>{option}</span>
            </button>
          );
        })}

        {allowOther && (
          <button
            type="button"
            onClick={() => toggleOption('Otro')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium transition-all border ${
              isOtherSelected
                ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                : 'bg-slate-100 text-slate-700 border-slate-300 hover:border-amber-500'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Otro (Especificar)</span>
          </button>
        )}
      </div>

      {allowOther && isOtherSelected && onOtherChange && (
        <div className="pt-1">
          <input
            type="text"
            value={otherValue}
            onChange={(e) => onOtherChange(e.target.value)}
            placeholder="Escribí cuál es el rubro u oficio para sumarlo..."
            className="w-full rounded-xl border border-amber-300 bg-amber-50/40 px-3.5 py-2 text-sm text-slate-800 focus:border-amber-600 focus:outline-none"
          />
          <p className="text-xs text-slate-500 mt-1">
            El administrador podrá incorporarlo al listado oficial de botones.
          </p>
        </div>
      )}
    </div>
  );
};
