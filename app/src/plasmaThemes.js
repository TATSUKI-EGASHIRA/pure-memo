// Keep the original Plasma recipe; pages only change its final hue rotation.
// Notes retains the user's original 174-degree recipe (packed value 3.04).
export const PLASMA_THEMES=Object.freeze({
  Notes:{hue:3.04,color:'#154b79',name:'blue'},
  Collections:{hue:4.10,color:'#205a48',name:'green'},
  Graph:{hue:3.40,color:'#17445d',name:'deep-blue'},
  'Next Steps':{hue:0,color:'#80502b',name:'amber'},
  Ask:{hue:3.70,color:'#185a60',name:'teal'},
  Categories:{hue:5.70,color:'#62602e',name:'olive'},
  'Create Category':{hue:5.70,color:'#62602e',name:'olive'},
  Settings:{hue:2.65,color:'#304b83',name:'indigo'},
  Trash:{hue:.35,color:'#714037',name:'copper'},
});
export const plasmaThemeFor=page=>PLASMA_THEMES[page]||PLASMA_THEMES.Notes;
// Rotate along the shorter arc, including pages across the 0 / 2π seam.
export function approachHue(current,target,delta){
  const distance=Math.atan2(Math.sin(target-current),Math.cos(target-current));
  return Math.abs(distance)<.001?target:current+distance*(1-Math.exp(-Math.max(0,Math.min(delta,.1))*5));
}
