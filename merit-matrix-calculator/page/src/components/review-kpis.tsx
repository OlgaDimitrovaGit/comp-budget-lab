import { period, useData } from '@/model';
import { million, signed } from './review-shared';
function MicroBar({ratio,negative=false}:{ratio:number;negative?:boolean}) { ratio=Math.max(0,Math.min(1,ratio)); return <svg viewBox="0 0 180 24" preserveAspectRatio="none" className="kpi-trend" aria-hidden="true"><rect x="0" y="7" width="180" height="10" rx="1" className={negative?'spark-red-area':'spark-area'}/><line x1="0" x2={180*ratio} y1="17" y2="17" className={negative?'spark-red':'spark-stroke'}/><line x1={180*ratio} x2={180*ratio} y1="3" y2="21" className={negative?'spark-red':'spark-grey'}/></svg>; }
export function ReviewKpis() {
 const data = useData();
 const p = period(data);
 const over = data.pool.variance_pp > 0;
 const none = data.eligible === 0;
 const share = (n:number) => `${signed(n.toFixed(1)+'%', n)} of current annual payroll`;
 return <div className="kpi-groups"><section className="kpi-group"><h2>{data.equity_on?'Payroll budget impact: pay equity and merit':'Cost of merit'}</h2><div className="kpi-pair"><div className="kpi"><div className="kpi-label">{p.year} · from review date</div><div className="kpi-value">{million(data.budget.change_total_in_year)}</div><p className="kpi-foot">{share(data.budget.change_in_year_pct)}</p></div><div className="kpi"><div className="kpi-label">12 months {p.next}</div><div className="kpi-value">{million(data.budget.change_total_annual)}</div><p className="kpi-foot" aria-hidden="true">&nbsp;</p></div></div></section>
 <section className="kpi-group"><h2>Merit {p.year}: actual vs target</h2>{none?<p className="kpi-foot">No eligible employees</p>:<div className="kpi-pair"><div className="kpi"><div className="kpi-label">Actual merit increase</div><div className="kpi-value">{data.pool.merit_pct.toFixed(2)}%</div><p className={`kpi-foot ${over?'negative':''}`}>{signed(data.pool.variance_pp.toFixed(2), data.pool.variance_pp).replace('-','−')} pp vs target</p></div><div className="kpi"><div className="kpi-label">Actual merit cost</div><div className="kpi-value">{million(data.merit.in_year)}</div><p className={`kpi-foot ${over?'negative':''}`}>{signed(million(data.pool.variance_eur_in_year), data.pool.variance_eur_in_year)} vs target</p></div></div>}</section></div>;
}
