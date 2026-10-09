// Ilustración vectorial premium para la franja de "stock bajo":
// dos teléfonos de acabado metálico dorado, ondas de luz y un destello suave.
export default function BannerArt() {
  return (
    <svg className="ah-art" viewBox="0 0 220 120" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="artGlow" cx="70%" cy="45%" r="60%">
          <stop offset="0" stopColor="#e6c47a" stopOpacity=".38" />
          <stop offset=".55" stopColor="#b8873a" stopOpacity=".1" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="artWave" x1="0" x2="1">
          <stop offset="0" stopColor="#f6dfa6" stopOpacity="0" />
          <stop offset=".5" stopColor="#f6dfa6" stopOpacity=".9" />
          <stop offset="1" stopColor="#c99b4f" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="artBody" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5a4a30" />
          <stop offset=".35" stopColor="#2b241a" />
          <stop offset=".7" stopColor="#171410" />
          <stop offset="1" stopColor="#3d3222" />
        </linearGradient>
        <linearGradient id="artBodyBack" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a3022" />
          <stop offset="1" stopColor="#100e0b" />
        </linearGradient>
        <linearGradient id="artRim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbe8b8" />
          <stop offset=".3" stopColor="#c99b4f" />
          <stop offset=".6" stopColor="#7a5520" />
          <stop offset="1" stopColor="#e9cb8a" />
        </linearGradient>
        <linearGradient id="artGloss" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".18" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="artLens" cx="40%" cy="35%" r="65%">
          <stop offset="0" stopColor="#4a5a6e" />
          <stop offset=".35" stopColor="#141a22" />
          <stop offset="1" stopColor="#050607" />
        </radialGradient>
        <filter id="artBlur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6" /></filter>
        <clipPath id="artFront"><rect x="128" y="14" width="64" height="128" rx="13" transform="rotate(-14 160 78)" /></clipPath>
      </defs>

      {/* halo y ondas de luz */}
      <rect width="220" height="120" fill="url(#artGlow)" />
      <g fill="none" strokeLinecap="round" filter="url(#artBlur)">
        <path d="M20 112 C80 70 130 98 220 40" stroke="url(#artWave)" strokeWidth="1.6" opacity=".7" />
        <path d="M40 120 C95 84 150 108 220 62" stroke="url(#artWave)" strokeWidth="1" opacity=".5" />
      </g>
      <g fill="none" strokeLinecap="round">
        <path d="M30 116 C88 76 136 100 220 48" stroke="url(#artWave)" strokeWidth=".7" opacity=".9" />
      </g>

      {/* teléfono trasero */}
      <g transform="rotate(-6 128 70)">
        <rect x="104" y="20" width="58" height="118" rx="12" fill="url(#artBodyBack)" stroke="url(#artRim)" strokeWidth="1.1" opacity=".75" />
      </g>

      {/* sombra del teléfono frontal */}
      <ellipse cx="166" cy="118" rx="40" ry="5" fill="#000" opacity=".55" filter="url(#artBlur)" />

      {/* teléfono frontal */}
      <g transform="rotate(-14 160 78)">
        <rect x="128" y="14" width="64" height="128" rx="13" fill="url(#artBody)" />
        <rect x="128" y="14" width="64" height="128" rx="13" fill="none" stroke="url(#artRim)" strokeWidth="1.6" />
        <rect x="130.5" y="16.5" width="59" height="123" rx="11" fill="none" stroke="#fff" strokeOpacity=".06" />
        {/* módulo de cámara */}
        <rect x="134" y="20" width="30" height="30" rx="8" fill="#1a1611" stroke="url(#artRim)" strokeWidth=".8" />
        {[[142, 28], [142, 42], [155, 35]].map(([cx, cy], i) => (
          <g key={i}>
            <circle cx={cx} cy={cy} r="5.6" fill="#0b0a08" stroke="url(#artRim)" strokeWidth=".9" />
            <circle cx={cx} cy={cy} r="3.9" fill="url(#artLens)" />
            <circle cx={cx - 1.3} cy={cy - 1.4} r=".9" fill="#fff" opacity=".55" />
          </g>
        ))}
        <circle cx="157" cy="25" r="1.4" fill="#f6e7c4" opacity=".8" />
        {/* emblema discreto */}
        <circle cx="160" cy="88" r="6" fill="none" stroke="url(#artRim)" strokeWidth=".8" opacity=".55" />
        {/* reflejo diagonal */}
        <g clipPath="url(#artFront)" transform="rotate(14 160 78)">
          <rect className="ah-art-shine" x="60" y="-20" width="26" height="180" fill="url(#artGloss)" transform="rotate(22 160 78)" />
        </g>
      </g>
    </svg>
  )
}
