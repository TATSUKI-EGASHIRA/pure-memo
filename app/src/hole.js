// The dark hole of the background field on the 1440×900 reference window. The field is a live
// shader with no fixed hole, so this stays the reference value; every centred disc and the orbit use it.
export const HOLE=Object.freeze({width:1440,height:900,x:945,y:520});
// C = window centre + (hole − reference centre) × s, s = min(W / 1440, H / 900).
export function holeCenter(width,height){
  const s=Math.min(width/HOLE.width,height/HOLE.height);
  return {s,x:width/2+(HOLE.x-HOLE.width/2)*s,y:height/2+(HOLE.y-HOLE.height/2)*s};
}
