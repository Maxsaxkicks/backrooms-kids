// Minimal WebAudio soundscape (no external assets)
// - ambient fluorescent hum
// - footsteps while moving
// - heartbeat + noise when danger

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;

    this.humOsc = null;
    this.humGain = null;

    this.footOsc = null;
    this.footGain = null;
    this.footTimer = 0;

    this.heartOsc = null;
    this.heartGain = null;

    this.noiseSrc = null;
    this.noiseGain = null;

    this.enabled = false;
  }

  async start() {
    if (this.enabled) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();
    await this.ctx.resume();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    // fluorescent hum
    this.humOsc = this.ctx.createOscillator();
    this.humOsc.type = 'sawtooth';
    this.humOsc.frequency.value = 58;

    const humFilter = this.ctx.createBiquadFilter();
    humFilter.type = 'bandpass';
    humFilter.frequency.value = 520;
    humFilter.Q.value = 0.7;

    this.humGain = this.ctx.createGain();
    this.humGain.gain.value = 0.12;

    this.humOsc.connect(humFilter);
    humFilter.connect(this.humGain);
    this.humGain.connect(this.master);
    this.humOsc.start();

    // footsteps (short blips)
    this.footGain = this.ctx.createGain();
    this.footGain.gain.value = 0.0;
    this.footGain.connect(this.master);

    // heartbeat
    this.heartOsc = this.ctx.createOscillator();
    this.heartOsc.type = 'sine';
    this.heartOsc.frequency.value = 2.0; // LFO controlling gain

    this.heartGain = this.ctx.createGain();
    this.heartGain.gain.value = 0.0;

    // apply heartbeat as tremolo on a low thump osc
    const thump = this.ctx.createOscillator();
    thump.type = 'triangle';
    thump.frequency.value = 56;

    const thumpGain = this.ctx.createGain();
    thumpGain.gain.value = 0.0;

    this.heartOsc.connect(this.heartGain);
    this.heartGain.connect(thumpGain.gain);

    thump.connect(thumpGain);
    thumpGain.connect(this.master);

    this.heartOsc.start();
    thump.start();

    // noise (buffer loop)
    const noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.6;

    this.noiseSrc = this.ctx.createBufferSource();
    this.noiseSrc.buffer = noiseBuf;
    this.noiseSrc.loop = true;

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 900;

    this.noiseGain = this.ctx.createGain();
    this.noiseGain.gain.value = 0.0;

    this.noiseSrc.connect(noiseFilter);
    noiseFilter.connect(this.noiseGain);
    this.noiseGain.connect(this.master);
    this.noiseSrc.start();

    this.enabled = true;
  }

  stop() {
    try { this.ctx?.close(); } catch {}
    this.ctx = null;
    this.enabled = false;
  }

  blipFoot() {
    if (!this.enabled) return;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 140 + Math.random() * 40;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0, this.ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.09, this.ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.07);
    o.connect(g);
    g.connect(this.master);
    o.start();
    o.stop(this.ctx.currentTime + 0.08);
  }

  update({ moving = 0, danger = 0 }) {
    if (!this.enabled) return;

    // subtle hum modulation
    this.humGain.gain.value = 0.10 + 0.08 * danger;

    // footsteps cadence
    const cadence = 0.42 - 0.18 * Math.min(1, moving);
    this.footTimer += 1 / 60;
    if (moving > 0.15 && this.footTimer > cadence) {
      this.footTimer = 0;
      this.blipFoot();
    }

    // heartbeat intensity
    const hb = Math.min(1, Math.max(0, danger));
    // rate increases with danger
    this.heartOsc.frequency.setTargetAtTime(1.6 + hb * 2.6, this.ctx.currentTime, 0.03);
    // gain controls thumpGain.gain via LFO
    this.heartGain.gain.setTargetAtTime(0.10 + hb * 0.55, this.ctx.currentTime, 0.05);

    // noise
    this.noiseGain.gain.setTargetAtTime(hb * 0.22, this.ctx.currentTime, 0.05);
  }
}
