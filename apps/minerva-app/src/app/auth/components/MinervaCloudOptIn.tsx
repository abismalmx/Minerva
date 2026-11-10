import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { persistMinervaCloudChoice } from '@/services/sync/cloudSyncActivation';
import { hasAnyThirdPartyEnabled, isMinervaCloudEnabled } from '@/services/sync/cloudSyncProvider';

/**
 * Minerva Cloud opt-in, shown on the sign-in page (#6010).
 *
 * Signing in used to start a library upload before the user had seen a single
 * sync option: a third-party backend needs premium and premium needs an
 * account, so at the moment of sign-in there is by construction no third-party
 * provider enabled, `isMinervaCloudEnabled` derives ON, and `useBooksSync`'s
 * `user` effect fires as soon as /library mounts. Someone signing in only to
 * unlock WebDAV or S3 had no chance to say so first.
 *
 * The choice is written the moment the box is toggled, not on submit, so it
 * survives an OAuth redirect and a magic-link round-trip and is already on
 * disk before the library page can start syncing. It writes through the same
 * settings the Integrations page reads, so unchecking here IS unchecking
 * Minerva Cloud there.
 *
 * Renders nothing until the settings store is hydrated. `isMinervaCloudEnabled`
 * derives ON from an empty object (no explicit flag, no third-party backend),
 * so on a cold /auth load — a deep link, or an OAuth return — the box would
 * show checked over a stored `enabled: false`, and `handleChange` would decide
 * whether to pin or clear from the same empty object. The auth page hydrates
 * on mount; this guard keeps the wrong state off the screen until it does.
 */
interface MinervaCloudOptInProps {
  /**
   * Reports the in-flight settings write. Web OAuth leaves the page with a full
   * redirect, so the sign-in handlers await this before navigating: a torn-off
   * write would silently drop the opt-out and start the very upload this
   * control exists to prevent.
   */
  onPendingWrite?: (write: Promise<unknown>) => void;
}

export default function MinervaCloudOptIn({ onPendingWrite }: MinervaCloudOptInProps) {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const settings = useSettingsStore((state) => state.settings);
  const hydrated = !!settings?.version;
  const checked = isMinervaCloudEnabled(settings);

  const handleChange = (next: boolean) => {
    // Prefer clearing the flag to pinning it: an absent value keeps deriving,
    // which is what lets a later WebDAV / Drive / S3 activation switch Minerva
    // Cloud off instead of mirroring the library to both. Pin only when the
    // derivation would disagree with what the user just chose.
    const derivesToChecked = !hasAnyThirdPartyEnabled(settings);
    const write = persistMinervaCloudChoice(
      envConfig,
      next && derivesToChecked ? undefined : next,
    ).catch((error) => {
      // Swallowed so awaiting this in AuthPanel can never reject the sign-in
      // it is gating; the checkbox falls back to the stored value on re-render.
      console.error('Failed to save the Minerva Cloud choice:', error);
    });
    onPendingWrite?.(write);
  };

  if (!hydrated) return null;

  return (
    <div className='flex w-full flex-col gap-4'>
      <hr className='border-base-300 w-full border-t' />
      <label className='flex cursor-pointer select-none items-start gap-3'>
        <input
          type='checkbox'
          checked={checked}
          onChange={(event) => handleChange(event.target.checked)}
          // `checkbox-xl` is the 2rem box: a checkbox you can actually tap.
          className='checkbox checkbox-xl mt-0.5 shrink-0'
        />
        <span className='flex flex-col gap-1'>
          <span className='text-sm'>{_('Sync with Minerva Cloud')}</span>
          <span className='text-base-content/60 text-xs leading-relaxed'>
            {_(
              'Store your library, reading progress, and highlights in your Minerva account. You can change this any time in Settings.',
            )}
          </span>
        </span>
      </label>
    </div>
  );
}
