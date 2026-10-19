import {it,expect,vi} from 'vitest';
import {targetingEscape} from './modulationTargeting.ts';
it('cancels targeting on Escape and detaches on exit',()=>{
 const target=new EventTarget(),cancel=vi.fn(),cleanup=targetingEscape(target,cancel);
 const key=(value:string,handled=false)=>{const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value});if(handled)event.preventDefault();target.dispatchEvent(event);};
 key('Enter');key('Escape',true);expect(cancel).not.toHaveBeenCalled();key('Escape');expect(cancel).toHaveBeenCalledTimes(1);cleanup();key('Escape');expect(cancel).toHaveBeenCalledTimes(1);
});
