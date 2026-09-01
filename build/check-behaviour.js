const fs=require('fs');const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync(require('path').join(__dirname,'..','pay-gap-calculator.html'),'utf8');
const errs=[];const vc=new VirtualConsole().on('jsdomError',e=>errs.push(e.message));
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});
const W=dom.window,d=W.document;
setTimeout(()=>{
  const o=[];
  o.push('js errors: '+(errs.length?errs.join('|'):'none'));
  // scenario toggle still works
  const before=d.querySelector('#cat-body').textContent.length;
  d.querySelector('input[name="scenario"][value="full"]').click();
  const after=d.querySelector('#cat-body').textContent.length;
  o.push('scenario toggle changes table: '+(before!==after));
  o.push('headline unchanged by toggle: '+(d.querySelector('#head-diff').textContent==='€247,986'));
  d.querySelector('input[name="scenario"][value="minimum"]').click();
  // threshold=0 boundary
  const t=d.querySelector('#ctl-threshold'); t.value='0';
  t.dispatchEvent(new W.Event('input',{bubbles:true}));
  o.push('threshold 0 -> diff: '+d.querySelector('#head-diff').textContent);
  o.push('labels at t=0: '+d.querySelectorAll('.pt-lab').length);
  t.value='5'; t.dispatchEvent(new W.Event('input',{bubbles:true}));
  o.push('restored diff: '+d.querySelector('#head-diff').textContent);
  /* The banner is hidden while the checks pass, so read the state, not the
     text: class 'pass' plus the count in data-checks. A visible banner means
     a failure, and then its text is the message. */
  var sc = d.querySelector('#selfcheck');
  o.push('selfcheck: '+(sc.classList.contains('pass')
    ? 'pass, '+sc.getAttribute('data-checks')+' checks, banner hidden: '+(sc.hidden===true)
    : 'VISIBLE -> '+sc.textContent.trim().slice(0,80)));
  // structural
  o.push('innerHTML in bundle: '+(html.match(/\.innerHTML/g)||[]).length);
  /* Fetched resources only — see the note in check-render.js: <a href> to the
     profile and the licence is navigation, not a network request. */
  o.push('external fetches: '+
    ((html.match(/\ssrc="https?:/g)||[]).length +
     (html.match(/<link\b[^>]*\shref="https?:/g)||[])
       .filter(function(t){ return !/rel="(license|author|canonical)"/.test(t); })
       .length));
  o.push('external <a href> (allowed): '+
    (html.match(/<a\b[^>]*\shref="https?:/g)||[]).length);
  o.push('body overflow-x hidden: '+/body\s*\{[^}]*overflow-x:\s*hidden/.test(html));
  o.push('regression outside Method: '+
    (d.body.textContent.split('Method')[0].match(/regression/gi)||[]).length);
  console.log(o.join('\n'));
},700);
