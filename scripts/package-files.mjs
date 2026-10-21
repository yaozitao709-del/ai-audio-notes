import {run} from './lite-runtime.mjs';
export async function packageSources(root){
 const files=(await run('git',['ls-files','-z'],{cwd:root})).split('\0').filter(Boolean);
 return files.filter(name=>! /^(?:node_modules|models|runtime|\.github|src|docs)(?:\/|$)|\.test\.(?:js|mjs)$|^\./.test(name)&&!name.endsWith('.command'));
}
