// Repeatable local-only release gate. No cloud credentials or real guest data.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cwd=fileURLToPath(new URL('../',import.meta.url));
const commands=[
  ['JavaScript regression suite','npm',['test']],
  ['Syntax checks','npm',['run','check']],
  ['Python regression suite','python3',['-m','unittest','discover','-s','test','-p','test_*.py']],
  ['Local workerd, restart and backup restore','npm',['run','test:runtime']],
  ['Pages Functions build','npm',['run','build']],
  ['Cron dry-run build',process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--env','','--config','cron/wrangler.toml']],
  ['Case-store dry-run build',process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--env','','--config','case-store/wrangler.toml']],
];
for(const [label,command,args] of commands) {
  console.log('\nVERIFY: '+label);
  const result=spawnSync(command,args,{cwd,stdio:'inherit',timeout:180000,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  if(result.error||result.signal||result.status!==0) {
    console.error('STOP: '+label+' did not pass. Nothing was deployed.');
    process.exit(1);
  }
}
console.log('\nPASS: all local verification gates. This is not live acceptance or deployment.');
