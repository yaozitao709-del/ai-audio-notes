import test from 'node:test';
import assert from 'node:assert/strict';

test('a delayed initial response cannot overwrite successfully saved settings',async()=>{
  const {createSettingsReceiver}=await import('./aiSettingsState.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
  assert.equal(typeof createSettingsReceiver,'function');
  const displayed=[];const receiver=createSettingsReceiver(value=>displayed.push(value));
  let release;
  const pending=receiver.read(()=>new Promise(resolve=>{release=resolve;}));
  receiver.saved({hasApiKey:true,model:'new-model'});
  release({hasApiKey:false,model:'old-model'});await pending;
  assert.deepEqual(displayed,[{hasApiKey:true,model:'new-model'}]);
  let finish;
  const second=receiver.read(()=>new Promise(resolve=>{finish=resolve;}));
  receiver.cancel();finish({hasApiKey:false});await second;
  assert.equal(displayed.length,1,'unmounted receiver must not update state');
});
