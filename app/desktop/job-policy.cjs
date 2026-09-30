// Only known temporary transport failures are retried. Unknown failures need review.
const MAX_ATTEMPTS=3;
const RETRY_DELAYS=[15000,60000];
function retryDelay(error,attempts){
  if(error?.name==='AbortError'||attempts>=MAX_ATTEMPTS)return null;
  const message=String(error?.message||error);
  if(/401|403|429|auth|login|quota|rate.limit|invalid|permission|sandbox/i.test(message))return null;
  const temporary=['ECONNRESET','ETIMEDOUT','EAI_AGAIN','ECONNREFUSED'].includes(error?.code)
    || /timed?\s*out|timeout|connection (?:reset|closed)|network (?:error|unavailable)|\b(?:502|503|504)\b/i.test(message);
  return temporary?RETRY_DELAYS[Math.max(0,attempts-1)]??null:null;
}
function abortError(){const error=new Error('AI処理を停止しました。');error.name='AbortError';return error;}
module.exports={MAX_ATTEMPTS,retryDelay,abortError};
