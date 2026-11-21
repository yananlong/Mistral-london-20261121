/**
 * The hub's two replies on the mesh, word for word per BLUEPRINT_1.md's
 * message format. One constant each, shared by the mock hub
 * (SimulatedTransport) and the Ask screen, so they can never drift.
 */

/** The hub's first reply, sent as soon as a question arrives. */
export const HUB_ACK_TEXT = 'Received. Working on an answer.';

/** The label the hub ends every answer with. */
export const HUB_ANSWER_LABEL =
  'AI answer from an open-weight model on the hub. Not verified emergency advice.';
