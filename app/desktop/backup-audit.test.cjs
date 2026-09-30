const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('./store.cjs');
const {listManagedBackups,deleteManagedBackup}=require('./backup-audit.cjs');

test('managed backups reveal copies of permanently deleted notes and delete only chosen files',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pure-backup-audit-'));
  const backupDir=path.join(dir,'backups');fs.mkdirSync(backupDir);
  const store=new Store(path.join(dir,'pure.sqlite'));
  try{
    const note=store.saveNote({text:'後で完全削除する記録'});
    const old=path.join(backupDir,'before-import-100.sqlite');
    await store.backupTo(old);
    store.trashNote(note.id);store.purgeNote(note.id);
    const clean=path.join(backupDir,'before-restore-200.sqlite');
    await store.backupTo(clean);
    fs.writeFileSync(path.join(backupDir,'before-import-300.sqlite'),'invalid database');
    fs.symlinkSync(old,path.join(backupDir,'before-import-400.sqlite'));
    const files=listManagedBackups(backupDir,store.purgedNoteIds());
    assert.equal(files.find(item=>item.name==='before-import-100.sqlite').status,'contains-deleted');
    assert.equal(files.find(item=>item.name==='before-import-100.sqlite').deletedCount,1);
    assert.equal(files.find(item=>item.name==='before-restore-200.sqlite').status,'clean');
    assert.equal(files.find(item=>item.name==='before-import-300.sqlite').status,'unreadable');
    assert.equal(files.some(item=>item.name==='before-import-400.sqlite'),false);
    assert.throws(()=>deleteManagedBackup(backupDir,'../pure.sqlite'));
    assert.throws(()=>deleteManagedBackup(backupDir,'before-import-400.sqlite'));
    fs.writeFileSync(old+'-wal','old backup data');
    fs.writeFileSync(old+'-shm','old backup index');
    assert.equal(deleteManagedBackup(backupDir,'before-import-100.sqlite'),true);
    assert.equal(fs.existsSync(old),false);
    assert.equal(fs.existsSync(old+'-wal'),false);
    assert.equal(fs.existsSync(old+'-shm'),false);
    assert.equal(fs.existsSync(clean),true);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
