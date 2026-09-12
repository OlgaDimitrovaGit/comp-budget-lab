/* Exports the demo data to CSV for the Excel model.
 * A PRNG cannot be reproduced by Excel formulas, so the array is fixed here. */
const CALC = require('../calc.js');
const fs = require('fs');

const emp = CALC.generateDemoData();
const cols = ['id','category','gender','base_salary','variable_pay',
              'tenure_years','grade','fte','months_worked'];
const lines = [cols.join(',')];
for (const e of emp) {
  lines.push(cols.map(c => {
    const v = e[c];
    return (typeof v === 'string' && v.includes(',')) ? '"' + v + '"' : v;
  }).join(','));
}
fs.writeFileSync(process.argv[2], lines.join('\n') + '\n');
console.log('rows: ' + emp.length);
