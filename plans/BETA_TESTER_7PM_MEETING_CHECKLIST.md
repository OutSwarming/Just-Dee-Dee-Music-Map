# 7PM Beta Tester Meeting Checklist

Date: 2026-05-03

Purpose: learn how testers understand and use the current public app experience. Testers are still on the older app version; premium/paywall/payment rollout is not part of this meeting.

## Opening Notes

- Testers are still using the old app version.
- Premium is not shown to beta testers yet.
- The goal is usability feedback, not payment launch feedback.
- Avoid discussing payment rollout details until the final beta gate is complete.
- Premium/payment is not being rolled out tonight; tonight is about learning what feels useful, confusing, trustworthy, and worth supporting later.

## 60-Second Opening Script

Thanks for helping test BARK Ranger Map tonight. You are looking at the current beta version, not the internal payment test version. I am mainly watching how naturally the app opens, how the map feels, whether marker details make sense, where search or filters get confusing, and what parts feel valuable enough to keep improving. Please narrate what you expect before you tap things. There are no wrong answers; confusion is useful feedback. We are not rolling out premium or payments tonight, so if money comes up, I only want broad thoughts about future value and support.

## Agenda

1. Open the app and watch first impressions.
2. Walk through the map, filters, search, marker details, and profile basics.
3. Try visited tracking and ask what the saved history means to them.
4. Show the trip planner and ask whether it solves a real planning problem.
5. Ask where the app feels confusing, slow, or unclear.
6. Ask what feels valuable enough to keep using or support later.
7. Capture bugs, wording issues, and missing park/data issues.
8. Close with next-step expectations and where to send feedback.

## Questions To Ask

1. What did you expect to happen when the app first opened?
2. Which map controls made sense immediately, and which ones needed explanation?
3. What would you use most: visited tracking, trip planning, park search, profile/passport, or route tools?
4. Where did you hesitate or feel unsure what to tap next?
5. What information is missing from park details that would help you plan a visit?
6. Which features feel valuable enough that you would support the project if they became premium?
7. What would make you recommend this app to another B.A.R.K. Ranger?

## Bugs To Watch For

- App fails to load or map appears blank.
- Mark as visited does not persist after refresh.
- Sign-in or sign-out confusion.
- Profile stats look wrong after marking visits.
- Search/filter results feel stale or surprising.
- Marker panel text is cramped or unclear on mobile.
- Trip planner controls are hard to discover.
- Firestore permission errors in the console, especially achievements-related errors.

## Feedback To Collect

- Device/browser used.
- First action they tried after the map loaded.
- Words or labels that confused them.
- Places where they expected more detail.
- Features they ignored or did not notice.
- Features they would use on a real trip.
- Anything that made the map feel unofficial, untrustworthy, or stale.
- Anything they would mention if recommending the app to another user.

## Do Not Discuss Yet

- Payment rollout timing.
- Checkout details.
- Webhook or entitlement mechanics.
- Exact premium launch date.
- Live pricing promises beyond broad value discovery.
- Internal test-mode checkout behavior.
- Lemon Squeezy.
- Payment smoke internals.
- Technical architecture.

## After-Meeting Action List

1. Sort notes into bugs, confusion points, data issues, and feature/value signals.
2. Identify any trust-breaking issues that should block wider beta rollout.
3. Reproduce reported bugs before editing code.
4. Keep payment rollout separate from tester usability feedback.
5. Update the launch checklist with the top 3 fixes or follow-up questions.
6. Decide whether any feedback changes the free vs premium split before final beta gate.

## Facilitator Notes

- Let testers narrate before explaining.
- Write down exact words they use for confusion points.
- Ask follow-up questions about value, not just bugs.
- Keep the meeting focused on the version they can actually use today.
