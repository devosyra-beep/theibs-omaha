'use strict';
const { createSession, applyAction, publicSession } = require('./training-simulator');

function replayPlan(session) {
  return {
    variant: session.variant, seed: session.seed, startingStack: session.startingStack,
    opponentStyle: session.opponentStyle, mode: session.mode, targetStreet: session.targetStreet,
    // This is the confirmed prefix before the decision. Future board and
    // opponent cards remain in the server's seed, never in the public history.
    events: structuredClone(session.events)
  };
}

function replayDecision(plan) {
  if (!plan || !Array.isArray(plan.events) || plan.events.length > 500) throw Error('This decision cannot be replayed.');
  const session = createSession(plan);
  const samePrefix = () => JSON.stringify(session.events) === JSON.stringify(plan.events.slice(0, session.events.length));
  if (!samePrefix()) throw Error('The exercise rules changed; this decision cannot be replayed safely.');
  for (let step = 0; session.events.length < plan.events.length && step < 100; step++) {
    const next = plan.events[session.events.length];
    if (next?.type !== 'ACT' || next.actor !== 0) throw Error('The recorded decision sequence cannot be replayed.');
    applyAction(session, next.action, next.to);
    if (session.events.length > plan.events.length || !samePrefix()) throw Error('The exercise rules changed; this decision cannot be replayed safely.');
  }
  if (session.events.length !== plan.events.length || session.finished) throw Error('The recorded decision is no longer available.');
  return { session, publicState: publicSession(session) };
}

module.exports = { replayPlan, replayDecision };
