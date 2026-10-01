import React,{useEffect,useRef} from 'react';
import {plasmaThemeFor,approachHue} from './plasmaThemes.js';
import fragmentSource from './shaders/plasma.frag.glsl?raw';
import './plasma-background.css';

const vertexSource=`attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`;
const colors=new Float32Array([
  .086,.043,.043, .761,.251,.165, .957,.616,.216, 1.000,.910,.761,
  0,0,0, 0,0,0, 0,0,0, 0,0,0,
]);

function compile(gl,type,source){
  const shader=gl.createShader(type);
  if(!shader)throw new Error('Could not create a shader');
  gl.shaderSource(shader,source);gl.compileShader(shader);
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){
    const message=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(message||'Shader compilation failed');
  }
  return shader;
}
function createResources(gl){
  const vertex=compile(gl,gl.VERTEX_SHADER,vertexSource);
  let fragment,program,buffer;
  try{
    fragment=compile(gl,gl.FRAGMENT_SHADER,fragmentSource);
    program=gl.createProgram();
    if(!program)throw new Error('Could not create a shader program');
    gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'Shader linking failed');
    buffer=gl.createBuffer();
    if(!buffer)throw new Error('Could not create the fullscreen triangle');
    gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    const position=gl.getAttribLocation(program,'a_position');
    gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    const uniform=name=>gl.getUniformLocation(program,name);
    gl.uniform3fv(uniform('u_colors[0]'),colors);
    gl.uniform4f(uniform('u_shape'),1.50,.48,.50,.00);
    gl.uniform4f(uniform('u_surface'),2.40,.92,-.50,1.00);
    gl.uniform4f(uniform('u_finish'),3.04,.61,.016,.35);
    gl.uniform4f(uniform('u_transform'),7.0,.00,.16,.0);
    gl.uniform4f(uniform('u_space'),.00,.00,0,0);
    gl.uniform4f(uniform('u_cursor'),0,4.0,.65,.30);
    return {program,buffer,scene:uniform('u_scene'),finish:uniform('u_finish')};
  }catch(error){
    if(buffer)gl.deleteBuffer(buffer);
    if(program)gl.deleteProgram(program);
    throw error;
  }finally{
    gl.deleteShader(vertex);
    if(fragment)gl.deleteShader(fragment);
  }
}

export default function PlasmaBackground({reduced=false,page='Notes'}){
  const theme=plasmaThemeFor(page);
  const canvas=useRef(null),seconds=useRef(0),appearance=useRef({hue:theme.hue,target:theme.hue}),paint=useRef(null);
  useEffect(()=>{
    const el=canvas.current;
    const gl=el.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,powerPreference:'low-power'});
    if(!gl){el.hidden=true;return}
    let resources=null,frame=0,previous=null;
    const stop=()=>{cancelAnimationFrame(frame);frame=0;previous=null};
    function draw(){
      if(!resources||gl.isContextLost())return;
      gl.useProgram(resources.program);
      gl.uniform4f(resources.scene,el.width,el.height,seconds.current*.86,4.0);
      gl.uniform4f(resources.finish,appearance.current.hue,.61,.016,.35);
      gl.drawArrays(gl.TRIANGLES,0,3);
    }
    function tick(stamp){
      frame=0;
      if(document.hidden||reduced||!resources||gl.isContextLost()){previous=null;return}
      if(previous!==null){const delta=(stamp-previous)/1000;seconds.current+=delta;appearance.current.hue=approachHue(appearance.current.hue,appearance.current.target,delta)}
      previous=stamp;draw();frame=requestAnimationFrame(tick);
    }
    function sync(){
      if(document.hidden||reduced||!resources||gl.isContextLost())stop();
      else if(!frame){previous=null;frame=requestAnimationFrame(tick)}
    }
    function resize(){
      const rect=el.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);
      const width=Math.max(1,Math.round(rect.width*dpr)),height=Math.max(1,Math.round(rect.height*dpr));
      if(el.width!==width||el.height!==height){el.width=width;el.height=height}
      gl.viewport(0,0,width,height);draw();
    }
    function initialize(){
      try{resources=createResources(gl);el.hidden=false;resize();sync()}
      catch(error){el.hidden=true;console.warn('[pure] Plasma background:',error.message)}
    }
    function lost(event){event.preventDefault();stop();resources=null;el.hidden=true}
    const resizeObserver=new ResizeObserver(resize);
    el.addEventListener('webglcontextlost',lost);el.addEventListener('webglcontextrestored',initialize);
    document.addEventListener('visibilitychange',sync);window.addEventListener('resize',resize);
    paint.current=draw;initialize();resizeObserver.observe(el);
    return()=>{
      stop();paint.current=null;resizeObserver.disconnect();
      el.removeEventListener('webglcontextlost',lost);el.removeEventListener('webglcontextrestored',initialize);
      document.removeEventListener('visibilitychange',sync);window.removeEventListener('resize',resize);
      if(resources){gl.deleteBuffer(resources.buffer);gl.deleteProgram(resources.program)}
    };
  },[reduced]);
  useEffect(()=>{
    appearance.current.target=theme.hue;
    if(reduced||document.hidden){appearance.current.hue=theme.hue;paint.current?.()}
  },[theme.hue,reduced]);
  return <canvas ref={canvas} className="plasma-background" data-palette={theme.name} aria-hidden="true"/>;
}
