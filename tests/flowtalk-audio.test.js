import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import path from 'node:path';

test('FlowTalk: microfone transforma amostras em PCM e alto-falante produz sinal audível',()=>{
  const types=new Map();
  class FakeProcessor{
    constructor(){
      this.packets=[];
      this.port={onmessage:null,postMessage:data=>{this.packets.push(data);}};
    }
  }
  const script=readFileSync(path.resolve(import.meta.dirname,'../public/talk-worklet.js'),'utf8');
  runInNewContext(script,{
    AudioWorkletProcessor:FakeProcessor,
    registerProcessor:(name,type)=>types.set(name,type),
    sampleRate:48000,
    Math,Float32Array,Int16Array,ArrayBuffer
  });
  const Mic=types.get('vozchat-mic-stream'),Speaker=types.get('vozchat-speaker-stream');
  assert.ok(Mic&&Speaker,'Ambos os processadores precisam estar registrados');
  const mic=new Mic();
  mic.port.onmessage({data:{type:'enabled',value:true}});
  // Simular 1 segundo de fala a 440Hz em blocos de 128 amostras, 48kHz.
  for(let start=0;start<48000;start+=128){
    const input=new Float32Array(128);
    for(let i=0;i<128;i++)input[i]=.5*Math.sin((start+i)*2*Math.PI*440/48000);
    mic.process([[input]],[[new Float32Array(128)]]);
  }
  assert.ok(mic.packets.length>=48,'O microfone deve gerar aproximadamente 50 frames de 20ms');
  const buffers=mic.packets.slice(0,5).map(packet=>{
    assert.equal(packet.type,'frame');
    assert.equal(packet.pcm.byteLength,640);
    return packet.pcm;
  });
  const speaker=new Speaker();
  for(const pcm of buffers)speaker.port.onmessage({data:{type:'pcm',pcm}});
  let peak=0;
  for(let i=0;i<40;i++){
    const out=new Float32Array(128);
    speaker.process([],[[out]]);
    for(const n of out)peak=Math.max(peak,Math.abs(n));
  }
  assert.ok(peak>.1,'O alto-falante deve reconstruir um sinal com amplitude audível');
  assert.ok(peak<=1,'O áudio não deve exceder a escala normalizada');
  speaker.port.onmessage({data:{type:'reset'}});
  assert.equal(speaker.available,0);
  mic.port.onmessage({data:{type:'enabled',value:false}});
  const previous=mic.packets.length;
  mic.process([[new Float32Array(128).fill(.5)]],[[new Float32Array(128)]]);
  assert.equal(mic.packets.length,previous,'Depois de soltar, o microfone não pode emitir pacotes');
});
