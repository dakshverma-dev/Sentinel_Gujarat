// Sentinel Gujarat mark: a watch-point — a fixed vantage over converging
// sightlines. Reads at 18px in the sidebar and 25px on the login page.
export default function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 3 L27 8.5 V16 C27 22.5 22.4 27.3 16 29 C9.6 27.3 5 22.5 5 16 V8.5 Z"
        stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="none" opacity="0.55" />
      <circle cx="16" cy="15.5" r="3.1" fill="currentColor" />
      <path d="M16 6.8 V11.3 M16 19.7 V24.4 M9 15.5 H11.9 M20.1 15.5 H23" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
