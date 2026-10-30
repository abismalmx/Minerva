import clsx from 'clsx';
import React, { useState, useEffect } from 'react';
import {
  RiCloudLine,
  RiCheckLine,
  RiFileCopyLine,
  RiCloseLine,
  RiRefreshLine,
  RiShieldCheckLine,
  RiAlertLine,
  RiTerminalBoxLine,
} from 'react-icons/ri';
import { useTranslation } from '@/hooks/useTranslation';
import {
  getCustomBackendUrl,
  setCustomBackendUrl,
  getBaseUrl,
  sanitizeBackendUrl,
} from '@/services/environment';
import SubPageHeader from '../SubPageHeader';
import { SectionTitle, SettingLabel, Tips } from '../primitives';

interface CloudflareAssistantFormProps {
  onBack: () => void;
}

const DEPLOY_COMMAND = 'pnpm deploy:cloudflare';
const DEPLOY_SCRIPT_COMMAND = './scripts/deploy-cloudflare.sh';

export const CloudflareAssistantForm: React.FC<CloudflareAssistantFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [inputUrl, setInputUrl] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState<string>('');
  const [activeTabCommand, setActiveTabCommand] = useState<'pnpm' | 'sh'>('pnpm');

  useEffect(() => {
    const saved = getCustomBackendUrl() || '';
    setCurrentUrl(saved);
    setInputUrl(saved || getBaseUrl() || '');
  }, []);

  const handleCopyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  };

  const handleTestConnection = async () => {
    const sanitized = sanitizeBackendUrl(inputUrl);
    if (!sanitized) {
      setTestState('error');
      setTestMessage(
        _(
          'URL no válida o insegura. Debe comenzar con https:// (o http://localhost para pruebas locales).',
        ),
      );
      return;
    }

    setTestState('testing');
    setTestMessage(_('Comprobando salud del backend...'));

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${sanitized}/health`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json().catch(() => null);
      if (data && (data.status === 'ok' || data.status === 'healthy')) {
        setTestState('success');
        setTestMessage(_('¡Conexión exitosa! El backend de Minerva responde correctamente.'));
      } else {
        setTestState('success');
        const preview = JSON.stringify(data).slice(0, 100);
        setTestMessage(_('El Worker respondió pero con formato inesperado: ') + preview);
      }
    } catch (err: unknown) {
      setTestState('error');
      const msg = err instanceof Error ? err.message : String(err);
      setTestMessage(_('Error de conexión: ') + msg);
    }
  };

  const handleSaveAndActivate = () => {
    if (!inputUrl.trim()) {
      handleDisconnect();
      return;
    }

    const sanitized = sanitizeBackendUrl(inputUrl);
    if (!sanitized) {
      setTestState('error');
      setTestMessage(
        _(
          'URL no válida o insegura. Debe comenzar con https:// (o http://localhost para pruebas locales).',
        ),
      );
      return;
    }

    setCustomBackendUrl(sanitized);
    setCurrentUrl(sanitized);
    setTestState('success');
    setTestMessage(_('Minerva Cloud activado. Se recargará la configuración.'));

    setTimeout(() => {
      window.location.reload();
    }, 1000);
  };

  const handleDisconnect = () => {
    setCustomBackendUrl(null);
    setCurrentUrl('');
    setInputUrl('');
    setTestState('idle');
    setTestMessage(_('Desconectado. Restaurado backend por defecto.'));

    setTimeout(() => {
      window.location.reload();
    }, 1000);
  };

  const commandToDisplay = activeTabCommand === 'pnpm' ? DEPLOY_COMMAND : DEPLOY_SCRIPT_COMMAND;

  return (
    <div className='my-4 w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('Minerva Cloud (Cloudflare)')}
        description={_(
          'Despliega tu backend propio en Cloudflare con un solo comando y sincroniza tus libros, progreso y notas de forma gratuita.',
        )}
        onBack={onBack}
      />

      <div className='space-y-6 px-4'>
        {/* Estado actual */}
        <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border p-4'>
          <div className='flex items-center justify-between gap-3'>
            <div className='flex items-center gap-3'>
              <div
                className={clsx(
                  'flex h-10 w-10 items-center justify-center rounded-lg',
                  currentUrl ? 'bg-success/15 text-success' : 'bg-base-200 text-base-content/60',
                )}
              >
                <RiCloudLine className='h-6 w-6' />
              </div>
              <div>
                <h4 className='font-semibold text-base'>
                  {currentUrl ? _('Minerva Cloud Conectado') : _('Backend Predeterminado')}
                </h4>
                <p className='text-xs text-base-content/70 break-all'>
                  {currentUrl
                    ? currentUrl
                    : _('Sin backend auto-hospedado configurado en este cliente.')}
                </p>
              </div>
            </div>

            {currentUrl && (
              <button
                type='button'
                onClick={handleDisconnect}
                className='btn btn-xs btn-outline btn-error shrink-0 gap-1'
              >
                <RiCloseLine className='h-3.5 w-3.5' />
                {_('Desconectar')}
              </button>
            )}
          </div>
        </div>

        {/* Sección 1: Despliegue All-in-One */}
        <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border p-4 space-y-3'>
          <div className='flex items-center gap-2 text-primary'>
            <RiTerminalBoxLine className='h-5 w-5' />
            <SectionTitle className='!mb-0 text-base font-semibold'>
              {_('1. Despliegue All-in-One en Cloudflare')}
            </SectionTitle>
          </div>

          <p className='text-sm text-base-content/80'>
            {_(
              'Ejecuta este comando en tu terminal para crear automáticamente tu base de datos D1, bucket R2, secreto criptográfico JWT, aplicar migraciones y publicar el Worker en tu subdominio gratuito de Cloudflare:',
            )}
          </p>

          <div className='flex items-center gap-2 text-xs'>
            <button
              type='button'
              onClick={() => setActiveTabCommand('pnpm')}
              className={clsx(
                'rounded px-2.5 py-1 font-medium transition-colors',
                activeTabCommand === 'pnpm'
                  ? 'bg-primary text-primary-content'
                  : 'bg-base-200 text-base-content/70 hover:bg-base-300',
              )}
            >
              pnpm
            </button>
            <button
              type='button'
              onClick={() => setActiveTabCommand('sh')}
              className={clsx(
                'rounded px-2.5 py-1 font-medium transition-colors',
                activeTabCommand === 'sh'
                  ? 'bg-primary text-primary-content'
                  : 'bg-base-200 text-base-content/70 hover:bg-base-300',
              )}
            >
              bash script
            </button>
          </div>

          <div className='relative flex items-center justify-between rounded-lg bg-base-300/80 p-3 font-mono text-sm'>
            <code className='text-xs sm:text-sm select-all overflow-x-auto pr-16'>
              {commandToDisplay}
            </code>
            <button
              type='button'
              onClick={() => handleCopyCommand(commandToDisplay)}
              className={clsx(
                'btn btn-sm btn-ghost absolute right-2 gap-1.5',
                copied && 'text-success',
              )}
              title={_('Copiar comando')}
            >
              {copied ? (
                <>
                  <RiCheckLine className='h-4 w-4' />
                  <span className='text-xs font-semibold'>{_('¡Copiado!')}</span>
                </>
              ) : (
                <>
                  <RiFileCopyLine className='h-4 w-4' />
                  <span className='text-xs'>{_('Copiar')}</span>
                </>
              )}
            </button>
          </div>

          <Tips>
            <li>
              {_(
                'El script es 100% idempotente: puedes volver a ejecutarlo sin riesgo ni pérdida de datos.',
              )}
            </li>
            <li>
              {_(
                'Todo corre en el plan gratuito de Cloudflare (D1 + R2 + Workers) sin coste ni tarjeta obligatoria.',
              )}
            </li>
          </Tips>
        </div>

        {/* Sección 2: Conectar Aplicación */}
        <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border p-4 space-y-4'>
          <div className='flex items-center gap-2 text-primary'>
            <RiShieldCheckLine className='h-5 w-5' />
            <SectionTitle className='!mb-0 text-base font-semibold'>
              {_('2. Conectar tu Servidor')}
            </SectionTitle>
          </div>

          <p className='text-sm text-base-content/80'>
            {_(
              'Pega la URL de tu Worker generada tras el despliegue (ej. https://minerva-cloudflare.<subdominio>.workers.dev):',
            )}
          </p>

          <div className='space-y-2'>
            <SettingLabel>{_('URL del Worker de Cloudflare')}</SettingLabel>
            <div className='flex flex-col sm:flex-row items-stretch sm:items-center gap-2'>
              <input
                type='url'
                value={inputUrl}
                onChange={(e) => {
                  setInputUrl(e.target.value);
                  setTestState('idle');
                }}
                placeholder='https://minerva-cloudflare.tu-subdominio.workers.dev'
                className='input input-bordered input-sm flex-1 font-mono text-xs sm:text-sm'
              />
              <button
                type='button'
                onClick={handleTestConnection}
                disabled={testState === 'testing'}
                className='btn btn-sm btn-outline gap-1.5 shrink-0'
              >
                <RiRefreshLine
                  className={clsx('h-3.5 w-3.5', testState === 'testing' && 'animate-spin')}
                />
                {_('Probar Conexión')}
              </button>
            </div>
          </div>

          {/* Mensaje de prueba */}
          {testState !== 'idle' && (
            <div
              className={clsx(
                'rounded-lg p-3 text-xs flex items-center gap-2',
                testState === 'testing' && 'bg-base-200 text-base-content',
                testState === 'success' && 'bg-success/15 text-success font-medium',
                testState === 'error' && 'bg-error/15 text-error font-medium',
              )}
            >
              {testState === 'testing' && (
                <RiRefreshLine className='h-4 w-4 animate-spin shrink-0' />
              )}
              {testState === 'success' && <RiCheckLine className='h-4 w-4 shrink-0' />}
              {testState === 'error' && <RiAlertLine className='h-4 w-4 shrink-0' />}
              <span>{testMessage}</span>
            </div>
          )}

          <div className='flex items-center justify-end gap-3 pt-2'>
            <button
              type='button'
              onClick={handleSaveAndActivate}
              disabled={!inputUrl.trim() || testState === 'testing'}
              className='btn btn-sm btn-primary gap-1.5'
            >
              <RiCheckLine className='h-4 w-4' />
              {_('Guardar y Activar')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CloudflareAssistantForm;
