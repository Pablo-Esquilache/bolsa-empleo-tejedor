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
import { compressImageToWebP } from '../lib/imageCompression';
import { validatePdfFile } from '../lib/pdfValidation';
import { IndustryItem, WorkSituation } from '../types/database';

export const CandidateProfilePage: React.FC = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();

  const [industriesCatalog, setIndustriesCatalog] = useState<IndustryItem[]>(INITIAL_INDUSTRIES);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
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
      }
    });
  }, [user, token, navigate]);

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
      const compressed = await compressImageToWebP(file, 512, 0.82);
      const filePath = `${user.id}/avatar-${Date.now()}.webp`;

      const { error } = await supabase.storage
        .from('avatars_and_logos')
        .upload(filePath, compressed, { upsert: true, contentType: 'image/webp' });

      if (error) throw new Error(error.message);

      const { data: pub } = supabase.storage.from('avatars_and_logos').getPublicUrl(filePath);
      setAvatarUrl(pub.publicUrl);
    } catch (err: any) {
      setMessage({ type: 'err', text: err.message || 'Error al subir la foto.' });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleCvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploadingCv(true);
    setMessage(null);

    try {
      const check = await validatePdfFile(file);
      if (!check.valid) {
        throw new Error(check.error);
      }

      const filePath = `${user.id}/cv-${Date.now()}.pdf`;
      const { error } = await supabase.storage
        .from('cvs')
        .upload(filePath, file, { upsert: true, contentType: 'application/pdf' });

      if (error) throw new Error(error.message);

      const { data: pub } = supabase.storage.from('cvs').getPublicUrl(filePath);
      setCvPath(pub.publicUrl);
      setMessage({ type: 'ok', text: 'Currículum Vitae en PDF subido con éxito.' });
    } catch (err: any) {
      setMessage({ type: 'err', text: err.message || 'Error al subir el CV.' });
    } finally {
      setUploadingCv(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    if (!firstName.trim() || !lastName.trim() || !phone.trim() || !location.locality) {
      setMessage({
        type: 'err',
        text: 'Completá nombre, apellido, teléfono de contacto y elegí tu localidad en los 3 desplegables.',
      });
      return;
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
      const { error } = await supabase.rpc('save_candidate_profile', {
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
      });

      if (error) throw new Error(error.message);

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
                Fecha de nacimiento (Privado)
              </label>
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none"
              />
            </div>
          </div>
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
            Formato exclusivo PDF (máximo 5 MB). Podrán verlo los comercios donde te postules.
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
    </div>
  );
};
