import {useEffect,useRef,type ReactNode} from 'react';
export function WorkspaceDialog({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const focus=document.activeElement as HTMLElement|null;ref.current?.showModal();return()=>{focus?.focus();};},[]);
 return <dialog ref={ref} className="sampler-workspace-dialog" aria-label={title} onCancel={e=>{e.preventDefault();onClose();}}><header><h3>{title}</h3><button onClick={onClose} aria-label={`Close ${title}`}>Close</button></header>{children}</dialog>;
}
