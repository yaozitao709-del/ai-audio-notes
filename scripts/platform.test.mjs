import test from 'node:test';
import assert from 'node:assert/strict';
import {profile,defaultDataRoot,pythonArchMatches} from '../server/platform.js';
import {choosePython} from './lite-runtime.mjs';
test('Windows runtime uses native x64 paths and LocalAppData',()=>{
 const p=profile('win32','x64','10.0.19045');
 assert.equal(p.native,'sherpa-onnx-win-x64');assert.equal(p.python,'python.exe');assert.equal(p.venvPython,'Scripts/python.exe');
 assert.equal(defaultDataRoot({platform:'win32',home:'C:\\Users\\Test',env:{LOCALAPPDATA:'D:\\User data'}}),'D:\\User data\\AI Audio Notes');
});
test('Mac paths and architecture stay supported',()=>{
 const p=profile('darwin','arm64','23.0.0');assert.equal(p.python,'bin/python3');assert.equal(p.native,'sherpa-onnx-darwin-arm64');
 assert.equal(defaultDataRoot({platform:'darwin',home:'/Users/test',env:{}}),'/Users/test/Library/Application Support/AI Audio Notes');
});
test('unsupported Windows architecture and old OS are rejected',()=>{
 assert.throws(()=>profile('win32','arm64','10.0.22631'));assert.throws(()=>profile('win32','ia32','10.0.19045'));assert.throws(()=>profile('win32','x64','6.1.7601'));assert.throws(()=>profile('win32','x64','10.0.18363'));
});
test('Python selection rejects x86 and accepts Windows AMD64',()=>{
 assert.ok(pythonArchMatches('AMD64','x64'));assert.ok(pythonArchMatches('x86_64','x64'));assert.ok(!pythonArchMatches('x86','x64'));
 const r={version:[3,11,17],arch:'AMD64',packages:{numpy:'2.4.6'},executable:'python.exe'};
 assert.equal(choosePython({numpy:'2.4.6'},[r],'x64').executable,'python.exe');assert.equal(choosePython({},[r],'arm64'),null);
});
