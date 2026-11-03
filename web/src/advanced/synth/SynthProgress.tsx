import { useEffect, useRef, useState } from "react";
import {startVisibleAnimation} from '../../animation.ts';
import { estimatedProgress } from "./loadTiming.ts";
import type { SynthProgress as Progress } from './progress.ts';
export function SynthProgress({ progress }: {
    progress: Progress;
}) {
    const [now, setNow] = useState(Date.now);
    const root = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (progress.expectedMs === undefined) return;
        setNow(Date.now());
        let last = -Infinity;
        return startVisibleAnimation(root.current!, time => { if (time - last >= 50 - .001) { last = time; setNow(Date.now()); } });
    }, [progress.startedAt, progress.expectedMs]);
    const estimated = progress.startedAt !== undefined && progress.expectedMs !== undefined;
    const measured = Number.isFinite(progress.completed) && Number.isFinite(progress.total) && progress.total! > 0;
    const total = measured ? progress.total! : 1, value = measured ? Math.max(0, Math.min(total, progress.completed!)) : estimated ? estimatedProgress(now - progress.startedAt!, progress.expectedMs!) : undefined;
    return <div ref={root} className="synth-progress" role="status"><span>{progress.label}{(measured || estimated) && <output>{Math.round(value! / total * 100)}%</output>}</span><progress aria-label={progress.label} max={total} value={value}/></div>;
}
