import { useEffect, useMemo, useRef, useState } from 'react';
import { Monitor, Moon, Sun, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReviewParameters } from '@/components/review-parameters';
import { ReviewKpis } from '@/components/review-kpis';
import { Waterfall, MeritMatrix } from '@/components/review-charts';
import { CategoryTables, ReviewPeople } from '@/components/review-tables';
import { ReviewData } from '@/components/review-data';
import { compute, DataContext, DEFAULT_PARAMS, demoBands, demoEmployees, period, toSettings, type Data, type Params, type Source } from './model';

const DEMO: Source = { employees: demoEmployees, bands: demoBands, name: null };

export function App(){
 const [theme,setTheme]=useState<'system'|'light'|'dark'>('system');
 const [dataOpen,setDataOpen]=useState(false);
 const [params,setParams]=useState<Params>(DEFAULT_PARAMS);
 const [source,setSource]=useState<Source>(DEMO);
 const last=useRef<Data|null>(null);
 const data=useMemo(()=>{const s=toSettings(params);if(s){try{last.current=compute(source,s);}catch{/* keep the last result */}}return last.current!;},[params,source]);
 useEffect(()=>{const media=window.matchMedia('(prefers-color-scheme: dark)');const update=()=>document.documentElement.classList.toggle('dark',theme==='dark'||(theme==='system'&&media.matches));update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[theme]);
 const openData=()=>{setDataOpen(true);window.setTimeout(()=>document.getElementById('data-section')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'}),50);};
 const p=period(data);
 return <DataContext.Provider value={data}><main className="app"><div className="masthead"><div className="wordmark"><span className="mark" aria-hidden="true"><i/><i/><i/></span>Comp Budget Lab</div><div className="theme-tools"><Button variant="ghost" size="sm" aria-label={`Theme: ${theme==='system'?'auto':theme}. Switch to ${theme==='system'?'light':theme==='light'?'dark':'auto'}`} onClick={()=>setTheme(theme==='system'?'light':theme==='light'?'dark':'system')}>{theme==='system'?<Monitor/>:theme==='light'?<Sun/>:<Moon/>}Theme: {theme==='system'?'auto':theme}</Button></div></div>
 <header className="page-header"><h1>Salary review:{' '}<span className="title-second">budget and outcome</span></h1><div className="header-bottom"><p className="lede">How much will pay equity and the salary review add to payroll? Will merit stay within target? How will they change the unexplained gender pay gap the EU Pay Transparency Directive requires you to justify, and where pay sits in the range?</p><div className="source-action"><span className="source-label"><i className="source-dot"/>{source.name?`${source.name} · ${data.headcount} employees`:`Simulated data · ${data.headcount} employees`}</span><Button variant="outline" size="sm" onClick={openData}><Upload/>Load your data</Button></div></div></header>
 <div className="workspace"><ReviewParameters params={params} setParams={setParams}/><div className="right-content"><ReviewKpis/><Waterfall/><MeritMatrix/><CategoryTables/><ReviewPeople/><ReviewData open={dataOpen} onToggle={()=>setDataOpen(v=>!v)} source={source} demo={DEMO} setSource={setSource} params={params} setParams={setParams}/></div></div>
 <footer className="footer"><span>Olga Dimitrova · <a href="https://www.linkedin.com/in/olga-dimitrova-04311742a/" target="_blank" rel="author noopener noreferrer">LinkedIn</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="license noopener noreferrer">CC BY 4.0</a> · Demo data is simulated</span></footer></main></DataContext.Provider>;
}
