import type { RawTicket } from '@/lib/types';

/**
 * Where a ticket came in, as five original app-style icons. They are drawn here,
 * not taken from any vendor: a real deployment would connect to the customer's own
 * chat, mail, portal and phone systems.
 */
export const CHANNEL: Record<RawTicket['channel'], { word: string; via: string }> = {
  chat: { word: 'Chat', via: 'by chat' },
  email: { word: 'Email', via: 'by email' },
  portal: { word: 'Portal', via: 'through the portal' },
  phone: { word: 'Phone', via: 'by phone' },
  walkup: { word: 'Walk-up', via: 'at the walk-up desk' },
};

const dark = { fill: 'var(--c2)' };
const line = { stroke: 'var(--c2)', fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const GLYPH: Record<RawTicket['channel'], React.ReactNode> = {
  chat: (
    <>
      <rect x="12.500" y="11.500" width="15" height="11.500" rx="4" fill="#fff" opacity="0.45" />
      <path d="M22.500 22l4 4.200V20z" fill="#fff" opacity="0.45" />
      <rect x="4.500" y="5.500" width="18" height="13.500" rx="4.800" fill="#fff" />
      <path d="M8.500 17.500v5.800l6-5.800z" fill="#fff" />
      <circle cx="9.800" cy="12.250" r="1.350" style={dark} />
      <circle cx="13.500" cy="12.250" r="1.350" style={dark} />
      <circle cx="17.200" cy="12.250" r="1.350" style={dark} />
    </>
  ),
  email: (
    <>
      <rect x="4.500" y="8" width="23" height="17" rx="3.800" fill="#fff" />
      <path d="M7 11.200l9 6.800 9-6.800" strokeWidth="2.100" style={line} />
      <circle cx="26" cy="8.500" r="3.700" fill="#ffd166" stroke="var(--c2)" strokeWidth="1.600" />
    </>
  ),
  portal: (
    <>
      <rect x="4.500" y="6" width="23" height="20" rx="3.800" fill="#fff" />
      <path d="M4.500 11.800h23" strokeWidth="1.400" style={line} opacity="0.4" />
      <circle cx="8.300" cy="9" r="1.050" style={dark} />
      <circle cx="11.500" cy="9" r="1.050" style={dark} opacity="0.5" />
      <rect x="8" y="14.600" width="10.500" height="2.400" rx="1.200" style={dark} />
      <rect x="8" y="18.800" width="16" height="2.400" rx="1.200" style={dark} opacity="0.35" />
    </>
  ),
  phone: (
    <>
      <path
        d="M10.900 5.900c.9-.5 2.100-.2 2.600.7l1.800 3.100c.5.800.3 1.900-.5 2.500l-1.400 1.100c1.100 2.300 2.800 4.100 5.200 5.200l1.100-1.400c.6-.8 1.700-1 2.500-.5l3.100 1.800c.9.500 1.200 1.700.7 2.600l-.9 1.600c-.7 1.300-2.200 1.900-3.600 1.600-7.600-1.800-12.600-6.800-14.400-14.400-.3-1.400.300-2.900 1.600-3.600z"
        fill="#fff"
      />
      <path d="M19.300 6.600a7 7 0 0 1 6.100 6.100M19.600 10.700a3 3 0 0 1 2.200 2.200" stroke="#fff" strokeWidth="1.900" fill="none" strokeLinecap="round" opacity="0.6" />
    </>
  ),
  walkup: (
    <>
      <path d="M6.500 21.500a9.500 9.500 0 0 1 19 0z" fill="#fff" />
      <rect x="4.500" y="22.600" width="23" height="3.200" rx="1.600" fill="#fff" />
      <rect x="14.700" y="8.200" width="2.600" height="4.400" rx="1.300" fill="#fff" />
      <circle cx="16" cy="7.300" r="2" fill="#fff" />
      <path d="M11 19.500a5.500 5.500 0 0 1 3.600-4.300" strokeWidth="1.700" style={line} opacity="0.4" />
      <path d="M7 11.800L5 10.200M25 11.800l2-1.600" stroke="#fff" strokeWidth="1.900" strokeLinecap="round" opacity="0.6" />
    </>
  ),
};

export function ChannelIcon({ channel, className = '' }: { channel: RawTicket['channel']; className?: string }) {
  return (
    <span className={`app-ico a-${channel} ${className}`} title={CHANNEL[channel].word}>
      <svg viewBox="0 0 32 32" aria-hidden="true">
        {GLYPH[channel]}
      </svg>
    </span>
  );
}
