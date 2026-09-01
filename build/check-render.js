const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(require('path').join(__dirname,'..','pay-gap-calculator.html'),'utf8');
const errs=[];
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,
  virtualConsole:new (require('jsdom').VirtualConsole)().on('jsdomError',e=>errs.push(e.message))});
const d=dom.window.document;
setTimeout(()=>{
  const out=[];
  out.push('js errors: '+(errs.length?errs.join(' | '):'none'));
  const svg=d.querySelector('#chart svg');
  out.push('svg present: '+!!svg+', elements: '+(svg?svg.querySelectorAll('*').length:0));
  out.push('hit targets: '+d.querySelectorAll('.cat-hit').length+' (expect 7)');
  out.push('hover bands: '+d.querySelectorAll('.cat-band').length);
  out.push('direct labels: '+d.querySelectorAll('.pt-lab').length+' -> '+
    [...d.querySelectorAll('.pt-lab')].map(t=>t.textContent).join(', '));
  out.push('threshold line: '+d.querySelectorAll('.threshline').length);
  out.push('focusable hits: '+d.querySelectorAll('.cat-hit[tabindex="0"]').length);
  // headline
  out.push('headline: min='+d.querySelector('#head-min').textContent+
    ' full='+d.querySelector('#head-full').textContent+
    ' diff='+d.querySelector('#head-diff').textContent);
  /* The banner is hidden while the checks pass, so read the state, not the
     text: class 'pass' plus the count in data-checks. A visible banner means
     a failure, and then its text is the message. */
  var sc = d.querySelector('#selfcheck');
  out.push('selfcheck: '+(sc.classList.contains('pass')
    ? 'pass, '+sc.getAttribute('data-checks')+' checks, banner hidden: '+(sc.hidden===true)
    : 'VISIBLE -> '+sc.textContent.trim().slice(0,80)));
  // stale tokens / external refs
  out.push('stale var(--rev): '+(html.match(/var\(--rev\)/g)||[]).length);
  out.push('serif on hero: '+/\.fig \.value \{[^}]*serif/.test(html));
  /* Only fetched resources count: src= on any element, and <link> hrefs that
     the browser loads (stylesheets, icons, preloads). A plain <a href> to the
     author's profile or the licence is navigation on click, not a request —
     counting those would have made this check fire on the footer byline while
     staying silent about a real remote asset. */
  out.push('external fetches (src|link href): '+
    ((html.match(/\ssrc="https?:/g)||[]).length +
     (html.match(/<link\b[^>]*\shref="https?:/g)||[])
       .filter(function(t){ return !/rel="(license|author|canonical)"/.test(t); })
       .length));
  out.push('external <a href> (navigation, allowed): '+
    (html.match(/<a\b[^>]*\shref="https?:/g)||[]).length);
  console.log(out.join('\n'));
},600);
