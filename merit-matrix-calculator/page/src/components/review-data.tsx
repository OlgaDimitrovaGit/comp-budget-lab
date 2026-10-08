import { useRef, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, RotateCcw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseCsv, EMPLOYEE_COLUMNS, BAND_COLUMNS } from '@/engine.js';
import { compute, period, toSettings, useData, type Params, type Source } from '@/model';
import { Field } from './review-shared';
const csvHref = (text: string) => `data:text/csv;charset=utf-8,${encodeURIComponent(text)}`;
function method(y: number) {
 return [
  { title: 'Pay equity', items: [
   'In each category where women are paid less, we close the part of the gap that grade and tenure do not explain. The money goes to women below the category median, in proportion to how far below it they are. It is paid on top of the target merit increase.',
   'The gap compares mean pay of women and men: base pay plus bonus, full-time equivalent. The unexplained gap is what is left after differences in grade and tenure, estimated within the category. The explained part is kept between zero and the raw gap, so where grade and tenure explain all of it, the table shows 0.0%. Minus: women are paid less. In a category of fewer than 10 people, one person can shift the % a lot.',
   'After pay equity the unexplained gap is zero wherever women were paid less: the step pays out the gap measured now. If you measure it again on the new pay, a small remainder can show. After merit we measure it again. Where women are paid more, the pay equity step pays nothing.',
   'The part explained by grade and tenure stays. By itself it is not a justification under Art. 10(1)(b): the employer still has to show that grades and pay for tenure rest on objective, gender-neutral criteria.',
  ] },
  { title: 'Merit', items: [
   'Target salary = range midpoint × company target compa-ratio × target CR of the rating. Example: midpoint €50,000, company target 95%, Outstanding 110%: target salary €52,250.',
   'An eligible employee paid below their target salary is raised to it. Pay above the target salary is not cut.',
   'Three limits then apply, in this order: at least the minimum increase of the rating; no more than the max. increase; no pay above the range max, if that limit is on. An employee at or above range max gets no increase.',
   'The model does not scale increases to hit the target merit increase %. The cards show the difference. To move closer to the target, change the target compa-ratios by rating.',
   'Target cost in €: the target merit increase % of each eligible employee’s base pay after pay equity, plus the bonus and employer contributions on that increase.',
  ] },
  { title: 'Timing', items: [
   `Pay equity and merit both start on the review date. ${y} counts only the months from that date.`,
   `12 months ${y + 1}: this review over a full year. A ${y + 1} review is not included.`,
  ] },
  { title: 'Assumptions', items: [
   'All € amounts include bonus and employer contributions.',
   `Employer contributions: Spain 2026 (Orden PJC/297/2026; LGSS additional provision 61), permanent contract and office-work AT/EP rate, applied unchanged to ${y} and ${y + 1}. Spain is raising the MEI rate until 2029 and the ceiling every year; later changes are not modelled.`,
   'Salary ranges are assumed to be current. Collective agreements are not modelled.',
  ] },
 ];
}
export function ReviewData({open,onToggle,source,demo,setSource,params,setParams}:{open:boolean;onToggle:()=>void;source:Source;demo:Source;setSource:(s:Source)=>void;params:Params;setParams:(f:(p:Params)=>Params)=>void}) {
 const data=useData();
 const p=period(data);
 const input=useRef<HTMLInputElement>(null);
 const [notice,setNotice]=useState('');const [error,setError]=useState(false);
 const change=(key:keyof Params['contrib'])=>(v:string)=>setParams(x=>({...x,contrib:{...x.contrib,[key]:v}}));
 async function load(files:FileList|null){
  if(!files||!files.length)return;setError(false);
  try{
   const next={...source};const names:string[]=[];let ownEmployees=false;
   for(const file of Array.from(files)){
    if(file.size>10*1024*1024)throw new Error(`${file.name}: choose a CSV smaller than 10 MB.`);
    const text=await file.text();const head=(parseCsv(text)[0]??[]).map(h=>h.trim().toLowerCase());
    if(head.includes('mid')&&head.includes('max'))next.bands=text;
    else if(head.includes('base_salary')){next.employees=text;ownEmployees=true;}
    else throw new Error(`${file.name}: not an employee file (base_salary column) or a salary ranges file (mid and max columns). Use the sample CSVs for the expected format.`);
    names.push(file.name);
   }
   if(ownEmployees&&next.bands===demo.bands)throw new Error('Load your salary ranges file together with the employee file: select both files at once.');
   next.name=names.join(' + ');
   const settings=toSettings(params);
   const result=settings?compute(next,settings):null;
   setSource(next);
   setNotice(result?`${next.name} · ${result.headcount} employees loaded.`:`${next.name} loaded.`);
  }catch(e){setError(true);setNotice(e instanceof Error?e.message:'Unable to read this file.');}
 }
 return <section className="data-section" id="data-section"><Button variant="ghost" className="data-toggle" aria-expanded={open} aria-controls="data-content" onClick={onToggle}><span className="flex min-w-0 items-center gap-3"><FileSpreadsheet className="shrink-0 text-muted-foreground"/><span className="data-title">Your data, Excel model, contributions and method</span></span><ChevronDown className={`shrink-0 transition-transform ${open?'rotate-180':''}`}/></Button>
 {open&&<div className="data-body" id="data-content"><div className="data-columns"><div><h3>Use your own data</h3><ol className="data-steps">
 <li>Download the two sample files: employees and salary ranges.<div className="data-tools"><Button variant="outline" size="sm" asChild><a href={csvHref(demo.employees)} download="merit-sample-employees.csv"><Download/>Sample employees CSV</a></Button><Button variant="outline" size="sm" asChild><a href={csvHref(demo.bands)} download="merit-sample-salary-ranges.csv"><Download/>Sample salary ranges CSV</a></Button></div></li>
 <li>Replace the rows with your data. Keep the column names.<p>Employees: {EMPLOYEE_COLUMNS.join(', ')}. Gender is F or M. Without a gender or a category column the page skips the pay equity step and the gap check.</p><p>Salary ranges: {BAND_COLUMNS.join(', ')}.</p></li>
 <li>Click Load CSV and select both files at once.<div className="data-tools"><Button size="sm" onClick={()=>input.current?.click()}><Upload/>Load CSV</Button></div></li>
 <li>The page recalculates on your data. The file names appear at the top of the page. Change the review parameters as you need.</li>
</ol><input className="hidden" ref={input} type="file" multiple accept=".csv,text/csv" aria-label="Load employee CSV" onChange={e=>{void load(e.target.files);e.target.value='';}}/><p>Your files stay in your browser. The page does not upload them.</p>{notice&&<div role="status" className={`import-result ${error?'error':''}`}>{notice}</div>}<div className="data-tools"><Button variant="outline" size="sm" onClick={()=>{setSource(demo);setError(false);setNotice(`Demo data restored · ${parseCsv(demo.employees).length-1} simulated employees.`);}}><RotateCcw/>Back to demo data</Button></div>
 <h3 className="mt-6">Check the calculation in Excel</h3><p>The Excel model is the same calculator in formulas, one row per employee, so you can trace every number. It holds the demo data and the default parameters. Your files and the values you type here do not go into it.</p><Button variant="outline" size="sm" asChild><a href="merit-model.xlsx" download><Download/>Download Excel model</a></Button></div>
 <div><h3>Employer contributions</h3><p>The demo uses Spain 2026. Enter your country’s rates below.</p><div className="contribution-grid"><Field label="Employer rate up to the ceiling, %" value={params.contrib.rate} onChange={change('rate')}/><Field label="Annual contribution ceiling, €" value={params.contrib.ceiling} onChange={change('ceiling')}/><Field label="Rate on pay up to 10% above the ceiling, %" value={params.contrib.band1} onChange={change('band1')}/><Field label="Rate on pay 10% to 50% above the ceiling, %" value={params.contrib.band2} onChange={change('band2')}/><Field label="Rate on pay more than 50% above the ceiling, %" value={params.contrib.band3} onChange={change('band3')}/></div><p>If your country has no contributions above the ceiling, enter 0 in all three rates above it. If it has no ceiling at all, enter a ceiling above your highest annual pay including bonus after the increases, for example 10000000.</p><p className="section-note">Spain 2026, permanent contract, office work: 32.15% up to €61,214.40 a year (€5,101.20 a month × 12). Above it, the employer share of the solidarity contribution: 0.96%, 1.04% and 1.22% in the three bands. Sources: Orden PJC/297/2026 (BOE 31.03.2026), arts. 2.1, 4, 16, 17; LGSS, additional provision 61 (AT/EP tariff, office work 1.50%). Applied unchanged to {p.year} and {p.next}.</p></div></div>
 <div className="method">{method(p.year).map(s=><div key={s.title}><h3>{s.title}</h3><ul>{s.items.map(t=><li key={t}>{t}</li>)}</ul></div>)}</div></div>}</section>;
}
