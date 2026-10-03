// No Developer ID yet: sign the packed app ad hoc so Apple silicon will launch it.
// Replace with a Developer ID identity + notarization before public distribution.
const {execFileSync}=require('node:child_process');
const path=require('node:path');
exports.default=async context=>{
  if(context.electronPlatformName!=='darwin')return;
  const app=path.join(context.appOutDir,`${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'});
};
