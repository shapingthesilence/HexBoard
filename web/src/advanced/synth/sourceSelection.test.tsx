import {expect,it} from 'vitest';
import {ModSourceButton} from './SynthControls.tsx';
import {sourceClickTool} from './modulationTargeting.ts';

it('a rapid second click deselects instead of relocking the source',()=>{
 let selected=false;
 const button=()=>ModSourceButton({label:'Pressure',color:'#fff',pressed:selected,onSelect:lock=>{selected=sourceClickTool(selected,lock)==='modulate';}}).props.children[0];
 button().props.onClick({shiftKey:false});expect(selected).toBe(true);
 button().props.onClick({shiftKey:false});
 button().props.onDoubleClick?.();expect(selected).toBe(false);
});
it('Shift-click still allows deliberate assignment locking',()=>{
 let selected=true;
 const button=ModSourceButton({label:'Pressure',color:'#fff',pressed:selected,onSelect:lock=>{selected=sourceClickTool(selected,lock)==='modulate';}}).props.children[0];
 button.props.onClick({shiftKey:true});expect(selected).toBe(true);
 button.props.onClick({shiftKey:false});expect(selected).toBe(false);
});
