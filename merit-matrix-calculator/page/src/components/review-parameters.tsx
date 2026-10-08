import { useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MAX_INCREASE, MONTH_STEPS, readNumber, REVIEW_DATES, type Params } from '@/model';
import { Detail, Field, ratingNames } from './review-shared';
export function ReviewParameters({ params, setParams }: { params: Params; setParams: (f: (p: Params) => Params) => void }) {
 const ref = useRef<HTMLDetailsElement>(null);
 useEffect(() => { const media = window.matchMedia('(min-width: 768px)'); const update=()=> {if(ref.current) ref.current.open=media.matches;}; update(); media.addEventListener('change',update); return()=>media.removeEventListener('change',update); },[]);
 const set = (k: 'budget'|'date'|'target'|'max'|'service'|'change') => (v:string) => setParams(x=>({...x,[k]:v}));
 const setRating = (i:number, k:'target'|'min', v:string) => setParams(x=>({...x,ratings:x.ratings.map((r,j)=>j===i?{...r,[k]:v}:r)}));
 return <aside className="parameters"><details open ref={ref}><summary className="parameter-toggle"><span>Review parameters<span className="toggle-summary">Enter your own values</span></span><ChevronDown /></summary><p className="panel-subtitle">enter your own values</p>
 <Field label="Target merit increase" hint="% of eligible base pay" value={params.budget} onChange={set('budget')} />
 <Field label="Review date" detail="Pay equity and merit start on this date." value={params.date} onChange={set('date')} options={REVIEW_DATES} />
 <Field label="Company target compa-ratio" hint="% of range midpoint" value={params.target} onChange={set('target')} />
 <Field label="Max. increase" detail="% of base pay before merit. No more, even if pay stays below range min." value={params.max} onChange={set('max')} options={MAX_INCREASE} suffix="%" />
 <Field label="Min. service at review date" value={params.service} onChange={set('service')} options={MONTH_STEPS} suffix=" months" />
 <Field label="Min. time since last pay change" detail="Counted at the review date." value={params.change} onChange={set('change')} options={MONTH_STEPS} suffix=" months" />
 <div className="segment-row"><span>Limit new pay to range max</span><div className="segment" role="group" aria-label="Limit new pay to range max">{[true,false].map(v=><Button variant="ghost" key={String(v)} aria-pressed={params.clip===v} onClick={()=>setParams(x=>({...x,clip:v}))}>{v?'Yes':'No'}</Button>)}</div></div>
 <div className="parameter-section"><div className="parameter-head"><h3>Target compa-ratio by rating</h3><Detail label="target compa-ratio by rating"><p>Target CR is a % of the company target, not of the range midpoint.</p><p className="mt-2">Target salary = range midpoint × company target compa-ratio × rating target CR.</p><p className="mt-2 text-muted-foreground">Example: midpoint €50,000, company target {params.target.replace(',','.')}%, Outstanding {params.ratings[0].target||'0'}% → target salary €{Math.round(50000*readNumber(params.target)/100*readNumber(params.ratings[0].target,0)/100).toLocaleString('en-IE')}.</p></Detail></div><table className="rating-input-table"><thead><tr><th>Rating</th><th>Target CR<small>of company<br/>target</small></th><th>Min. increase<small>% of base pay</small></th></tr></thead><tbody>{params.ratings.map((r,i)=><tr key={r.rating}><td>{ratingNames[r.rating]}</td><td><input aria-label={`${ratingNames[r.rating]} target compa-ratio`} type="text" inputMode="decimal" value={r.target} onChange={e=>setRating(i,'target',e.target.value)} /></td><td><input aria-label={`${ratingNames[r.rating]} minimum increase`} type="text" inputMode="decimal" value={`${r.min}%`} onChange={e=>setRating(i,'min',e.target.value.replace('%',''))} /></td></tr>)}</tbody></table><p className="field-hint">Empty target: no increase for this rating</p></div>
 </details></aside>;
}
