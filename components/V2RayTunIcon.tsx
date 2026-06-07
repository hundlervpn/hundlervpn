export default function V2RayTunIcon({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
    >
      <rect
        width="37"
        height="37"
        x="5.5"
        y="5.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        rx="4"
        ry="4"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m28.944 11.202l-8.479 25.596l-8.478-25.596M28.31 29.02a3.856 3.856 0 0 1 4.616-3.778c1.615.31 2.905 1.708 3.066 3.345c.12 1.218-.266 2.42-1.107 3.158c-1.558 1.367-6.576 5.052-6.576 5.052h7.704"
      />
    </svg>
  );
}
