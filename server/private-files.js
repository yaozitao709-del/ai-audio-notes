import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {systemTool} from './platform.js';
const execute=promisify(execFile);
export async function protectPrivateFile(filename){
  if(process.platform!=='win32'){await fs.chmod(filename,0o600);return;}
  const script="$ErrorActionPreference='Stop'; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=[Security.AccessControl.FileSecurity]::new(); $acl.SetAccessRuleProtection($true,$false); $acl.SetOwner($sid); $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow); $acl.AddAccessRule($rule); [IO.File]::SetAccessControl($env:AI_AUDIO_PRIVATE_FILE,$acl)";
  await execute(systemTool('WindowsPowerShell/v1.0/powershell'),['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:15000,env:{...process.env,AI_AUDIO_PRIVATE_FILE:filename}});
}
