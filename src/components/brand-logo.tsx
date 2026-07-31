import Svg, { Defs, LinearGradient, Line, Rect, Stop } from 'react-native-svg';

/**
 * The Marquee mark: a rounded-square frame (lime → cyan) split by a center line,
 * with an equalizer of neon bars inside. Vector, so it stays crisp at any size
 * and matches the "Electric Stage" palette.
 *
 * The colours are literals rather than theme tokens on purpose — the mark is a
 * fixed brand asset, and it has to match the one drawn by hand in the Worker's
 * server-rendered pages, which has no access to the app's theme.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Defs>
        <LinearGradient id="mqFrame" x1="0" y1="0" x2="64" y2="0" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#c3f400" />
          <Stop offset="1" stopColor="#00dbe9" />
        </LinearGradient>
      </Defs>

      {/* Frame */}
      <Rect x="6" y="9" width="52" height="46" rx="15" stroke="url(#mqFrame)" strokeWidth="3.5" />

      {/* Center divider */}
      <Line x1="32" y1="13" x2="32" y2="51" stroke="#00dbe9" strokeWidth="3" strokeLinecap="round" />

      {/* Equalizer bars — lime on the left, cyan on the right */}
      <Line x1="18.5" y1="26" x2="18.5" y2="40" stroke="#abd600" strokeWidth="3.5" strokeLinecap="round" />
      <Line x1="25" y1="22" x2="25" y2="44" stroke="#c3f400" strokeWidth="3.5" strokeLinecap="round" />
      <Line x1="39" y1="20" x2="39" y2="46" stroke="#00dbe9" strokeWidth="3.5" strokeLinecap="round" />
      <Line x1="45.5" y1="27" x2="45.5" y2="39" stroke="#7df4ff" strokeWidth="3.5" strokeLinecap="round" />
    </Svg>
  );
}
