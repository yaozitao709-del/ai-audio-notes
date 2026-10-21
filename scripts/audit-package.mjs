import fs from 'node:fs/promises';import path from 'node:path';import {developerConfig} from './package-files.mjs';
async function audit(folder){
 for(const entry of await fs.readdir(folder,{withFileTypes:true})){
  const file=path.join(folder,entry.name);
  if(developerConfig(file))throw Error('Development configuration must not ship: '+file);
  if(entry.isSymbolicLink())throw Error('External link must not ship: '+file);
  if(entry.isDirectory())await audit(file);
 }
}
for(const folder of process.argv.slice(2)){await audit(folder);console.log('Clean distribution:',path.basename(folder));}
