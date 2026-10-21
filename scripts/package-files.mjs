import path from 'node:path';
import {run} from './lite-runtime.mjs';
export async function packageSources(root){
 const files=(await run('git',['ls-files','-z'],{cwd:root})).split('\0').filter(Boolean);
 return files.filter(name=>! /^(?:node_modules|models|runtime|\.github|src|docs)(?:\/|$)|\.test\.(?:js|mjs)$|^\./.test(name)&&!name.endsWith('.command'));
}

export function developerConfig(filename){
 const base=path.basename(filename).toLowerCase();
 return base==='.env'||base.startsWith('.env.')||base==='.npmrc'||base==='.pypirc';
}
export function copyablePackagePath(filename){
 return !developerConfig(filename)&&!/(?:^|[\\/])(?:__pycache__|\.git)(?:[\\/]|$)|\.pyc$/.test(filename);
}
