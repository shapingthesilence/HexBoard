import type {Achievement} from "./achievementFeedback.ts";
export function AchievementFeedback({achievement}:{achievement:Achievement}) {
  const independent=achievement==="independent";
  return <div className={`learnAchievement ${independent?"independent":"completed"}`} role="status" aria-live="polite">
    <span className="learnAchievementBadge" aria-hidden="true">{independent?"★":"✓"}<i>♪</i><i>✦</i><i>♫</i><i>✦</i></span>
    <div><strong>{independent?"You made it your own!":"Lesson complete!"}</strong><p>{independent?"Independent star earned · a clean performance without hints.":"A new step in your musical journey. Enjoy that win."}</p></div>
  </div>;
}
