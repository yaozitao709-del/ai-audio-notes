import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowDownToLine, ArrowLeft, Check, ChevronDown, Eye, EyeOff, KeyRound, Loader2, PlugZap} from 'lucide-react';
import {fetchAIModels, fetchAISettings, saveAISettings, testAISettings} from './api.js';
import './ai-settings.css';

const defaults={provider:'deepseek',baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:''};

export default function AISettingsPage({onBack,onSaved}) {
  const [saved,setSaved]=useState(null);
  const [draft,setDraft]=useState(defaults);
  const [loading,setLoading]=useState(true);
  const [loadError,setLoadError]=useState('');
  const [busy,setBusy]=useState('');
  const [feedback,setFeedback]=useState(null);
  const [savedMessage,setSavedMessage]=useState('');
  const [advanced,setAdvanced]=useState(false);
  const [showKey,setShowKey]=useState(false);
  const [models,setModels]=useState([]);
  const alive=useRef(true);
  const sequence=useRef(0);

  const load=useCallback(async()=>{
    const token=++sequence.current;setLoading(true);setLoadError('');
    try {
      const settings=await fetchAISettings();
      if(!alive.current || token!==sequence.current)return;
      setSaved(settings);setDraft({...settings,apiKey:''});
      setAdvanced(settings.provider!=='deepseek');
    } catch(error) {if(alive.current&&token===sequence.current)setLoadError(error.message || '设置读取失败，请重试。');}
    finally {if(alive.current&&token===sequence.current)setLoading(false);}
  },[]);

  useEffect(()=>{alive.current=true;load();return()=>{alive.current=false;sequence.current++;};},[load]);

  const change=(field,value)=>{
    setFeedback(null);setSavedMessage('');
    if(field!=='model')setModels([]);
    if(field==='provider'){
      setDraft({...defaults,provider:value,baseUrl:value==='deepseek'?defaults.baseUrl:'',model:value==='deepseek'?defaults.model:''});
      setAdvanced(value!=='deepseek');setShowKey(false);
    }else setDraft(current=>({...current,[field]:value}));
  };

  const destinationChanged=saved && (draft.provider!==saved.provider || draft.baseUrl.replace(/\/+$/,'')!==saved.baseUrl.replace(/\/+$/,''));
  const validate=(requireModel=true)=>{
    if(!draft.baseUrl.trim())return '请先填写 API 地址。';
    if(requireModel && !draft.model.trim())return '请填写模型名称，或点击右侧按钮获取模型。';
    if(!draft.apiKey.trim() && (!saved?.hasApiKey || destinationChanged))return '请输入当前服务对应的 API 密钥。';
    return '';
  };

  const run=async action=>{
    const error=validate(action!=='models');
    setSavedMessage('');
    if(error){setFeedback({type:'error',text:error});return;}
    setBusy(action);setFeedback(null);
    if(action==='models')setModels([]);
    try {
      if(action==='models'){
        const result=await fetchAIModels(draft);
        if(alive.current){setModels(result.models);setFeedback({type:'success',text:`已获取 ${result.models.length} 个模型，可从列表选择。`});}
      }else if(action==='test'){
        const result=await testAISettings(draft);
        if(alive.current)setFeedback({type:'success',text:`连接可用 · ${Number(result.elapsedSeconds).toFixed(1)} 秒，JSON 输出正常。`});
      }else{
        const settings=await saveAISettings(draft);
        if(!alive.current)return;
        setSaved(settings);setDraft({...settings,apiKey:''});setShowKey(false);
        setSavedMessage('已保存，后续任务立即使用新设置。');onSaved(settings);
      }
    }catch(error){if(alive.current)setFeedback({type:'error',text:error.message || '操作失败，请重试。'});}
    finally{if(alive.current)setBusy('');}
  };

  return <main className="ai-settings-page">
    <button className="ai-settings-back" type="button" onClick={onBack} disabled={Boolean(busy)}><ArrowLeft size={17}/>返回首页</button>
    <header className="ai-settings-heading">
      <div className="ai-settings-title"><img src="/assets/ai-settings-128.png" alt="" width="28" height="28"/><h1>AI 设置</h1></div>
      <p>连接你自己的 AI，自动完成全文校对、轻度整理与总结。</p>
    </header>
    {loading ? <div className="ai-settings-loading" role="status"><Loader2 className="spin-icon" size={18}/>正在读取设置</div> : loadError ? <div className="ai-settings-load-error" role="alert"><p>{loadError}</p><button type="button" onClick={load}>重新加载</button></div> : <>
      <div className="ai-settings-current">
        <span className={`ai-config-badge ${saved.hasApiKey?'configured':''}`}><span/>{saved.hasApiKey?'已配置':'未配置'}</span>
        <span>{saved.hasApiKey?<>当前模型 <strong>{saved.model}</strong></>:'填写密钥后，即可使用 AI 校对和总结'}</span>
      </div>
      <form className="ai-settings-card" onSubmit={event=>{event.preventDefault();run('save');}} noValidate>
        <div className="ai-settings-card-heading"><h2>连接配置</h2><p>默认使用 Flash，兼顾处理速度与信息保真。</p></div>
        <fieldset disabled={Boolean(busy)}>
          <label className="ai-settings-field" htmlFor="ai-provider"><span>AI 服务</span>
            <select id="ai-provider" value={draft.provider} onChange={e=>change('provider',e.target.value)}>
              <option value="deepseek">DeepSeek（推荐）</option><option value="openai-compatible">自定义兼容服务</option>
            </select>
          </label>
          <div className="ai-settings-field">
            <label htmlFor="ai-api-key">API Key <span className="ai-field-optional">{saved.hasApiKey&&!destinationChanged?'已保存密钥，留空沿用':''}</span></label>
            <div className="ai-key-input"><KeyRound size={17} aria-hidden="true"/>
              <input id="ai-api-key" name="api-key" type={showKey?'text':'password'} autoComplete="new-password" spellCheck={false} value={draft.apiKey} onChange={e=>change('apiKey',e.target.value)} placeholder={saved.hasApiKey&&!destinationChanged?'输入新密钥可替换，留空使用已保存的密钥':'请输入当前服务的 API 密钥'} aria-describedby="ai-key-hint"/>
              <button type="button" onClick={()=>setShowKey(v=>!v)} aria-label={showKey?'隐藏密钥':'显示密钥'} disabled={!draft.apiKey}>{showKey?<EyeOff size={17}/>:<Eye size={17}/>}</button>
            </div>
            <p id="ai-key-hint" className="ai-field-help">{destinationChanged?'更换服务或地址后，请重新填写对应的密钥。':'密钥保存在这台电脑的本地服务中，页面不会回显已保存的密钥。'}</p>
          </div>
          <details className="ai-advanced" open={advanced} onToggle={e=>setAdvanced(e.currentTarget.open)}>
            <summary><span>高级设置 <small>API 地址与模型</small></span><ChevronDown size={16}/></summary>
            <div className="ai-advanced-fields">
              <label className="ai-settings-field" htmlFor="ai-base-url"><span>API 地址</span><input id="ai-base-url" type="url" spellCheck={false} value={draft.baseUrl} onChange={e=>change('baseUrl',e.target.value)} placeholder="https://api.example.com/v1"/><small>填写服务的基础地址，通常不需要带 /chat/completions。</small></label>
              <div className="ai-settings-field">
                <label htmlFor="ai-model">模型名称</label>
                <div className="ai-model-input-row"><input id="ai-model" spellCheck={false} value={draft.model} maxLength={128} onChange={e=>change('model',e.target.value)} placeholder="输入或获取模型名称"/>
                  <button className="ai-fetch-models" type="button" onClick={()=>run('models')} title="使用当前地址和密钥获取可用模型">{busy==='models'?<Loader2 size={16} className="spin-icon"/>:<ArrowDownToLine size={16}/>} {busy==='models'?'获取中…':'获取模型'}</button>
                </div>
                {models.length?<select aria-label="可用模型" value={models.some(m=>m.id===draft.model)?draft.model:''} onChange={e=>{if(e.target.value)change('model',e.target.value);}}><option value="">选择已获取的模型</option>{models.map(m=><option key={m.id} value={m.id}>{m.name===m.id?m.id:`${m.name} · ${m.id}`}</option>)}</select>:null}
                <small>校对整理和总结统一使用此模型。也可手动填写名称。</small>
              </div>
              {draft.provider==='openai-compatible'?<p className="ai-field-help">自定义服务需兼容 Chat Completions，并支持 JSON 输出。可先测试连接。</p>:null}
            </div>
          </details>
        </fieldset>
        <div className="ai-settings-feedback" aria-live="polite">
          {feedback?<p className={`ai-feedback ${feedback.type}`} role={feedback.type==='error'?'alert':'status'}>{feedback.type==='success'?<Check size={16}/>:null}{feedback.text}</p>:null}
          {savedMessage?<p className="ai-feedback success" role="status"><Check size={16}/>{savedMessage}</p>:null}
        </div>
        <div className="ai-settings-footer"><button className="ai-test-button" type="button" onClick={()=>run('test')} disabled={Boolean(busy)}>{busy==='test'?<Loader2 size={17} className="spin-icon"/>:<PlugZap size={17}/>} {busy==='test'?'测试中…':'测试连接'}</button>
          <button className="ai-save-button" type="submit" disabled={Boolean(busy)}>{busy==='save'?<Loader2 size={17} className="spin-icon"/>:null}{busy==='save'?'保存中…':'保存设置'}</button>
        </div>
      </form>
      <p className="ai-settings-footnote">保存后无需重启。正在处理的录音会继续使用原设置。</p>
    </>}
  </main>;
}
