import type {Achievement} from "./achievementFeedback.ts";
export function AchievementFeedback({achievement}:{achievement:Achievement}) {
  const independent=achievement==="independent";
  return <div className={`learnAchievement ${independent?"independent":"completed"}`} role="status" aria-live="polite">
    <span className="learnAchievementBadge" aria-hidden="true">{independent?"★":"✓"}<i>♪</i><i>✦</i><i>♫</i><i>✦</i></span>
    <div><strong>{independent?"Independent star earned!":"Lesson complete!"}</strong><p>{independent?"A clean performance without hints.":"Checkmark earned for this lesson."}</p></div>
  </div>;
}
