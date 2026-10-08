import { useData, type Data } from '@/model';
import { ALL_EMPLOYEES } from '@/engine.js';
import { Detail, eur } from './review-shared';
type Cat = Data['categories'][number];
/** Screen sign: minus = women are paid less (the engine's gap is men − women). */
function gap(n:number) { const val=Math.round(-n*10)/10; return `${val>0?'+':val<0?'−':''}${Math.abs(val).toFixed(1)}%`; }
const cr = (n:number) => `${Math.floor(n+0.5)}%`;
const oneGender = (c:Cat) => c.women===0 ? 'only men' : c.men===0 ? 'only women' : null;
// red: after merit the unexplained gap is 1 pp or more against women and wider than after pay equity
const flagged = (c:Cat) => !oneGender(c) && c.unexplained_after_merit>=1 && c.unexplained_after_merit>c.unexplained_after_equity;
function Name({c}:{c:Cat}) { return <span className="category-name" tabIndex={0}>{c.name}<span className="category-tooltip" role="tooltip"><b>{c.name}</b>{c.n} employees · {c.women} women · {c.men} men<br/>Raw gap now: {gap(c.gap_before)}<br/>Pay equity on base pay, annual: {eur(c.equity_cost_base)}<br/>Merit on base pay, annual: {eur(c.merit_cost_base)}{c.small&&<><br/><em>Fewer than 10 people: one employee can materially change the gap.</em></>}</span></span>; }
export function CategoryTables() {
 const data = useData();
 const byGap = [...data.categories].sort((a,b)=>Number(flagged(b))-Number(flagged(a)) || b.unexplained_after_merit-a.unexplained_after_merit);
 // one order for both tables, so a row reads across; without a gap check: by compa-ratio now
 const order = data.equity_on ? byGap : [...data.categories].sort((a,b)=>a.cr_before-b.cr_before);
 const single = data.categories.length===1 && data.categories[0].name===ALL_EMPLOYEES;
 return <div className="tables-grid"><section className="section"><div className="section-head"><div><h2>Gender pay gap by category</h2><p className="subtitle">Unexplained gap: women’s mean pay vs men’s,<br className="hidden sm:block"/> net of grade and tenure</p></div><Detail title="Unexplained gender pay gap">Minus: women are paid less. Mean pay includes base pay plus bonus, full-time equivalent. The explained part is kept between zero and the raw gap. Red marks a gap after merit of at least 1% against women, wider than after pay equity.</Detail></div>
 {data.equity_on ? <><table className="category-table"><thead><tr><th>Category</th><th>Now</th><th>After pay<br/>equity</th><th>After<br/>merit</th></tr></thead><tbody>{byGap.map(c=>{const one=oneGender(c);return <tr key={c.name} className={flagged(c)?'flagged':''}><th scope="row"><Name c={c}/></th>{one?<><td>{one}</td><td/><td/></>:<><td>{gap(c.unexplained_before)}</td><td>{gap(c.unexplained_after_equity)}</td><td>{gap(c.unexplained_after_merit)}</td></>}</tr>;})}</tbody></table><p className="table-notes">Where women are paid less, pay equity closes the unexplained gap to zero · <span className="negative">Red: after merit it is 1% or more against women again</span></p></>
 : <p className="table-notes">No {single?'category':'gender'} column in your file: no pay equity step and no gap check.</p>}</section>
 <section className="section"><div className="section-head"><div><h2>Change in compa-ratio by category</h2><p className="subtitle">Base pay as % of range midpoint</p></div><Detail title="Compa-ratio">Base pay divided by the range midpoint. Salary ranges are assumed to be current. Category figures describe range position, not individual pay recommendations.</Detail></div><table className="category-table"><thead><tr><th>Category</th><th>Now</th><th>After pay<br/>equity</th><th>After<br/>merit</th></tr></thead><tbody>{!single&&order.map(c=><tr key={c.name}><th scope="row"><Name c={c}/></th><td>{cr(c.cr_before)}</td><td>{cr(c.cr_after_equity)}</td><td>{cr(c.cr_after_merit)}</td></tr>)}{single&&<tr className="total"><th>All employees</th><td>{cr(data.cr_all.cr_before)}</td><td>{cr(data.cr_all.cr_after_equity)}</td><td>{cr(data.cr_all.cr_after_merit)}</td></tr>}</tbody></table></section></div>;
}
export function ReviewPeople() {
 const data = useData();
 const f = data.flags;
 const stat = (n:string|number, text:string, warn=false, zero=false) => <div className={`people-stat ${warn?'warning':''} ${zero?'is-zero':''}`}><b>{n}</b><span>{text}</span></div>;
 return <section className="section people-section"><div className="section-head"><div><h2>Employees to review further</h2></div><Detail title="Employees to review further">Demo data: employee IDs in the Excel model (Calc sheet).</Detail></div>
 <div className="people-strip">{stat(`${data.cr_all.below_low_before} → ${data.cr_all.below_low_after}`, 'below 90% of range midpoint: now → after merit')}{stat(f.red_circled, 'at or above range max: no increase (red-circled)', false, f.red_circled===0)}{stat(f.equity_over_max, 'above range max after pay equity', f.equity_over_max>0, f.equity_over_max===0)}{stat(f.below_min_after_merit, 'below range min after merit', false, f.below_min_after_merit===0)}{stat(f.not_eligible, 'not eligible: service or recent pay change', false, f.not_eligible===0)}</div></section>;
}
