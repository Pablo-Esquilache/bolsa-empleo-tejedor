import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ShieldAlert, FileText, Download, ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

export const ViewCvPage: React.FC = () => {
  const { candidateId } = useParams<{ candidateId: string }>();
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>('curriculum.pdf');

  useEffect(() => {
    let generatedUrl: string | null = null;

    async function loadCv() {
      if (!token || !user || !candidateId) {
        setError(
          'Acceso denegado. Debés iniciar sesión con una cuenta autorizada para visualizar este Currículum Vitae.'
        );
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const { data, error: rpcError } = await supabase.rpc('get_authorized_cv_file', {
          p_token: token,
          p_candidate_id: candidateId,
        });

        if (rpcError) {
          throw new Error(rpcError.message);
        }

        if (data?.content_base64) {
          const byteCharacters = atob(data.content_base64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'application/pdf' });
          generatedUrl = URL.createObjectURL(blob);
          setBlobUrl(generatedUrl);
          setFilename(data.filename || 'curriculum.pdf');
        } else {
          throw new Error('No se encontró un archivo PDF para este postulante.');
        }
      } catch (err: any) {
        setError(
          err.message ||
            'Acceso denegado. No tenés permisos para visualizar este Currículum Vitae.'
        );
      } finally {
        setLoading(false);
      }
    }

    loadCv();

    return () => {
      if (generatedUrl) {
        URL.revokeObjectURL(generatedUrl);
      }
    };
  }, [token, user, candidateId]);

  const handleGoBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-3">
        <FileText className="w-10 h-10 text-brand-600 mx-auto animate-pulse" />
        <p className="text-sm font-semibold text-slate-700">
          Verificando permisos y abriendo Currículum Vitae...
        </p>
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16">
        <div className="bg-white rounded-2xl border border-rose-200 p-8 text-center shadow-sm space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">No disponible</h1>
          <p className="text-sm text-slate-600">{error}</p>
          <div className="pt-2 flex items-center justify-center gap-3">
            {!token ? (
              <Link
                to="/ingresar"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold"
              >
                <span>Iniciar sesión</span>
              </Link>
            ) : (
              <button
                type="button"
                onClick={handleGoBack}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Volver atrás</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-2.5">
          <FileText className="w-5 h-5 text-brand-600" />
          <span className="font-bold text-sm text-slate-900">{filename}</span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={blobUrl}
            download={filename}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold"
          >
            <Download className="w-4 h-4" />
            <span>Descargar PDF</span>
          </a>
          <button
            type="button"
            onClick={handleGoBack}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Volver</span>
          </button>
        </div>
      </div>

      <div className="bg-slate-900 rounded-2xl overflow-hidden border border-slate-300 shadow-lg h-[78vh]">
        <iframe src={blobUrl} title="Currículum Vitae PDF" className="w-full h-full border-0" />
      </div>
    </div>
  );
};
