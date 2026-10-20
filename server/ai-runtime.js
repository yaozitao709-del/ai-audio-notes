import { createAIClient } from './ai-client.js';
import { Proofreader } from './proofreading.js';

// One immutable bundle per active settings revision. In-flight jobs keep their
// bundle; replacing settings only changes the next capture, never their key.
export function createAIRuntime(settings,cacheDir) {
  let current,active=0;
  const waiting=[];
  const withProofSlot=async operation=>{
    if(active<2)active++;else await new Promise(resolve=>waiting.push(resolve));
    try{return await operation();}
    finally{if(waiting.length)waiting.shift()();else active--;}
  };
  return {
    capture(summaryModel) {
      const config=settings.snapshot();
      if(current?.metadata.revision!==config.revision){
        const request=createAIClient(config);
        const proofreadingModel=config.proofreadingModel || config.model;
        current=Object.freeze({request,
          proofreader:new Proofreader({model:proofreadingModel,configurationId:config.revision,cacheDir,request:payload=>withProofSlot(()=>request(payload))}),
          metadata:Object.freeze({revision:config.revision,provider:config.provider,baseUrl:config.baseUrl,model:config.model,proofreadingModel})
        });
      }
      return Object.freeze({...current,summaryModel:summaryModel || config.model});
    }
  };
}
