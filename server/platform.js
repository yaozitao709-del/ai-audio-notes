import path from 'node:path';
import os from 'node:os';

export function profile(platform=process.platform,arch=process.arch,release=os.release()){
  if(platform==='darwin' && arch==='arm64' && Number(release.split('.')[0])>=23){
    return {windows:false,arch,python:'bin/python3',venvPython:'bin/python3',native:'sherpa-onnx-darwin-arm64',suffix:'',manifestSuffix:'',requirements:'requirements-speech.txt'};
  }
  const [major,,build]=release.split('.').map(Number);
  if(platform==='win32' && arch==='x64' && major>=10 && build>=19041){
    return {windows:true,arch,python:'python.exe',venvPython:'Scripts/python.exe',native:'sherpa-onnx-win-x64',suffix:'.exe',manifestSuffix:'.windows-x64',requirements:'requirements-speech-windows.txt'};
  }
  throw new Error('需要 Windows 10（2004 或更新版本）/11 x64，或苹果芯片 Mac（macOS 14 或更新版本）。');
}
export function defaultDataRoot({platform=process.platform,home=os.homedir(),env=process.env}={}){
  if(env.AI_AUDIO_DATA_ROOT)return env.AI_AUDIO_DATA_ROOT;
  return platform==='win32' ? path.win32.join(env.LOCALAPPDATA||path.win32.join(home,'AppData','Local'),'AI Audio Notes') : path.posix.join(home,'Library','Application Support','AI Audio Notes');
}
export function pythonArchMatches(value,arch=process.arch){
  return arch==='x64' ? /^(amd64|x86_64)$/i.test(value) : /^(arm64|aarch64)$/i.test(value);
}
export function systemTool(name){
  return process.platform==='win32' ? path.join(process.env.SystemRoot||'C:\\Windows','System32',name+'.exe') : '/usr/bin/'+name;
}
