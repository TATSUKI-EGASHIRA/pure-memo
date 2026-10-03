// Test AI stand-ins answer the analysis call; this answers the source check that follows it
// (desktop/verify.cjs) with "no verdicts", which keeps every claim.
const verifying=ai=>({...ai,generate:options=>String(options?.purpose||'').startsWith('verify-')?Promise.resolve({verdicts:[]}):ai.generate(options)});
module.exports={verifying};
