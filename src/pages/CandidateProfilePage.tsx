import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, FileText, Save, CheckCircle2, AlertCircle, Eye } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import {
  AVAILABILITY_OPTIONS,
  EDUCATION_LEVELS,
  INITIAL_INDUSTRIES,
  WORK_SITUATIONS,
} from '../lib/constants';
import { ChipSelector } from '../components/ui/ChipSelector';
import { LocationSelector, LocationValue } from '../components/ui/LocationSelector';
import { compressImageToDataUrl, fileToBase64 } from '../lib/imageCompression';
import { validatePdfFile } from '../lib/pdfValidation';
import { IndustryItem, WorkSituation } from '../types/database';
import { useLegalModal } from '../components/ui/LegalModal';
import { PrivacyAndAccountSection } from '../components/ui/PrivacyAndAccountSection';
import { notifyServerEvent } from '../lib/emailService';

function calculateAge(birthDateStr: string): number | null {
  if (!birthDateStr) return null;
  const parts = birthDateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  const [y, m, d] = parts;
  const today = new Date();
  let age = today.getFullYear() - y;
  const mDiff = today.getMonth() + 1 - m;
  if (mDiff < 0 || (mDiff === 0 && today.getDate() < d)) {
    age--;
  }
  return age;
}

export const CandidateProfilePage: React.FC = () => {
  const { token, user } = useAuth();
  const { openLegalModal } = useLegalModal();
  const navigate = useNavigate();

  const today = new Date();
  const maxMin16BirthDate = new Date(
    today.getFullYear() - 16,
    today.getMonth(),
    today.getDate()
  )
    .toISOString()
    .split('T')[0];

  const [industriesCatalog, setIndustriesCatalog] = useState<IndustryItem[]>(INITIAL_INDUSTRIES);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');
  const [location, setLocation] = useState<LocationValue>({
    province: 'Buenos Aires',
    district: 'Carlos Tejedor',
    locality: 'Carlos Tejedor',
  });
  const [workSituation, setWorkSituation] = useState<WorkSituation>('seeking_job');
  const [availability, setAvailability] = useState<string[]>([]);
  const [educationLevel, setEducationLevel] = useState<string>('Secundario completo');
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  const [selectedPositions, setSelectedPositions] = useState<string[]>([]);
  const [otherText, setOtherText] = useState('');
  const [bioShort, setBioShort] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [cvPath, setCvPath] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(true);

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingCv, setUploadingCv] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!user || !token) {
      navigate('/ingresar?rol=candidate');
      return;
    }

    supabase
      .from('industries')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        if (data && data.length > 0) setIndustriesCatalog(data as IndustryItem[]);
      });

    supabase.rpc('get_my_candidate_data', { p_token: token }).then(({ data }) => {
      if (data?.profile) {
        const p = data.profile;
        setFirstName(p.first_name || '');
        setLastName(p.last_name || '');
        setLocation({
          province: p.province || 'Buenos Aires',
          district: p.district || 'Carlos Tejedor',
          locality: p.locality || 'Carlos Tejedor',
        });
        setWorkSituation((p.work_situation as WorkSituation) || 'seeking_job');
        setAvailability(p.availability || []);
        setEducationLevel(p.education_level || 'Secundario completo');
        setSelectedIndustries(p.industries || []);
        setSelectedPositions(p.positions || []);
        setOtherText(p.custom_other_text || '');
        setBioShort(p.bio_short || '');
        setAvatarUrl(p.avatar_url || null);
        setCvPath(p.cv_path || null);
        setIsSearching(p.is_searching ?? true);
      }
      if (data?.private) {
        setPhone(data.private.phone || '');
        setBirthDate(data.private.birth_date || '');
        setGuardianName(data.private.guardian_name || '');
        setGuardianPhone(data.private.guardian_phone || '');
        setGuardianEmail(data.private.guardian_email || '');
      }
    });
  }, [user, token, navigate]);

  const computedAge = calculateAge(birthDate);
  const isMinor = computedAge !== null && computedAge >= 16 && computedAge < 18;

  const availablePositions = Array.from(
    new Set(
      industriesCatalog
        .filter((ind) => selectedIndustries.includes(ind.name))
        .flatMap((ind) => ind.suggested_positions)
    )
  );

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploadingPhoto(true);
    setMessage(null);

    try {
      const dataUrl = await compressImageToDataUrl(file, 384, 0.8);
      setAvatarUrl(dataUrl);
      setMessage({ type: 'ok', text: 'Foto de perfil procesada. Tocá "Guardar mi Perfil" para confirmar.' });
    } catch (err: any) {
      setMessage({ type: 'err', text: err.message || 'Error al subir la foto.' });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleCvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !token) return;
    setUploadingCv(true);
    setMessage(null);

    try {
      const check = await validatePdfFile(file);
      if (!check.valid) {
        throw new Error(check.error);
      }

      const base64Pdf = await fileToBase64(file);
      const { data, error } = await supabase.rpc('upload_candidate_cv', {
        p_token: token,
        p_filename: file.name,
        p_base64_pdf: base64Pdf,
      });

      if (error) throw new Error(error.message);

      setCvPath(data?.cv_path || `/ver-cv/${user.id}`);
      setMessage({ type: 'ok', text: 'Currículum Vitae en PDF guardado de forma segura.' });
    } catch (err: any) {
      setMessage({ type: 'err', text: err.message || 'Error al subir el CV.' });
    } finally {
      setUploadingCv(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    if (!firstName.trim() || !lastName.trim() || !phone.trim() || !location.locality || !birthDate) {
      setMessage({
        type: 'err',
        text: 'Completá nombre, apellido, fecha de nacimiento, teléfono de contacto y elegí tu localidad en los 3 desplegables.',
      });
      return;
    }

    if (computedAge === null || computedAge < 16) {
      setMessage({
        type: 'err',
        text: 'Por la Ley 26.390, debés tener al menos 16 años para registrarte en la bolsa de empleo.',
      });
      return;
    }

    if (isMinor) {
      if (!guardianName.trim() || guardianPhone.replace(/\D/g, '').length < 8) {
        setMessage({
          type: 'err',
          text: 'Como tenés entre 16 y 17 años, completá el nombre completo y el teléfono de tu madre, padre o tutor.',
        });
        return;
      }
      if (guardianEmail.trim() && !guardianEmail.includes('@')) {
        setMessage({
          type: 'err',
          text: 'El correo del adulto responsable no tiene un formato válido (podés dejarlo vacío si no tiene).',
        });
        return;
      }
    }

    if (selectedIndustries.length === 0 || availability.length === 0) {
      setMessage({
        type: 'err',
        text: 'Seleccioná al menos un rubro de interés y tu disponibilidad horaria.',
      });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const { data: saveData, error } = await supabase.rpc('save_candidate_profile', {
        p_token: token,
        p_first_name: firstName,
        p_last_name: lastName,
        p_birth_date: birthDate || null,
        p_phone: phone,
        p_province: location.province,
        p_district: location.district,
        p_locality: location.locality,
        p_work_situation: workSituation,
        p_availability: availability,
        p_education_level: educationLevel,
        p_industries: selectedIndustries,
        p_positions: selectedPositions,
        p_custom_other_text: otherText,
        p_bio_short: bioShort,
        p_avatar_url: avatarUrl,
        p_cv_path: cvPath,
        p_is_searching: isSearching,
        p_guardian_name: isMinor ? guardianName.trim() : null,
        p_guardian_phone: isMinor ? guardianPhone.trim() : null,
        p_guardian_email: isMinor && guardianEmail.trim() ? guardianEmail.trim() : null,
      });

      if (error) throw new Error(error.message);

      if (saveData?.notify_guardian && user?.id) {
        notifyServerEvent({
          token,
          eventType: 'minor_guardian_notice',
          targetId: user.id,
        }).catch(() => {});
      }

      // Apenas guarda el perfil, lo lleva directo a Búsquedas Laborales y Comercios
      navigate('/vacantes');
    } catch (err: any) {
      setMessage({ type: 'err', text: err.message || 'Error al guardar el perfil.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Mi Perfil de Postulante</h1>
          <p className="text-sm text-slate-600">
            Completá tus datos tocando los botones para que los comercios puedan encontrarte.
          </p>
        </div>

        <label className="inline-flex items-center gap-2.5 bg-white px-4 py-2.5 rounded-xl border border-slate-200 shadow-sm cursor-pointer">
          <input
            type="checkbox"
            checked={isSearching}
            onChange={(e) => setIsSearching(e.target.checked)}
            className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500"
          />
          <span className="text-sm font-semibold text-slate-800">
            {isSearching ? '🟢 Mi perfil está activo' : '⏸️ Mi perfil está pausado'}
          </span>
        </label>
      </div>

      {message && (
        <div
          className={`p-4 rounded-xl border text-sm flex items-center gap-2.5 ${
            message.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          {message.type === 'ok' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* 1. Datos Personales y Foto */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
          <h2 className="text-lg font-bold text-slate-900">1. Datos Personales y Foto</h2>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <div className="w-20 h-20 rounded-2xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Foto de perfil" className="w-full h-full object-cover" />
              ) : (
                <Camera className="w-7 h-7 text-slate-400" />
              )}
            </div>

            <div>
              <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold cursor-pointer transition-colors">
                <Camera className="w-4 h-4" />
                <span>{uploadingPhoto ? 'Subiendo foto...' : 'Subir Foto de Perfil'}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">Nombre *</label>
              <input
                type="text"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Ej.: Juan"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">Apellido *</label>
              <input
                type="text"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Ej.: Pérez"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">
                Teléfono celular / WhatsApp * (Privado)
              </label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="Ej.: 2355445566 (solo números)"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none"
              />
              <p className="text-xs text-slate-500 mt-1">
                Solo se muestra a los comercios donde te postules o que autorices.
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">
                Fecha de nacimiento * (Privado · Mínimo 16 años)
              </label>
              <input
                type="date"
                required
                max={maxMin16BirthDate}
                min="1920-01-01"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none"
              />
              {computedAge !== null && (
                <p className="text-xs text-slate-600 mt-1">
                  Edad actual calculada: <strong>{computedAge} años</strong>
                  {isMinor && (
                    <span className="ml-1.5 text-amber-700 font-semibold">
                      (Menor autorizado · Ley 26.390)
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>

          {isMinor && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-amber-950">
                  Autorización de Madre, Padre o Tutor (16 y 17 años · Ley 26.390)
                </h3>
                <p className="text-xs text-amber-800 mt-0.5">
                  Como sos menor de 18 años, completá los datos de tu adulto responsable. Si cargás un correo electrónico, le enviaremos un aviso automático de tu registro.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-amber-950 mb-1">
                    Nombre y Apellido del responsable *
                  </label>
                  <input
                    type="text"
                    required={isMinor}
                    value={guardianName}
                    onChange={(e) => setGuardianName(e.target.value)}
                    placeholder="Ej.: María González"
                    className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs sm:text-sm focus:border-amber-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-amber-950 mb-1">
                    Teléfono del responsable *
                  </label>
                  <input
                    type="tel"
                    required={isMinor}
                    value={guardianPhone}
                    onChange={(e) => setGuardianPhone(e.target.value.replace(/\D/g, ''))}
                    placeholder="Ej.: 2364556677"
                    className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs sm:text-sm focus:border-amber-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-amber-950 mb-1">
                    Email del responsable (Opcional)
                  </label>
                  <input
                    type="email"
                    value={guardianEmail}
                    onChange={(e) => setGuardianEmail(e.target.value)}
                    placeholder="Ej.: mama@gmail.com"
                    className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs sm:text-sm focus:border-amber-600 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 2. Ubicación (3 Selects encadenados) y Situación Laboral */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
          <h2 className="text-lg font-bold text-slate-900">2. Ubicación y Situación Actual</h2>

          <LocationSelector value={location} onChange={setLocation} />

          <div className="space-y-2 pt-2">
            <label className="block text-sm font-semibold text-slate-800">
              ¿Cuál es tu situación laboral hoy? *
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {WORK_SITUATIONS.map((item) => {
                const active = workSituation === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setWorkSituation(item.id)}
                    className={`text-left p-4 rounded-xl border transition-all ${
                      active
                        ? 'border-brand-600 bg-brand-50/70 ring-2 ring-brand-600/20'
                        : 'border-slate-200 hover:border-brand-400 bg-white'
                    }`}
                  >
                    <p className="font-bold text-sm text-slate-900">{item.label}</p>
                    <p className="text-xs text-slate-600 mt-0.5">{item.description}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 3. Opciones Cliqueables: Horarios, Estudios, Rubros y Puestos */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
          <h2 className="text-lg font-bold text-slate-900">
            3. Disponibilidad, Estudios y Rubros (Cliqueá tus opciones)
          </h2>

          <ChipSelector
            label="Disponibilidad Horaria *"
            helperText="Podés elegir una o varias opciones"
            options={AVAILABILITY_OPTIONS}
            selected={availability}
            onChange={setAvailability}
          />

          <ChipSelector
            label="Nivel de Formación / Estudios *"
            options={EDUCATION_LEVELS}
            selected={[educationLevel]}
            multiple={false}
            onChange={(next) => {
              if (next[0]) setEducationLevel(next[0]);
            }}
          />

          <ChipSelector
            label="Rubros de Interés *"
            helperText="Tocá los rubros en los que buscás trabajo"
            options={industriesCatalog.map((i) => i.name)}
            selected={selectedIndustries}
            onChange={setSelectedIndustries}
            allowOther={true}
            otherValue={otherText}
            onOtherChange={setOtherText}
          />

          {availablePositions.length > 0 && (
            <ChipSelector
              label="Puestos u Oficios Específicos"
              helperText="Basados en los rubros que marcaste arriba"
              options={availablePositions}
              selected={selectedPositions}
              onChange={setSelectedPositions}
              allowOther={true}
              otherValue={otherText}
              onOtherChange={setOtherText}
            />
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1">
              Breve presentación o experiencia laboral
            </label>
            <textarea
              rows={3}
              maxLength={400}
              value={bioShort}
              onChange={(e) => setBioShort(e.target.value)}
              placeholder="Contá brevemente tu experiencia, dónde trabajaste antes o qué sabés hacer..."
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Por tu privacidad, no incluyas teléfonos ni correos electrónicos acá (tu teléfono de contacto ya queda guardado en la sección privada de arriba).
            </p>
          </div>
        </div>

        {/* 4. Currículum Vitae en PDF */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-slate-900">4. Currículum Vitae (PDF)</h2>
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-50 hover:bg-brand-100 text-brand-800 border border-brand-200 text-sm font-semibold cursor-pointer transition-colors">
              <FileText className="w-4 h-4" />
              <span>{uploadingCv ? 'Subiendo PDF...' : 'Subir CV en formato PDF'}</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleCvUpload}
                className="hidden"
              />
            </label>

            {cvPath && (
              <a
                href={cvPath}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:underline"
              >
                <Eye className="w-4 h-4" />
                <span>Ver mi CV cargado</span>
              </a>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Formato exclusivo PDF (máximo 5 MB). Solo podrán visualizarlo comercios registrados con sesión activa mientras tu perfil esté activo o tengas una postulación vigente.
          </p>
        </div>

        <div className="bg-slate-100 rounded-2xl border border-slate-200 p-4 text-xs text-slate-700 leading-relaxed">
          <p>
            Al ingresar aceptaste nuestra{' '}
            <button
              type="button"
              onClick={() => openLegalModal({ tab: 'privacy', role: 'candidate' })}
              className="text-brand-700 font-semibold underline hover:text-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-600 rounded"
            >
              Política de Privacidad
            </button>
            : tu perfil laboral, CV y teléfono pueden ser vistos por comercios registrados mientras tu perfil esté activo o tengas una postulación vigente. Podés pausar tu visibilidad en cualquier momento desde el interruptor superior.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold text-base shadow-md transition-colors"
        >
          <Save className="w-5 h-5" />
          <span>{saving ? 'Guardando perfil...' : 'Guardar Perfil e Ir a Búsquedas Laborales'}</span>
        </button>
      </form>

      <PrivacyAndAccountSection role="candidate" />
    </div>
  );
};
