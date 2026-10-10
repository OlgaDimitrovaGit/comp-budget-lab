import { useEffect, useState } from 'react';
import { period, useData } from '@/model';
import { Detail, eur, million, ratingNames } from './review-shared';
const ZONES = ['Below 90%','90–100%','100–110%','110% and above'];
/** Axis: four equal steps from a round number below the start up to at least the end.
 * The start stays at least half a step above the axis, so the first bar is visible. */
function axis(start:number, end:number) {
 const k0=Math.floor(Math.log10(Math.max(end,1)))-6;
 for (let k=k0;k<k0+12;k++) for (const m of [1,2,2.5,4,5]) {
  const step=m*10**k;
  let min=Math.floor((start-1e-6)/step)*step;
  if (start-min<step/2) min-=step;
  if (min>=0 && min+4*step>=end) return {min,step,ticks:[0,1,2,3,4].map(i=>min+i*step)};
 }
 const step=end/4||1;
 return {min:0,step,ticks:[0,1,2,3,4].map(i=>i*step)};
}
function useNarrow() {
 const query = '(max-width: 600px)';
 const [narrow,setNarrow]=useState(()=>window.matchMedia(query).matches);
 useEffect(()=>{const media=window.matchMedia(query);const update=()=>setNarrow(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
 return narrow;
}
export function Waterfall() {
 const data = useData();
 const p = period(data);
 const current = data.budget.payroll_before;
 const eq = data.equity.in_year;
 const merit = data.merit.in_year;
 const inYear = current+eq+merit;
 const rest = data.budget.change_total_annual-data.budget.change_total_in_year;
 const full = inYear+rest;
 const steps = [
  {name:'Current payroll',short:['Current','payroll'],amount:current,kind:'total',start:0,end:current},
  {name:`Pay equity reserve, ${p.span}`,short:['Pay equity','reserve'],amount:eq,kind:'equity',start:current,end:current+eq},
  {name:'After pay equity',short:['After pay','equity'],amount:current+eq,kind:'total',start:0,end:current+eq},
  {name:`Merit, ${p.span}`,short:['Merit'],amount:merit,kind:'merit',start:current+eq,end:inYear},
  {name:`${p.year} payroll`,short:[String(p.year),'payroll'],amount:inYear,kind:'total',start:0,end:inYear},
  {name:'Full-year effect',short:['Full-year','effect'],amount:rest,kind:'annual',start:inYear,end:full},
  {name:`${p.next} payroll`,short:[String(p.next),'payroll'],amount:full,kind:'total',start:0,end:full},
 ];
 const ax = axis(current, full)!;
 const y=(n:number)=>225-(Math.max(n,ax.min)-ax.min)/(4*ax.step)*175;
 const narrow = useNarrow();
 // phone: the same seven bars, narrower, so the chart fits the screen without scrolling
 const g = narrow ? {w:332,x0:20,step:46.5,bar:30,brk:2} : {w:800,x0:34,step:112,bar:60,brk:15};
 const value=(s:typeof steps[number])=>s.kind==='equity'&&!data.equity_on?(narrow?'n/a':'not calculated'):`${s.kind==='total'?'':'+'}${million(s.amount)}`;
 const label=(s:typeof steps[number])=>narrow&&s.kind==='equity'?['Equity','reserve']:s.short;
 return <section className="section waterfall-section"><div className="section-head"><div><h2>Payroll growth in {p.year}{" "}and{" "}{p.next}, from the review date</h2></div><Detail>Payroll includes base pay, bonus and employer contributions. The pay equity reserve and merit count from the review month: {p.span}, {p.monthsText}. Full-year effect: the same increases for the rest of a full year. {p.next} payroll: current payroll plus this review over 12 months. A {p.next} review is not included.</Detail></div>
 <div className="chart-surface">
 <div className="waterfall-scroll"><svg className={`waterfall ${narrow?'narrow':''}`} viewBox={`0 22 ${g.w} 261`} aria-label={`Waterfall showing payroll increasing from ${million(current)} to ${million(inYear)} in ${p.year} and ${million(full)} in ${p.next}`} role="img">
 <line className="chart-base" x1={g.brk-1} x2={g.w-2} y1="225" y2="225"/>
 {/* the scale starts above zero: the break mark says the base of the bars is cut */}
 <g className="axis-break"><rect x={g.brk+2} y="218" width="9" height="14"/><line x1={g.brk} x2={g.brk+7} y1="231" y2="219"/><line x1={g.brk+6} x2={g.brk+13} y1="231" y2="219"/></g>
 {steps.map((s,i)=>{const x=g.x0+i*g.step;const c=x+g.bar/2;const end=y(s.end);const bottom=y(s.start);return <g key={s.name} aria-label={`${s.name}: ${eur(s.amount)}`}>
 {i<steps.length-1&&<line className="connector" x1={x+g.bar} x2={x+g.step} y1={end} y2={end}/>}
 <rect className={`bar-${s.kind}`} x={x} y={end} width={g.bar} height={Math.max(3,bottom-end)} rx="1" />
 <text className="bar-value" textAnchor="middle" x={c} y={end-9}>{value(s)}</text>
 {label(s).map((l,j)=><text key={l} className="bar-label" textAnchor="middle" x={c} y={246+j*12}>{l}</text>)}
 </g>;})}</svg></div>
 </div>{data.equity_on&&<p className="table-notes">The pay equity reserve and merit are two separate budgets: the reserve is not paid from the merit budget. Without a gender column in your file, the page shows the merit budget alone.</p>}</section>;
}
export function MeritMatrix() {
 const data = useData();
 const [active,setActive]=useState<{rating:number;zone:number;n:number;eur:number;pct:number}|null>(null);
 return <section className="section matrix-section"><div className="section-head"><div><h2>Merit matrix: average increase of eligible employees, % of base pay</h2></div><Detail>Average merit increase as a percentage of base pay after pay equity. Each cell includes only eligible employees. — means no eligible employees in the cell; 0% means employees in the cell get no merit increase.</Detail></div>
 <div className="chart-surface">{active&&<div className="chart-popover" role="status"><strong>{ratingNames[active.rating]} · {ZONES[active.zone]}</strong><div className="detail-line"><span>Average increase</span><b>{active.pct.toFixed(1)}%</b></div><div className="detail-line"><span>Eligible employees</span><b>{active.n}</b></div><div className="detail-line"><span>Merit on base pay, annual</span><b>{eur(active.eur)}</b></div></div>}
 <div className="matrix-wrap"><table className="matrix"><thead><tr><th>Rating / CR before merit</th>{ZONES.map(z=><th key={z}>{z}</th>)}</tr></thead><tbody>{[...data.matrix.rows].reverse().map(row=><tr key={row.rating}><th>{ratingNames[row.rating]}</th>{row.cells.map((cell,i)=>{const heat=cell.pct===0?0:cell.pct<3?1:cell.pct<8?2:cell.pct<16?3:cell.pct<22?4:5;return <td key={i} className={cell.n===0?'heat-empty':heat===0?'heat-zero':`heat-${heat}`} tabIndex={cell.n?0:undefined} aria-label={`${ratingNames[row.rating]}, ${ZONES[i]}, ${cell.n} employees, ${cell.pct.toFixed(1)}%`} onMouseEnter={()=>cell.n&&setActive({rating:row.rating,zone:i,...cell})} onMouseLeave={()=>setActive(null)} onFocus={()=>setActive({rating:row.rating,zone:i,...cell})} onBlur={()=>setActive(null)} onClick={()=>cell.n&&setActive(active?.rating===row.rating&&active.zone===i?null:{rating:row.rating,zone:i,...cell})}>{cell.n>0?(heat===0?'0%':`${cell.pct.toFixed(1)}%`):'—'}</td>;})}</tr>)}</tbody></table></div>
 <div className="chart-footer matrix-footer"><div className="heat-legend section-note"><span>0%</span>{[1,2,3,4,5].map(i=><i key={i} className={`heat-${i}`}/>)}<span>25%</span></div><span className="section-note">— no eligible employees</span></div></div></section>;
}
