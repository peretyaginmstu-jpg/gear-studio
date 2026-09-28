"use client";
import { useId, type ReactNode } from 'react';
import type { MeasurementDiagram } from '@/lib/measurementGuide';

// Deliberately schematic outlines. These drawings do not use or represent the user's model.
const outline = (cx: number, cy: number, root: number, tip: number, teeth = 16) =>
  Array.from({ length: teeth * 4 }, (_, i) => {
    const a = (i / (teeth * 4)) * Math.PI * 2, r = i % 4 === 1 || i % 4 === 2 ? tip : root;
    return `${i ? 'L' : 'M'}${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`;
  }).join(' ') + ' Z';
const captions: Record<MeasurementDiagram, string> = {
  capture: 'Торец целиком и резкий контур на контрастном фоне.', directions: 'Вид сбоку: проследите зуб по всей ширине венца.',
  'external-diameter': 'da — окружность вершин; d — делительная окружность.', 'internal-diameter': 'Внутренний da проходит по вершинам, обращённым к центру.',
  scale: 'Вид сбоку: метки эталона на той же высоте, что и измеряемый торец.', pitch: 'Пять одноимённых точек образуют четыре промежутка.',
  module: 'Делительная окружность d — расчётная, видимой кромки на ней нет.', 'external-body': 'Разрез: b относится к венцу. Выступ ступицы в b не входит.',
  'internal-body': 's — толщина материала снаружи окружности впадин.', 'rack-body': 'h — основание ниже линии впадин, без высоты зубьев.',
  worm: 'L — длина нарезанного участка. По этой боковой схеме нельзя сосчитать заходы.', bevel: 'b идёт по образующей делительного конуса, L — вдоль оси.',
};

