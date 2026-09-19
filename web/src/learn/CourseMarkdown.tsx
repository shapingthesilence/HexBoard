import {Fragment,type ReactNode} from "react";
// A safe Markdown subset. React escapes text; raw HTML is never executed.
function inline(text:string):ReactNode[]{return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^\s)]+\))/g).map((part,i)=>{
 if(part.startsWith("**"))return <strong key={i}>{part.slice(2,-2)}</strong>;
 if(part.startsWith("*"))return <em key={i}>{part.slice(1,-1)}</em>;
 if(part.startsWith("`"))return <code key={i}>{part.slice(1,-1)}</code>;
 const link=part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);if(link&&/^(https?:\/\/|mailto:)/i.test(link[2]))return <a key={i} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
 return part;
});}
export function CourseMarkdown({source}:{source:string}){
 const lines=source.replace(/\r/g,"").split("\n"),blocks:ReactNode[]=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i];if(!line.trim())continue;
  if(line.startsWith("```")){const code:string[]=[];while(++i<lines.length&&!lines[i].startsWith("```"))code.push(lines[i]);blocks.push(<pre key={i}><code>{code.join("\n")}</code></pre>);continue;}
  const heading=line.match(/^(#{1,3})\s+(.*)/);if(heading){const Tag=heading[1].length===1?"h1":heading[1].length===2?"h2":"h3";blocks.push(<Tag key={i}>{inline(heading[2])}</Tag>);continue;}
  if(/^([-*]|\d+\.)\s/.test(line)){const ordered=/^\d/.test(line),items:ReactNode[]=[];do{items.push(<li key={i}>{inline(lines[i].replace(/^([-*]|\d+\.)\s+/,""))}</li>);i++;}while(i<lines.length&&(ordered?/^\d+\.\s/:/^[-*]\s/).test(lines[i]));i--;blocks.push(ordered?<ol key={i}>{items}</ol>:<ul key={i}>{items}</ul>);continue;}
  if(line.startsWith("> ")){blocks.push(<blockquote key={i}>{inline(line.slice(2))}</blockquote>);continue;}
  blocks.push(<p key={i}>{inline(line)}</p>);
 }
 return <div className="courseMarkdown">{blocks.map((block,i)=><Fragment key={i}>{block}</Fragment>)}</div>;
}
