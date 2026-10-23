// VozChat FlowTalk streaming: PCM s16 mono 16kHz, 20ms per frame.
// Frames only exist in memory and travel over an authenticated WebSocket.
const TARGET=16000;
const FRAME=320;
class VozchatMic extends AudioWorkletProcessor{
  constructor(){
    super();
    this.enabled=false;this.phase=0;this.sum=0;this.count=0;
    this.frame=new Int16Array(FRAME);this.offset=0;
    this.port.onmessage=e=>{
      if(e.data?.type==='enabled'){
        this.enabled=!!e.data.value;
        this.phase=0;this.sum=0;this.count=0;this.offset=0;
      }
    };
  }
  process(inputs,outputs){
    // Silent output keeps the node connected without looping the microphone to speakers.
    for(const channel of outputs[0]||[])channel.fill(0);
    const samples=inputs[0]?.[0];
    if(!this.enabled||!samples)return true;
    const step=TARGET/sampleRate;
    for(let i=0;i<samples.length;i++){
      this.sum+=samples[i];this.count++;this.phase+=step;
      if(this.phase>=1){
        const avg=Math.max(-1,Math.min(1,this.sum/this.count));
        this.frame[this.offset++]=avg<0?Math.round(avg*32768):Math.round(avg*32767);
        this.phase-=1;this.sum=0;this.count=0;
        if(this.offset===FRAME){
          const pcm=this.frame.buffer;
          this.port.postMessage({type:'frame',pcm},[pcm]);
          this.frame=new Int16Array(FRAME);this.offset=0;
        }
      }
    }
    return true;
  }
}
class VozchatSpeaker extends AudioWorkletProcessor{
  constructor(){
    super();
    this.samples=new Float32Array(16384);
    this.head=0;this.tail=0;this.available=0;
    this.playing=false;this.pos=0;this.a=0;this.b=0;
    this.step=TARGET/sampleRate;
    this.port.onmessage=e=>{
      const data=e.data||{};
      if(data.type==='reset'){this.head=this.tail=this.available=0;this.playing=false;this.pos=0;return;}
      if(data.type==='pcm'&&data.pcm instanceof ArrayBuffer){
        const frame=new Int16Array(data.pcm);
        for(let i=0;i<frame.length;i++){
          if(this.available>=this.samples.length){this.head=(this.head+1)%this.samples.length;this.available--;}
          this.samples[this.tail]=frame[i]/32768;
          this.tail=(this.tail+1)%this.samples.length;this.available++;
        }
        // Cap queued audio to ~160ms; prioritize live speech over old packets.
        while(this.available>2560){this.head=(this.head+1)%this.samples.length;this.available--;}
      }
    };
  }
  take(){
    if(!this.available)return null;
    const result=this.samples[this.head];
    this.head=(this.head+1)%this.samples.length;this.available--;
    return result;
  }
  process(inputs,outputs){
    const output=outputs[0];if(!output?.length)return true;
    const target=output[0];
    for(let i=0;i<target.length;i++){
      if(!this.playing){
        if(this.available<640){target[i]=0;continue;}
        this.a=this.take();this.b=this.take();this.pos=0;this.playing=true;
      }
      target[i]=this.a+(this.b-this.a)*this.pos;
      this.pos+=this.step;
      while(this.pos>=1){
        this.pos-=1;this.a=this.b;
        const next=this.take();
        if(next===null){this.playing=false;break;}
        this.b=next;
      }
    }
    for(let c=1;c<output.length;c++)output[c].set(target);
    return true;
  }
}
registerProcessor('vozchat-mic-stream',VozchatMic);
registerProcessor('vozchat-speaker-stream',VozchatSpeaker);
