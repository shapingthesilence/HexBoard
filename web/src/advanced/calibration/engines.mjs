export const engineNames=['Threshold Strike','Expressive Strike','Short-window Distance','Peak Gesture','Fixed Velocity + Pressure'];
export const engineDescriptions=[
 'Velocity comes from Start → End crossing time. Notes sustain until Release; pressure remains available.',
 'Maximum positive speed across 1–4 recent samples, measured between Arm and Trigger. Trigger at a shallow depth for early response; short windows are more noise-sensitive.',
 'Distance moved after Arm over a defined 1–4-sample window. Longer windows add latency. Reversals larger than 0.01 mm cancel the gesture; notes sustain after triggering.',
 'Velocity comes from maximum depth. A note sounds after release from that peak, lasts the selected duration, then stops. Return near rest before the next gesture.',
 'A fixed velocity at Trigger, followed by pressure while held. Set pressure mode and response in the Pressure workspace.'
];
export function engineMagnitude(value,soft,hard,shape,minimum=1,maximum=127){
 if(value<=soft)return minimum;if(value>=hard)return maximum;
 const x=Math.floor((value-soft)*65535/(hard-soft)),square=Math.floor((x*x+32767)/65535);
 const y=Math.floor(((8-shape)*x+shape*square+4)/8);
 return minimum+Math.floor((y*(maximum-minimum)+32767)/65535);
}
export function engineMeasurement(event){
 if(!event?.engine)return event?`${(event.us/1000).toFixed(3)} ms crossing`:'';
 if(event.engine===1)return `${(event.measurement*4/65535).toFixed(3)} mm/ms early speed`;
 if(event.engine===4)return `fixed velocity ${event.velocity}`;
 return `${(event.measurement*4/65535).toFixed(3)} mm ${event.engine===3?'peak':'window distance'}`;
}
