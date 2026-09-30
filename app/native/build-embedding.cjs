const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {rmSync}=require('node:fs');
const binary=path.join(__dirname,'embedding-helper');

if(process.platform!=='darwin'){
  rmSync(binary,{force:true});
  console.log('Local semantic embedding is available only on macOS; Ask will use local text search.');
  process.exit(0);
}
const compiler=spawnSync('swiftc',['--version'],{encoding:'utf8'});
if(compiler.status!==0){
  rmSync(binary,{force:true});
  console.log('Swift compiler is unavailable; Ask will use local text search.');
  process.exit(0);
}
const directory=__dirname;
const result=spawnSync('swiftc',['-O',path.join(directory,'embedding.swift'),'-o',binary],{stdio:'inherit'});
process.exit(result.status??1);
