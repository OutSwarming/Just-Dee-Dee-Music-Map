import {access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {config} from './notificationClient.mjs';
// Keep the explicitly selected Messages runtime across reinstalls. macOS grants
// Automation access to the executable identity, not to a JavaScript filename.
export async function notificationRuntime({loadConfig=config,current=process.execPath,check=path=>access(path,constants.X_OK)}={}){
 let settings;try{settings=await loadConfig();}catch(e){if(e.code!=='ENOENT')throw e;settings={};}
 const runtime=settings.messagesNodePath||current;
 await check(runtime);return runtime;
}
