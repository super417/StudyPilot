import type { CSSProperties } from 'react';

const SURF =
  'M 0 305.9828838196134 Q 227.6031525693441 450 600 302.17553022897005 Q 1010.7738828515054 450 1200 343.3024459932802 Q 1379.4406250195766 450 1800 320.38902780838214 Q 2153.573162029817 450 2400 314.38564046970816 L 2400 800 L 0 800 L 0 340.3112176762882 Z';

const JAGGED =
  'M0,288L9.2,250.7C18.5,213,37,139,55,133.3C73.8,128,92,192,111,224C129.2,256,148,256,166,256C184.6,256,203,256,222,250.7C240,245,258,235,277,213.3C295.4,192,314,160,332,170.7C350.8,181,369,235,388,229.3C406.2,224,425,160,443,122.7C461.5,85,480,75,498,74.7C516.9,75,535,85,554,101.3C572.3,117,591,139,609,170.7C627.7,203,646,245,665,256C683.1,267,702,245,720,245.3C738.5,245,757,267,775,266.7C793.8,267,812,245,831,234.7C849.2,224,868,224,886,218.7C904.6,213,923,203,942,170.7C960,139,978,85,997,53.3C1015.4,21,1034,11,1052,48C1070.8,85,1089,171,1108,197.3C1126.2,224,1145,192,1163,197.3C1181.5,203,1200,245,1218,224C1236.9,203,1255,117,1274,106.7C1292.3,96,1311,160,1329,170.7C1347.7,181,1366,139,1385,128C1403.1,117,1422,139,1431,149.3L1440,160L1440,320L1430.8,320C1421.5,320,1403,320,1385,320C1366.2,320,1348,320,1329,320C1310.8,320,1292,320,1274,320C1255.4,320,1237,320,1218,320C1200,320,1182,320,1163,320C1144.6,320,1126,320,1108,320C1089.2,320,1071,320,1052,320C1033.8,320,1015,320,997,320C978.5,320,960,320,942,320C923.1,320,905,320,886,320C867.7,320,849,320,831,320C812.3,320,794,320,775,320C756.9,320,738,320,720,320C701.5,320,683,320,665,320C646.2,320,628,320,609,320C590.8,320,572,320,554,320C535.4,320,517,320,498,320C480,320,462,320,443,320C424.6,320,406,320,388,320C369.2,320,351,320,332,320C313.8,320,295,320,277,320C258.5,320,240,320,222,320C203.1,320,185,320,166,320C147.7,320,129,320,111,320C92.3,320,74,320,55,320C36.9,320,18,320,9,320L0,320Z';

const SURF_LAYERS: Array<[string, number]> = [
  ['0.05', 35],
  ['0.21', 70],
  ['0.37', 105],
  ['0.53', 140],
  ['0.68', 175],
  ['0.84', 210],
  ['1', 245],
];

/** 倒影画在盒外，留出与按钮相近的空白，避免被航图根节点裁掉，也避免压住副文案。 */
const reflectStyle = {
  WebkitBoxReflect: 'below 0px linear-gradient(to bottom, rgba(0,0,0,0.0), rgba(0,0,0,0.4))',
} as CSSProperties;

export default function GlassCta({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="group pointer-events-auto mx-auto mb-24 w-fit">
      <button
        type="button"
        data-glass-cta="true"
        style={reflectStyle}
        onClick={onClick}
        className="relative z-10 min-w-[17.5rem] cursor-pointer overflow-hidden rounded-full bg-gradient-to-r from-emerald-300/70 to-green-400/60 px-10 py-4 font-serif text-3xl font-semibold uppercase tracking-widest text-transparent shadow-xl shadow-emerald-700/40 after:absolute after:left-1/2 after:top-1/2 after:h-[85%] after:w-[95%] after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-white/45 after:content-[''] hover:saturate-[1.15] group-hover:shadow-2xl group-hover:shadow-emerald-500/50 active:saturate-[1.4]"
      >
        <span className="whitespace-nowrap">{label}</span>
        <p
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 z-40 h-full w-full -translate-x-1/2 -translate-y-[30%] bg-gradient-to-r from-emerald-900 to-teal-800 bg-clip-text text-center font-semibold tracking-widest text-transparent"
        >
          {label}
        </p>
        <svg
          className="journey-glass-wave absolute left-1/2 top-1/2 z-30 h-full w-full -translate-x-1/2 -translate-y-1/2 scale-x-125 rotate-180 animate-pulse transition-all duration-300 group-hover:-translate-y-[45%] group-hover:animate-none"
          viewBox="0 0 2400 800"
          xmlnsXlink="http://www.w3.org/1999/xlink"
          version="1.1"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="sssurf-grad" y2="100%" x2="50%" y1="0%" x1="50%">
              <stop offset="0%" stopOpacity={0.55} stopColor="hsl(142, 62%, 78%)" />
              <stop offset="100%" stopOpacity={0.82} stopColor="hsl(174, 64%, 40%)" />
            </linearGradient>
          </defs>
          <g transform="matrix(1,0,0,1,0,-91.0877685546875)" fill="url(#sssurf-grad)">
            {SURF_LAYERS.map(([opacity, y]) => (
              <path key={y} opacity={opacity} transform={`matrix(1,0,0,1,0,${y})`} d={SURF} />
            ))}
          </g>
        </svg>
        <svg
          className="journey-glass-wave absolute left-1/2 top-1/2 z-40 h-full w-full -translate-x-1/2 -translate-y-[30%] fill-teal-500/55 transition-all duration-500 group-hover:-translate-y-[33%] group-hover:scale-95"
          viewBox="0 0 1440 320"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path d={JAGGED} fillOpacity={1} />
        </svg>
      </button>
    </div>
  );
}
