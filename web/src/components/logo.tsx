/** Strata wordmark — layered bars (strata / tranches) in the brand gradient. */
export function Logo({ size = 22, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="3" y="4" width="18" height="4" rx="1.5" fill="url(#strata-g)" />
        <rect x="3" y="10" width="18" height="4" rx="1.5" fill="url(#strata-g)" opacity="0.7" />
        <rect x="3" y="16" width="18" height="4" rx="1.5" fill="url(#strata-g)" opacity="0.45" />
        <defs>
          <linearGradient id="strata-g" x1="3" y1="4" x2="21" y2="20" gradientUnits="userSpaceOnUse">
            <stop stopColor="#a78bfa" />
            <stop offset="1" stopColor="#38bdf8" />
          </linearGradient>
        </defs>
      </svg>
      {withText && <span className="text-lg font-semibold tracking-tight">Strata</span>}
    </span>
  );
}
