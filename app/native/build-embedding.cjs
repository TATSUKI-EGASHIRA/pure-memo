const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {rmSync}=require('node:fs');
const binary=path.join(__dirname,'embedding-helper');

if(process.platform!=='darwin'){
  rmSync(binary,{force:true});rmSync(path.join(__dirname,'context-helper'),{force:true});
  console.log('Local semantic embedding is available only on macOS; Ask will use local text search.');
  process.exit(0);
}
const compiler=spawnSync('swiftc',['--version'],{encoding:'utf8'});
if(compiler.status!==0){
  rmSync(binary,{force:true});rmSync(path.join(__dirname,'context-helper'),{force:true});
  console.log('Swift compiler is unavailable; Ask will use local text search and capture will not read selections.');
  process.exit(0);
}
const directory=__dirname;
const result=spawnSync('swiftc',['-O',path.join(directory,'embedding.swift'),'-o',binary],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status??1);
// Capture context (selection, source, pasteboard changes) for the quick-capture panel.
const context=spawnSync('swiftc',['-O',path.join(directory,'context.swift'),'-o',path.join(directory,'context-helper')],{stdio:'inherit'});
process.exit(context.status??1);
