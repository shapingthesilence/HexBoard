import { useEffect, useState } from "react";
import { estimatedProgress } from "./loadTiming.ts";
import type { SynthProgress as Progress } from './progress.ts';
export function SynthProgress({ progress }: {
    progress: Progress;
}) {
    const [now, setNow] = useState(Date.now);
    useEffect(() => { if (progress.expectedMs === undefined)
        return; setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 50); return () => clearInterval(timer); }, [progress.startedAt, progress.expectedMs]);
    const estimated = progress.startedAt !== undefined && progress.expectedMs !== undefined;
    const measured = Number.isFinite(progress.completed) && Number.isFinite(progress.total) && progress.total! > 0;
    const total = measured ? progress.total! : 1, value = measured ? Math.max(0, Math.min(total, progress.completed!)) : estimated ? estimatedProgress(now - progress.startedAt!, progress.expectedMs!) : undefined;
    return <div className="synth-progress" role="status"><span>{progress.label}{(measured || estimated) && <output>{Math.round(value! / total * 100)}%</output>}</span><progress aria-label={progress.label} max={total} value={value}/></div>;
}
