// A prompt's version is derived from what builds it (prompt functions, schemas, validators), so any
// change to the prompt shows up as a new version in the call log and in eval results.
const {createHash}=require('node:crypto');
const versionOf=(name,...parts)=>`${name}@${createHash('sha256').update(parts.map(part=>typeof part==='function'?part.toString():JSON.stringify(part)).join('\n')).digest('hex').slice(0,10)}`;
module.exports={versionOf};