export function MeasurementIllustration({ diagram }: { diagram: MeasurementDiagram }) {
  const id = useId().replaceAll(':', ''), marker = `${id}-arrow`;
  const dim = (x1: number, y1: number, x2: number, y2: number, label: string, lx: number, ly: number) => <g className="measure-dimension">
    <line x1={x1} y1={y1} x2={x2} y2={y2} markerStart={`url(#${marker})`} markerEnd={`url(#${marker})`} />
    <text x={lx} y={ly} textAnchor="middle">{label}</text>
  </g>;
  const gear = (cx: number, cy: number, radius: number) => <g><path className="measure-metal" d={outline(cx, cy, radius * .8, radius)} /><circle cx={cx} cy={cy} r={radius * .23} className="measure-hole" /></g>;
  const ring = <path className="measure-metal" fillRule="evenodd" d={`M300 114 A90 90 0 1 0 120 114 A90 90 0 1 0 300 114 Z ${outline(210, 114, 65, 50)}`} />;
  let drawing: ReactNode;
  switch (diagram) {
    case 'capture': drawing = <>
      <rect x={49} y={24} width={322} height={188} rx={9} fill="#fff" stroke="#91a4b7" strokeWidth={2} strokeDasharray="7 5" />
      {gear(173, 118, 68)}<path d="M282 62 H309 V176 H282 Z" fill="#f4dfb9" stroke="#a57d3c" strokeWidth={2} />
      {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <line key={i} x1={282} x2={i % 2 ? 293 : 300} y1={70 + i * 14} y2={70 + i * 14} stroke="#a57d3c" strokeWidth={2} />)}
      <text x={210} y={232} textAnchor="middle">Весь контур в кадре</text>
    </>; break;
    case 'directions': drawing = <>{[54, 166, 278].map((x, i) => <g key={x}>
      <rect className="measure-metal" x={x} y={55} width={88} height={125} rx={3} />
      <clipPath id={`${id}-side-${i}`}><rect x={x} y={55} width={88} height={125} /></clipPath>
      <g clipPath={`url(#${id}-side-${i})`} stroke="#526f88" strokeWidth={3} fill="none">{Array.from({ length: 7 }, (_, j) =>
        <path key={j} d={i === 0 ? `M${x + j * 20 - 20} 55 v125` : i === 1 ? `M${x + j * 20 - 40} 55 l44 125` : `M${x + j * 20 - 40} 55 l26 62.5 l-26 62.5`} />)}</g>
      <text x={x + 44} y={213} textAnchor="middle">{['Прямые', 'Косые', 'Шеврон'][i]}</text>
    </g>)}</>; break;
    case 'external-diameter': case 'module': drawing = <>
      {gear(210, 115, 83)}<circle className="measure-tip-circle" cx={210} cy={115} r={83} />
      <circle className="measure-construction" cx={210} cy={115} r={70} />
      <path className="measure-extension" d="M127 109 V25 M293 109 V25" />{dim(127, 28, 293, 28, 'da', 210, 19)}
      {dim(140, 115, 280, 115, 'd', 210, 102)}
      <text x={210} y={229} textAnchor="middle">{diagram === 'module' ? 'd ≠ da' : 'Окружность вершин'}</text>
    </>; break;
    case 'internal-diameter': drawing = <>
      {ring}<circle className="measure-tip-circle" cx={210} cy={114} r={50} />
      <circle className="measure-construction" cx={210} cy={114} r={60} />
      {dim(160, 114, 260, 114, 'da', 210, 101)}
      <path className="measure-extension" d="M297 75 H348 V57" /><text x={345} y={42} textAnchor="end">Обод</text>
      <text x={210} y={231} textAnchor="middle">Вершины внутри кольца</text>
    </>; break;
    case 'scale': drawing = <>
      <path className="measure-metal" d="M62 105 H178 V180 H62 Z" />
      <rect x={248} y={113} width={104} height={67} rx={2} fill="#e9e4da" stroke="#ac9c82" strokeWidth={2} />
      <path d="M244 105 H356" stroke="#a87b35" strokeWidth={7} />
      <path d="M254 98 V112 M346 98 V112" stroke="#6e501f" strokeWidth={3} />
      <path d="M35 105 H385" stroke="#247858" strokeWidth={2} strokeDasharray="6 4" />
      <path className="measure-extension" d="M30 182 H390" />
      <path d="M180 20 H217 V42 H180 Z M190 42 L174 62 H222 L206 42" fill="#e5ecf3" stroke="#526f88" strokeWidth={2} />
      <path d="M198 67 V92" className="measure-dimension" markerEnd={`url(#${marker})`} />
      <text x={120} y={208} textAnchor="middle">Деталь</text><text x={300} y={208} textAnchor="middle">Подставка</text>
      <text x={300} y={85} textAnchor="middle">Эталон</text>
    </>; break;
    case 'pitch': case 'rack-body': drawing = <>
      <path className="measure-metal" d={`M48 186 V130 ${Array.from({ length: 5 }, (_, i) => `H${60 + i * 60} L${76 + i * 60} 86 H${94 + i * 60} L${110 + i * 60} 130`).join(' ')} H372 V186 Z`} />
      {diagram === 'pitch' ? <>
        {[85, 145, 205, 265, 325].map((x, i) => <g key={x}><line className="measure-construction" x1={x} y1={50} x2={x} y2={102} /><circle cx={x} cy={86} r={4} fill="#286e99" /><text x={x} y={73} textAnchor="middle" fontSize={15}>{i + 1}</text></g>)}
        {dim(85, 42, 325, 42, 'L', 205, 29)}<text x={210} y={226} textAnchor="middle">pt = L / 4</text>
      </> : <><path className="measure-construction" d="M36 130 H398" />{dim(397, 130, 397, 186, 'h', 397, 117)}<text x={210} y={226} textAnchor="middle">Основание ниже впадин</text></>}
    </>; break;
    case 'external-body': drawing = <>
      <path className="measure-metal" d="M84 66 H277 V85 H336 V153 H277 V172 H84 V66 Z" />
      <path d="M84 107 H336 V131 H84 Z" className="measure-hole" />
      <path className="measure-construction" d="M38 119 H370" />
      <path className="measure-extension" d="M84 63 V27 M277 63 V27" />{dim(84, 34, 277, 34, 'b', 181, 23)}
      <path className="measure-extension" d="M277 179 V195 H336 V158" />
      <text x={309} y={216} textAnchor="middle">Ступица</text><text x={159} y={214} textAnchor="middle">Венец</text>
      <path className="measure-extension" d="M65 119 H40 V92" /><text x={16} y={79} fontSize={15}>Отверстие</text>
    </>; break;
    case 'internal-body': drawing = <>
      {ring}<circle className="measure-construction" cx={210} cy={114} r={65} />
      <path className="measure-extension" d="M275 114 H350 V74" /><text x={350} y={61} textAnchor="end">Впадины</text>
      <path className="measure-extension" d="M275 119 V218 M300 119 V218" />{dim(275, 211, 300, 211, 's', 321, 217)}
      <text x={149} y={231} textAnchor="middle">Обод снаружи впадин</text>
    </>; break;
    case 'worm': drawing = <>
      <rect x={43} y={94} width={334} height={52} className="measure-metal" />
      <rect x={107} y={67} width={204} height={106} rx={3} className="measure-metal" />
      <clipPath id={`${id}-thread`}><rect x={107} y={67} width={204} height={106} /></clipPath>
      <g clipPath={`url(#${id}-thread)`} stroke="#526f88" strokeWidth={3}>{Array.from({ length: 9 }, (_, i) => <path key={i} d={`M${78 + i * 30} 173 l33 -106`} />)}</g>
      <path className="measure-construction" d="M30 120 H390" /><path className="measure-extension" d="M107 62 V30 M311 62 V30" />
      {dim(107, 34, 311, 34, 'L', 209, 22)}<text x={210} y={218} textAnchor="middle">Только нарезанный участок</text>
    </>; break;
    case 'bevel': drawing = <>
      <path className="measure-metal" d="M93 53 L310 95 V155 L93 197 Z" />
      <path d="M93 113 H310 V137 H93 Z" className="measure-hole" /><path className="measure-construction" d="M44 125 H372" />
      {dim(93, 75, 310, 108, 'b', 209, 78)}
      <path className="measure-extension" d="M93 201 V229 M310 160 V229" />{dim(93, 221, 310, 221, 'L', 203, 210)}
      <text x={30} y={64} fontSize={15}>mₑ</text><path className="measure-extension" d="M50 61 H84" />
    </>; break;
  }
  return <figure className="measurement-figure">
    <svg viewBox="0 0 420 250" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
      <title id={`${id}-title`}>{captions[diagram]}</title><desc id={`${id}-desc`}>Условная схема, не измерение вашей детали.</desc>
      <defs><marker id={marker} markerWidth={7} markerHeight={7} refX={5} refY={3.5} orient="auto-start-reverse"><path d="M1 1 L6 3.5 L1 6" fill="none" stroke="#286e99" strokeWidth={1.2} /></marker></defs>
      {drawing}
    </svg>
    <figcaption>{captions[diagram]}<span>Условная схема, не измерение вашей детали.</span></figcaption>
  </figure>;
}
