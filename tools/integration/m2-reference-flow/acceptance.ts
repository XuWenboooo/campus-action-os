import { runM2IndependentAcceptance } from '../../../tests/e2e/m2-independent-acceptance.js';

const report = runM2IndependentAcceptance();
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'PASS') process.exitCode = 1;
