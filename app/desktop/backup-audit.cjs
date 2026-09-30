const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');

const MANAGED_NAME=/^before-(?:import|restore)-\d+\.sqlite$/;
function managedPath(directory,name){
  if(typeof name!=='string'||!MANAGED_NAME.test(name))throw new Error('Not a managed pure backup.');
  return path.join(directory,name);
}
function listManagedBackups(directory,purgedIds=[]){
  if(!fs.existsSync(directory))return [];
  return fs.readdirSync(directory,{withFileTypes:true})
    .filter(entry=>entry.isFile()&&MANAGED_NAME.test(entry.name))
    .map(entry=>{
      const file=managedPath(directory,entry.name),stat=fs.statSync(file);
      let status='clean',deletedCount=0,db;
      try{
        db=new DatabaseSync(file,{readOnly:true});
        if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='notes'").get())throw new Error('Missing notes table');
        const contains=db.prepare('SELECT 1 FROM notes WHERE id=? LIMIT 1');
        for(const id of purgedIds)if(contains.get(id))deletedCount++;
        if(deletedCount)status='contains-deleted';
      }catch{status='unreadable';deletedCount=0;}
      finally{db?.close();}
      return {name:entry.name,size:stat.size,modifiedAt:stat.mtime.toISOString(),status,deletedCount};
    }).sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt));
}
function deleteManagedBackup(directory,name){
  const file=managedPath(directory,name);
  const files=[file,file+'-wal',file+'-shm'];
  for(const candidate of files){
    const stat=fs.lstatSync(candidate,{throwIfNoEntry:false});
    if(!stat)continue;
    if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Not a regular managed backup.');
  }
  if(!fs.lstatSync(file,{throwIfNoEntry:false}))throw new Error('Managed backup not found.');
  for(const candidate of files.slice(1))if(fs.lstatSync(candidate,{throwIfNoEntry:false}))fs.unlinkSync(candidate);
  fs.unlinkSync(file);
  return true;
}
module.exports={listManagedBackups,deleteManagedBackup};
