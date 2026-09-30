export const DRAFT_RECOVERY_KEY='pure.desktop.draft-recovery.v1';

export function parseRecoveryDraft(raw){
  try{
    const value=JSON.parse(raw);
    if(!value||typeof value.text!=='string'||!value.text||value.text.length>100000||
      !Number.isSafeInteger(value.updatedAt)||value.updatedAt<=0||
      !['human','generated'].includes(value.originKind)||
      !['unspecified','thought','reference','quote'].includes(value.sourceKind)||
      typeof value.editingId!=='string')return null;
    if(value.aiExcluded!==undefined&&typeof value.aiExcluded!=='boolean')return null;
    return {...value,aiExcluded:value.aiExcluded===true};
  }catch{return null;}
}

export function selectDraft(database,recoveryRaw){
  const saved={text:database.draft||'',originKind:database.draftOriginKind||'human',
    sourceKind:database.draftSourceKind||'unspecified',editingId:database.draftEditingId||'',
    updatedAt:Number(database.draftUpdatedAt)||0,aiExcluded:database.draftAiExcluded===true};
  const recovery=parseRecoveryDraft(recoveryRaw);
  return recovery&&recovery.updatedAt>saved.updatedAt?{...recovery,recovered:true}:{...saved,recovered:false};
}
